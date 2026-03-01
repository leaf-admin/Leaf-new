/**
 * Script de Teste de Carga - Simulação de Produção
 * 
 * Simula:
 * - Múltiplas corridas simultâneas
 * - Múltiplos motoristas conectados
 * - Eventos de início e chegada
 * - Eventos múltiplos do escopo do projeto
 * 
 * Coleta:
 * - Latência de eventos
 * - Status do servidor (CPU, memória, conexões)
 * - Taxa de sucesso/erro
 */

const io = require('socket.io-client');
const axios = require('axios');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

// Tentar importar monitor SSH (opcional)
let ServerMonitor = null;
try {
    ServerMonitor = require('./monitor-server-ssh');
} catch (error) {
    // Monitor SSH não disponível, usar apenas API
}

// ==================== CONFIGURAÇÕES ====================
const CONFIG = {
    // Servidor WebSocket (VPS)
    WS_URL: process.env.WS_URL || 'http://216.238.107.59:3001',
    
    // Número de simulações
    NUM_PASSENGERS: parseInt(process.env.NUM_PASSENGERS || '50'), // 50 passageiros simultâneos
    NUM_DRIVERS: parseInt(process.env.NUM_DRIVERS || '100'), // 100 motoristas simultâneos
    
    // Taxa de eventos
    RIDE_CREATION_RATE: parseInt(process.env.RIDE_CREATION_RATE || '10'), // 10 corridas por segundo
    TRIP_DURATION_MS: parseInt(process.env.TRIP_DURATION_MS || '30000'), // 30 segundos por viagem
    
    // Duração do teste
    TEST_DURATION_MS: parseInt(process.env.TEST_DURATION_MS || '300000'), // 5 minutos
    
    // Monitoramento do servidor
    SERVER_MONITOR_INTERVAL: 5000, // Verificar status a cada 5 segundos
    SERVER_SSH_HOST: process.env.SERVER_SSH_HOST || null, // IP da VPS
    SERVER_SSH_USER: process.env.SERVER_SSH_USER || 'root',
    SERVER_SSH_KEY: process.env.SERVER_SSH_KEY || null, // Caminho para chave SSH (opcional)
};

// ==================== MÉTRICAS ====================
const metrics = {
    startTime: null,
    endTime: null,
    events: {
        rideCreated: { count: 0, latencies: [], errors: 0 },
        rideAccepted: { count: 0, latencies: [], errors: 0 },
        tripStarted: { count: 0, latencies: [], errors: 0 },
        tripCompleted: { count: 0, latencies: [], errors: 0 },
        driverNotification: { count: 0, latencies: [], errors: 0 },
        locationUpdate: { count: 0, latencies: [], errors: 0 },
    },
    serverStats: [],
    activeConnections: {
        passengers: 0,
        drivers: 0,
    },
    activeRides: new Map(),
    completedRides: 0,
    failedRides: 0,
};

// ==================== CLIENTES SIMULADOS ====================
const passengers = [];
const drivers = [];

// ==================== FUNÇÕES AUXILIARES ====================

/**
 * Gerar coordenadas aleatórias próximas a um ponto central
 */
function generateRandomLocation(centerLat, centerLng, radiusKm = 5) {
    const radiusInDegrees = radiusKm / 111; // Aproximadamente 111km por grau
    const u = Math.random();
    const v = Math.random();
    const w = radiusInDegrees * Math.sqrt(u);
    const t = 2 * Math.PI * v;
    const x = w * Math.cos(t);
    const y = w * Math.sin(t);
    
    return {
        lat: centerLat + y,
        lng: centerLng + x,
    };
}

/**
 * Calcular estatísticas de latência
 */
function calculateLatencyStats(latencies) {
    if (latencies.length === 0) return null;
    
    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    
    return {
        count: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: sum / sorted.length,
        median: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
    };
}

// Instância do monitor SSH (se disponível)
let sshMonitor = null;
if (ServerMonitor && CONFIG.SERVER_SSH_HOST) {
    sshMonitor = new ServerMonitor({
        host: CONFIG.SERVER_SSH_HOST,
        user: CONFIG.SERVER_SSH_USER,
        key: CONFIG.SERVER_SSH_KEY,
    });
    console.log(`📡 Monitor SSH configurado para ${CONFIG.SERVER_SSH_HOST}`);
}

/**
 * Monitorar recursos do servidor (via SSH ou API)
 */
async function monitorServerResources() {
    // Prioridade 1: Tentar SSH se configurado
    if (sshMonitor) {
        try {
            const sshMetrics = await sshMonitor.getAllMetrics();
            return {
                timestamp: Date.now(),
                source: 'ssh',
                ...sshMetrics,
            };
        } catch (error) {
            console.warn(`⚠️ Erro ao obter métricas via SSH: ${error.message}`);
        }
    }
    
    // Prioridade 2: Tentar API do servidor
    try {
        const response = await axios.get(`${CONFIG.WS_URL}/api/metrics`, { timeout: 2000 });
        return {
            timestamp: Date.now(),
            source: 'api',
            cpu: response.data.cpu || null,
            memory: response.data.memory || null,
            connections: response.data.connections || null,
            activeRides: response.data.activeRides || null,
            activeBookings: response.data.activeBookings || null,
        };
    } catch (error) {
        // Se não houver API, usar informações básicas
        return {
            timestamp: Date.now(),
            source: 'none',
            note: 'API de métricas não disponível',
            error: error.message,
        };
    }
}

/**
 * Salvar relatório final
 */
function saveReport() {
    const report = {
        config: CONFIG,
        summary: {
            duration: metrics.endTime - metrics.startTime,
            totalEvents: Object.values(metrics.events).reduce((sum, e) => sum + e.count, 0),
            totalErrors: Object.values(metrics.events).reduce((sum, e) => sum + e.errors, 0),
            completedRides: metrics.completedRides,
            failedRides: metrics.failedRides,
            successRate: (metrics.completedRides / (metrics.completedRides + metrics.failedRides) * 100).toFixed(2) + '%',
        },
        events: {},
        serverStats: metrics.serverStats,
    };
    
    // Calcular estatísticas de latência para cada evento
    for (const [eventName, eventData] of Object.entries(metrics.events)) {
        report.events[eventName] = {
            count: eventData.count,
            errors: eventData.errors,
            latency: calculateLatencyStats(eventData.latencies),
        };
    }
    
    const reportPath = path.join(__dirname, `load-test-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`\n📊 Relatório salvo em: ${reportPath}`);
    return report;
}

/**
 * Imprimir relatório no console
 */
function printReport(report) {
    console.log('\n' + '='.repeat(80));
    console.log('📊 RELATÓRIO DE TESTE DE CARGA');
    console.log('='.repeat(80));
    
    console.log('\n📈 RESUMO:');
    console.log(`  Duração: ${(report.summary.duration / 1000).toFixed(2)}s`);
    console.log(`  Total de Eventos: ${report.summary.totalEvents}`);
    console.log(`  Total de Erros: ${report.summary.totalErrors}`);
    console.log(`  Corridas Completadas: ${report.summary.completedRides}`);
    console.log(`  Corridas Falhadas: ${report.summary.failedRides}`);
    console.log(`  Taxa de Sucesso: ${report.summary.successRate}`);
    
    console.log('\n⏱️  LATÊNCIA DOS EVENTOS:');
    for (const [eventName, eventData] of Object.entries(report.events)) {
        if (eventData.latency) {
            console.log(`\n  ${eventName.toUpperCase()}:`);
            console.log(`    Total: ${eventData.count} | Erros: ${eventData.errors}`);
            console.log(`    Mín: ${eventData.latency.min.toFixed(2)}ms`);
            console.log(`    Máx: ${eventData.latency.max.toFixed(2)}ms`);
            console.log(`    Média: ${eventData.latency.avg.toFixed(2)}ms`);
            console.log(`    Mediana: ${eventData.latency.median.toFixed(2)}ms`);
            console.log(`    P95: ${eventData.latency.p95.toFixed(2)}ms`);
            console.log(`    P99: ${eventData.latency.p99.toFixed(2)}ms`);
        }
    }
    
    if (report.serverStats.length > 0) {
        console.log('\n🖥️  STATUS DO SERVIDOR:');
        const lastStats = report.serverStats[report.serverStats.length - 1];
        console.log(`  Última verificação: ${new Date(lastStats.timestamp).toLocaleString()}`);
        if (lastStats.cpu) console.log(`  CPU: ${lastStats.cpu}%`);
        if (lastStats.memory) console.log(`  Memória: ${lastStats.memory}%`);
        if (lastStats.connections) console.log(`  Conexões: ${lastStats.connections}`);
        if (lastStats.activeRides) console.log(`  Corridas Ativas: ${lastStats.activeRides}`);
    }
    
    console.log('\n' + '='.repeat(80));
}

// ==================== SIMULAÇÃO DE PASSAGEIRO ====================

class PassengerSimulator {
    constructor(id) {
        this.id = `passenger_${id}`;
        this.socket = null;
        this.authenticated = false;
        this.activeBooking = null;
    }
    
    async connect() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!this.socket?.connected) {
                    this.socket?.disconnect();
                    reject(new Error('Timeout ao conectar'));
                }
            }, 15000);
            
            this.socket = io(CONFIG.WS_URL, {
                transports: ['websocket', 'polling'],
                reconnection: false, // Desabilitar reconexão automática para testes
                timeout: 15000,
                forceNew: true,
                autoConnect: true,
            });
            
            this.socket.on('connect', async () => {
                clearTimeout(timeout);
                console.log(`✅ Passageiro ${this.id} conectado`);
                metrics.activeConnections.passengers++;
                try {
                    await this.authenticate();
                    resolve();
                } catch (error) {
                    console.error(`❌ Erro ao autenticar passageiro ${this.id}:`, error.message);
                    reject(error);
                }
            });
            
            this.socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                console.error(`❌ Erro ao conectar passageiro ${this.id}:`, error.message || error);
                reject(error);
            });
            
            this.socket.on('disconnect', () => {
                console.log(`🔌 Passageiro ${this.id} desconectado`);
                metrics.activeConnections.passengers--;
            });
            
            // Escutar eventos de resposta
            this.socket.on('bookingCreated', (data) => {
                if (this.activeBooking) {
                    const latency = performance.now() - this.activeBooking.startTime;
                    metrics.events.rideCreated.latencies.push(latency);
                    metrics.events.rideCreated.count++;
                    console.log(`✅ Corrida criada: ${data.bookingId} (${latency.toFixed(2)}ms)`);
                }
            });
            
            this.socket.on('rideAccepted', (data) => {
                if (this.activeBooking) {
                    const latency = performance.now() - this.activeBooking.acceptStartTime;
                    metrics.events.rideAccepted.latencies.push(latency);
                    metrics.events.rideAccepted.count++;
                    console.log(`✅ Corrida aceita: ${data.bookingId} (${latency.toFixed(2)}ms)`);
                    this.simulateTripStart(data.bookingId);
                }
            });
            
            this.socket.on('tripStarted', (data) => {
                if (this.activeBooking) {
                    const latency = performance.now() - this.activeBooking.tripStartTime;
                    metrics.events.tripStarted.latencies.push(latency);
                    metrics.events.tripStarted.count++;
                    console.log(`🚀 Viagem iniciada: ${data.bookingId} (${latency.toFixed(2)}ms)`);
                }
            });
            
            this.socket.on('tripCompleted', (data) => {
                if (this.activeBooking) {
                    const latency = performance.now() - this.activeBooking.tripCompleteTime;
                    metrics.events.tripCompleted.latencies.push(latency);
                    metrics.events.tripCompleted.count++;
                    console.log(`🏁 Viagem completada: ${data.bookingId} (${latency.toFixed(2)}ms)`);
                    metrics.completedRides++;
                    this.activeBooking = null;
                }
            });
            
            this.socket.on('error', (error) => {
                console.error(`❌ Erro no passageiro ${this.id}:`, error);
                metrics.events.rideCreated.errors++;
            });
        });
    }
    
    authenticate() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout na autenticação'));
            }, 10000);
            
            this.socket.once('authenticated', (data) => {
                clearTimeout(timeout);
                this.authenticated = true;
                console.log(`🔐 Passageiro ${this.id} autenticado`);
                resolve();
            });
            
            this.socket.once('auth_error', (error) => {
                clearTimeout(timeout);
                reject(new Error(error.message || 'Erro na autenticação'));
            });
            
            this.socket.emit('authenticate', {
                uid: this.id,
                userType: 'passenger',
                token: `test_token_${this.id}`,
            });
        });
    }
    
    async createRide() {
        if (!this.authenticated || !this.socket?.connected) {
            return;
        }
        
        const startTime = performance.now();
        const centerLat = -23.5505; // São Paulo
        const centerLng = -46.6333;
        
        const pickup = generateRandomLocation(centerLat, centerLng, 2);
        const destination = generateRandomLocation(centerLat, centerLng, 5);
        
        this.activeBooking = {
            bookingId: null,
            startTime,
            acceptStartTime: null,
            tripStartTime: null,
            tripCompleteTime: null,
        };
        
        try {
            this.socket.emit('createBooking', {
                pickup: {
                    lat: pickup.lat,
                    lng: pickup.lng,
                    address: `Rua Teste ${Math.random() * 1000}`,
                },
                destination: {
                    lat: destination.lat,
                    lng: destination.lng,
                    address: `Rua Destino ${Math.random() * 1000}`,
                },
                passengerId: this.id,
                estimatedPrice: 25.50,
                paymentMethod: 'pix',
            });
            
            this.socket.once('bookingCreated', (data) => {
                if (this.activeBooking) {
                    this.activeBooking.bookingId = data.bookingId;
                    this.activeBooking.acceptStartTime = performance.now();
                    metrics.activeRides.set(data.bookingId, {
                        passengerId: this.id,
                        startTime: Date.now(),
                    });
                }
            });
        } catch (error) {
            console.error(`❌ Erro ao criar corrida para ${this.id}:`, error);
            metrics.events.rideCreated.errors++;
            metrics.failedRides++;
            this.activeBooking = null;
        }
    }
    
    simulateTripStart(bookingId) {
        if (!this.activeBooking || this.activeBooking.bookingId !== bookingId) {
            return;
        }
        
        // Simular início de viagem após alguns segundos
        setTimeout(() => {
            if (this.activeBooking && this.activeBooking.bookingId === bookingId) {
                this.activeBooking.tripStartTime = performance.now();
                this.socket.emit('startTrip', {
                    bookingId: bookingId,
                    startLocation: {
                        lat: -23.5505,
                        lng: -46.6333,
                    },
                });
            }
        }, 2000);
        
        // Simular conclusão de viagem
        setTimeout(() => {
            if (this.activeBooking && this.activeBooking.bookingId === bookingId) {
                this.activeBooking.tripCompleteTime = performance.now();
                this.socket.emit('completeTrip', {
                    bookingId: bookingId,
                    endLocation: {
                        lat: -23.5505,
                        lng: -46.6333,
                    },
                    distance: 5.5,
                    fare: 25.50,
                });
            }
        }, CONFIG.TRIP_DURATION_MS);
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}

// ==================== SIMULAÇÃO DE MOTORISTA ====================

class DriverSimulator {
    constructor(id) {
        this.id = `driver_${id}`;
        this.socket = null;
        this.authenticated = false;
        this.location = generateRandomLocation(-23.5505, -46.6333, 5);
        this.status = 'online';
        this.currentRide = null;
    }
    
    async connect() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!this.socket?.connected) {
                    this.socket?.disconnect();
                    reject(new Error('Timeout ao conectar'));
                }
            }, 15000);
            
            this.socket = io(CONFIG.WS_URL, {
                transports: ['websocket', 'polling'],
                reconnection: false, // Desabilitar reconexão automática para testes
                timeout: 15000,
                forceNew: true,
                autoConnect: true,
            });
            
            this.socket.on('connect', async () => {
                clearTimeout(timeout);
                console.log(`✅ Motorista ${this.id} conectado`);
                metrics.activeConnections.drivers++;
                try {
                    await this.authenticate();
                    this.setDriverStatus();
                    this.startLocationUpdates();
                    resolve();
                } catch (error) {
                    console.error(`❌ Erro ao autenticar motorista ${this.id}:`, error.message);
                    reject(error);
                }
            });
            
            this.socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                console.error(`❌ Erro ao conectar motorista ${this.id}:`, error.message || error);
                reject(error);
            });
            
            this.socket.on('disconnect', () => {
                console.log(`🔌 Motorista ${this.id} desconectado`);
                metrics.activeConnections.drivers--;
            });
            
            // Escutar notificações de corrida
            this.socket.on('newRideRequest', (data) => {
                const startTime = performance.now();
                metrics.events.driverNotification.count++;
                metrics.events.driverNotification.latencies.push(performance.now() - startTime);
                
                console.log(`📬 Motorista ${this.id} recebeu notificação: ${data.bookingId}`);
                
                // Simular aceitação/rejeição aleatória (70% aceita)
                if (Math.random() > 0.3) {
                    setTimeout(() => {
                        this.acceptRide(data);
                    }, Math.random() * 3000 + 1000); // 1-4 segundos
                } else {
                    setTimeout(() => {
                        this.rejectRide(data);
                    }, Math.random() * 2000 + 500); // 0.5-2.5 segundos
                }
            });
            
            this.socket.on('rideAccepted', (data) => {
                if (this.currentRide?.bookingId === data.bookingId) {
                    const latency = performance.now() - this.currentRide.acceptStartTime;
                    metrics.events.rideAccepted.latencies.push(latency);
                    metrics.events.rideAccepted.count++;
                    console.log(`✅ Motorista ${this.id} aceitou corrida: ${data.bookingId}`);
                }
            });
            
            this.socket.on('error', (error) => {
                console.error(`❌ Erro no motorista ${this.id}:`, error);
                metrics.events.driverNotification.errors++;
            });
        });
    }
    
    authenticate() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout na autenticação'));
            }, 10000);
            
            this.socket.once('authenticated', (data) => {
                clearTimeout(timeout);
                this.authenticated = true;
                console.log(`🔐 Motorista ${this.id} autenticado`);
                resolve();
            });
            
            this.socket.once('auth_error', (error) => {
                clearTimeout(timeout);
                reject(new Error(error.message || 'Erro na autenticação'));
            });
            
            this.socket.emit('authenticate', {
                uid: this.id,
                userType: 'driver',
                token: `test_token_${this.id}`,
            });
        });
    }
    
    setDriverStatus() {
        if (!this.authenticated) return;
        
        this.socket.emit('setDriverStatus', {
            status: 'online',
            carType: Math.random() > 0.5 ? 'Leaf Plus' : 'Leaf Elite',
        });
    }
    
    startLocationUpdates() {
        // Atualizar localização a cada 5 segundos
        setInterval(() => {
            if (!this.authenticated || !this.socket?.connected) return;
            
            // Mover localização ligeiramente (simular movimento)
            this.location.lat += (Math.random() - 0.5) * 0.001;
            this.location.lng += (Math.random() - 0.5) * 0.001;
            
            const startTime = performance.now();
            this.socket.emit('updateDriverLocation', {
                lat: this.location.lat,
                lng: this.location.lng,
                heading: Math.random() * 360,
                speed: Math.random() * 60,
            });
            
            const latency = performance.now() - startTime;
            metrics.events.locationUpdate.latencies.push(latency);
            metrics.events.locationUpdate.count++;
        }, 5000);
    }
    
    acceptRide(data) {
        if (this.currentRide) return; // Já tem uma corrida
        
        this.currentRide = {
            bookingId: data.bookingId,
            acceptStartTime: performance.now(),
        };
        
        this.socket.emit('acceptRide', {
            bookingId: data.bookingId,
            rideId: data.rideId || data.bookingId,
        });
        
        // Simular início e conclusão da viagem
        setTimeout(() => {
            if (this.currentRide?.bookingId === data.bookingId) {
                this.socket.emit('startTrip', {
                    bookingId: data.bookingId,
                    startLocation: this.location,
                });
            }
        }, 5000);
        
        setTimeout(() => {
            if (this.currentRide?.bookingId === data.bookingId) {
                this.socket.emit('completeTrip', {
                    bookingId: data.bookingId,
                    endLocation: this.location,
                    distance: 5.5,
                    fare: 25.50,
                });
                this.currentRide = null;
            }
        }, CONFIG.TRIP_DURATION_MS + 5000);
    }
    
    rejectRide(data) {
        this.socket.emit('rejectRide', {
            bookingId: data.bookingId,
            rideId: data.rideId || data.bookingId,
            reason: 'Motorista indisponível',
        });
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}

// ==================== EXECUÇÃO DO TESTE ====================

async function checkServerConnection() {
    try {
        console.log(`🔍 Verificando conexão com servidor VPS: ${CONFIG.WS_URL}...`);
        // Tentar conectar via Socket.IO para verificar se está ativo
        const testSocket = io(CONFIG.WS_URL, {
            transports: ['websocket', 'polling'],
            timeout: 5000,
            autoConnect: true,
        });
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                testSocket.disconnect();
                console.error(`❌ Timeout ao verificar servidor`);
                resolve(false);
            }, 5000);
            
            testSocket.on('connect', () => {
                clearTimeout(timeout);
                console.log(`✅ Servidor VPS acessível e respondendo`);
                testSocket.disconnect();
                resolve(true);
            });
            
            testSocket.on('connect_error', (error) => {
                clearTimeout(timeout);
                console.error(`❌ Servidor não acessível: ${error.message}`);
                console.error(`   Verifique se o servidor está rodando em ${CONFIG.WS_URL}`);
                testSocket.disconnect();
                resolve(false);
            });
        });
    } catch (error) {
        console.error(`❌ Erro ao verificar servidor: ${error.message}`);
        return false;
    }
}

async function runLoadTest() {
    console.log('🚀 Iniciando teste de carga...');
    console.log(`📊 Configuração:`);
    console.log(`   - Passageiros: ${CONFIG.NUM_PASSENGERS}`);
    console.log(`   - Motoristas: ${CONFIG.NUM_DRIVERS}`);
    console.log(`   - Taxa de corridas: ${CONFIG.RIDE_CREATION_RATE}/s`);
    console.log(`   - Duração: ${CONFIG.TEST_DURATION_MS / 1000}s`);
    console.log(`   - Servidor: ${CONFIG.WS_URL}`);
    
    // Verificar se servidor está acessível
    const serverAvailable = await checkServerConnection();
    if (!serverAvailable) {
        console.error('\n❌ Não foi possível conectar ao servidor. Abortando teste.');
        console.error('   Por favor, inicie o servidor antes de executar o teste:');
        console.error('   cd leaf-websocket-backend && npm start');
        process.exit(1);
    }
    
    metrics.startTime = Date.now();
    
    // Conectar motoristas com retry e rate limiting
    console.log('\n🔌 Conectando motoristas...');
    const driverConnections = [];
    for (let i = 0; i < CONFIG.NUM_DRIVERS; i++) {
        const driver = new DriverSimulator(i);
        drivers.push(driver);
        driverConnections.push(
            driver.connect().catch(error => {
                console.error(`❌ Falha ao conectar motorista ${i}:`, error.message || error);
                return null;
            })
        );
        // Rate limiting: conectar em batches de 10
        if ((i + 1) % 10 === 0) {
            await Promise.all(driverConnections.slice(-10));
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    await Promise.all(driverConnections);
    
    const connectedDrivers = drivers.filter(d => d.socket?.connected).length;
    console.log(`✅ ${connectedDrivers}/${CONFIG.NUM_DRIVERS} motoristas conectados`);
    
    if (connectedDrivers === 0) {
        console.error('\n❌ Nenhum motorista conseguiu conectar. Verifique o servidor.');
        process.exit(1);
    }
    
    // Conectar passageiros com retry e rate limiting
    console.log('\n🔌 Conectando passageiros...');
    const passengerConnections = [];
    for (let i = 0; i < CONFIG.NUM_PASSENGERS; i++) {
        const passenger = new PassengerSimulator(i);
        passengers.push(passenger);
        passengerConnections.push(
            passenger.connect().catch(error => {
                console.error(`❌ Falha ao conectar passageiro ${i}:`, error.message || error);
                return null;
            })
        );
        // Rate limiting: conectar em batches de 10
        if ((i + 1) % 10 === 0) {
            await Promise.all(passengerConnections.slice(-10));
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    await Promise.all(passengerConnections);
    
    const connectedPassengers = passengers.filter(p => p.socket?.connected).length;
    console.log(`✅ ${connectedPassengers}/${CONFIG.NUM_PASSENGERS} passageiros conectados`);
    
    if (connectedPassengers === 0) {
        console.error('\n❌ Nenhum passageiro conseguiu conectar. Verifique o servidor.');
        process.exit(1);
    }
    
    // Aguardar autenticação
    console.log('\n⏳ Aguardando autenticação...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Iniciar monitoramento do servidor
    const serverMonitorInterval = setInterval(async () => {
        const stats = await monitorServerResources();
        metrics.serverStats.push(stats);
    }, CONFIG.SERVER_MONITOR_INTERVAL);
    
    // Iniciar criação de corridas
    console.log('\n🚗 Iniciando criação de corridas...');
    const rideCreationInterval = setInterval(() => {
        // Selecionar passageiros aleatórios para criar corridas
        const availablePassengers = passengers.filter(p => 
            p.authenticated && 
            p.socket?.connected && 
            !p.activeBooking
        );
        
        if (availablePassengers.length > 0) {
            const numRides = Math.min(CONFIG.RIDE_CREATION_RATE, availablePassengers.length);
            for (let i = 0; i < numRides; i++) {
                const passenger = availablePassengers[Math.floor(Math.random() * availablePassengers.length)];
                passenger.createRide();
            }
        }
    }, 1000); // A cada segundo
    
    // Executar teste por duração configurada
    await new Promise(resolve => setTimeout(resolve, CONFIG.TEST_DURATION_MS));
    
    // Parar criação de corridas e monitoramento
    clearInterval(rideCreationInterval);
    clearInterval(serverMonitorInterval);
    
    console.log('\n⏹️  Finalizando teste...');
    
    // Aguardar corridas ativas terminarem
    await new Promise(resolve => setTimeout(resolve, CONFIG.TRIP_DURATION_MS + 10000));
    
    // Desconectar todos
    console.log('\n🔌 Desconectando clientes...');
    passengers.forEach(p => p.disconnect());
    drivers.forEach(d => d.disconnect());
    
    metrics.endTime = Date.now();
    
    // Gerar relatório
    console.log('\n📊 Gerando relatório...');
    const report = saveReport();
    printReport(report);
    
    console.log('\n✅ Teste de carga concluído!');
}

// ==================== EXECUTAR ====================

if (require.main === module) {
    runLoadTest().catch(error => {
        console.error('❌ Erro fatal no teste de carga:', error);
        process.exit(1);
    });
}

module.exports = { runLoadTest, PassengerSimulator, DriverSimulator };

