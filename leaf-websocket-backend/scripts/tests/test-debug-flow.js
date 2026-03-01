/**
 * 🐛 TESTE DE DEBUG DO FLUXO DE CORRIDA
 * 
 * Teste simples para debugar o problema dos motoristas não receberem notificações
 */

const io = require('socket.io-client');

class DebugFlowTester {
    constructor() {
        this.baseUrl = 'http://localhost:3001';
        this.connections = new Map();
    }

    async runDebugTest() {
        console.log('🐛 INICIANDO TESTE DE DEBUG');
        console.log('='.repeat(40));
        
        try {
            // 1. Criar cliente
            const customer = await this.createCustomer();
            
            // 2. Criar motorista
            const driver = await this.createDriver();
            
            // 3. Aguardar conexões
            await this.delay(2000);
            
            // 4. Cliente solicita corrida
            console.log('\n🚗 Cliente solicitando corrida...');
            customer.socket.emit('createBooking', {
                customerId: customer.id,
                pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Origem' },
                destinationLocation: { lat: -23.5615, lng: -46.6553, address: 'Destino' },
                estimatedFare: 25.50,
                paymentMethod: 'PIX'
            });
            
            // 5. Aguardar eventos
            await this.delay(5000);
            
            // 6. Mostrar eventos recebidos
            console.log('\n📊 EVENTOS RECEBIDOS:');
            console.log('Cliente:', customer.events);
            console.log('Motorista:', driver.events);
            
        } catch (error) {
            console.error('❌ Erro no teste:', error);
        } finally {
            this.cleanup();
        }
    }

    async createCustomer() {
        const customerId = `debug_customer_${Date.now()}`;
        const socket = io(this.baseUrl, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout criando cliente'));
            }, 10000);

            socket.on('connect', () => {
                clearTimeout(timeout);
                
                const customer = {
                    id: customerId,
                    socket,
                    events: []
                };

                this.connections.set(customerId, customer);

                // Listeners
                socket.on('bookingCreated', (data) => {
                    customer.events.push({ type: 'bookingCreated', data, timestamp: Date.now() });
                    console.log('✅ Cliente: Corrida criada');
                });

                socket.on('paymentConfirmed', (data) => {
                    customer.events.push({ type: 'paymentConfirmed', data, timestamp: Date.now() });
                    console.log('💳 Cliente: Pagamento confirmado');
                });

                socket.on('rideAccepted', (data) => {
                    customer.events.push({ type: 'rideAccepted', data, timestamp: Date.now() });
                    console.log('✅ Cliente: Corrida aceita');
                });

                // Debug: capturar TODOS os eventos
                socket.onAny((eventName, ...args) => {
                    if (!['bookingCreated', 'paymentConfirmed', 'rideAccepted'].includes(eventName)) {
                        customer.events.push({ type: eventName, data: args, timestamp: Date.now() });
                        console.log(`🔍 Cliente recebeu evento: ${eventName}`);
                    }
                });

                console.log(`👤 Cliente conectado: ${socket.id}`);
                resolve(customer);
            });

            socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    async createDriver() {
        const driverId = `debug_driver_${Date.now()}`;
        const socket = io(this.baseUrl, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout criando motorista'));
            }, 10000);

            socket.on('connect', () => {
                clearTimeout(timeout);
                
                const driver = {
                    id: driverId,
                    socket,
                    events: []
                };

                this.connections.set(driverId, driver);

                // Listeners
                socket.on('rideRequest', (data) => {
                    driver.events.push({ type: 'rideRequest', data, timestamp: Date.now() });
                    console.log('📱 Motorista: Nova corrida recebida!');
                    
                    // Aceitar automaticamente
                    setTimeout(() => {
                        console.log('✅ Motorista: Aceitando corrida...');
                        socket.emit('driverResponse', {
                            bookingId: data.rideId,
                            accepted: true,
                            reason: null
                        });
                    }, 1000);
                });

                socket.on('rideAccepted', (data) => {
                    driver.events.push({ type: 'rideAccepted', data, timestamp: Date.now() });
                    console.log('✅ Motorista: Corrida aceita confirmada');
                });

                // Debug: capturar TODOS os eventos
                socket.onAny((eventName, ...args) => {
                    if (!['rideRequest', 'rideAccepted'].includes(eventName)) {
                        driver.events.push({ type: eventName, data: args, timestamp: Date.now() });
                        console.log(`🔍 Motorista recebeu evento: ${eventName}`);
                    }
                });

                console.log(`🚗 Motorista conectado: ${socket.id}`);
                resolve(driver);
            });

            socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    cleanup() {
        console.log('\n🧹 Limpando conexões...');
        this.connections.forEach((connection, id) => {
            if (connection.socket) {
                connection.socket.disconnect();
            }
        });
        this.connections.clear();
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Executar teste
if (require.main === module) {
    const tester = new DebugFlowTester();
    tester.runDebugTest().catch(console.error);
}

module.exports = DebugFlowTester;
