const io = require('socket.io-client');

const SOCKET_URL = 'http://216.238.107.59:3005';

console.log('🗺️ Iniciando validação de Redis e Geofuncionalidades...\n');

// Função para testar funcionalidade
async function testGeoFunctionality(name, testFunction) {
    try {
        const start = Date.now();
        const result = await testFunction();
        const duration = Date.now() - start;
        
        console.log(`✅ ${name}: ${duration}ms`);
        return { success: true, duration, result };
        
    } catch (error) {
        console.log(`❌ ${name}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Função principal de teste
async function runGeoTests() {
    console.log('🚀 TESTE 3: Redis e Geofuncionalidades\n');
    
    const results = [];
    
    // Teste 1: Múltiplos motoristas com localizações diferentes
    results.push(await testGeoFunctionality('Múltiplos Motoristas - Localizações', async () => {
        return new Promise((resolve, reject) => {
            const motoristas = [];
            const totalMotoristas = 3; // Reduzido para 3 para teste mais rápido
            let motoristasConectados = 0;
            
            // Criar múltiplos motoristas
            for (let i = 0; i < totalMotoristas; i++) {
                const socket = io(SOCKET_URL, {
                    transports: ['websocket'],
                    timeout: 10000
                });
                
                socket.on('connect', () => {
                    const lat = -23.5505 + (Math.random() - 0.5) * 0.01;
                    const lng = -46.6333 + (Math.random() - 0.5) * 0.01;
                    
                    socket.emit('updateLocation', { lat, lng });
                    
                    motoristas.push({ socket, lat, lng, id: `driver_${i}` });
                    motoristasConectados++;
                    
                    if (motoristasConectados === totalMotoristas) {
                        setTimeout(() => {
                            const testSocket = io(SOCKET_URL, {
                                transports: ['websocket'],
                                timeout: 10000
                            });
                            
                            testSocket.on('connect', () => {
                                testSocket.emit('findNearbyDrivers', {
                                    lat: -23.5505,
                                    lng: -46.6333,
                                    radius: 5000,
                                    limit: 10
                                });
                            });
                            
                            testSocket.on('nearbyDrivers', (data) => {
                                motoristas.forEach(m => m.socket.disconnect());
                                testSocket.disconnect();
                                
                                resolve({
                                    motoristasConectados: totalMotoristas,
                                    motoristasEncontrados: data.count,
                                    drivers: data.drivers
                                });
                            });
                            
                            testSocket.on('connect_error', reject);
                            
                        }, 2000);
                    }
                });
                
                socket.on('connect_error', reject);
            }
            
            setTimeout(() => reject(new Error('Timeout')), 30000);
        });
    }));
    
    // Teste 2: Atualizações de localização em tempo real
    results.push(await testGeoFunctionality('Atualizações em Tempo Real', async () => {
        return new Promise((resolve, reject) => {
            const socket = io(SOCKET_URL, {
                transports: ['websocket'],
                timeout: 10000
            });
            
            let updates = 0;
            const maxUpdates = 3;
            
            socket.on('connect', () => {
                socket.emit('updateLocation', { lat: -23.5505, lng: -46.6333 });
            });
            
            socket.on('locationUpdated', (data) => {
                updates++;
                
                if (updates < maxUpdates) {
                    const lat = -23.5505 + (Math.random() - 0.5) * 0.005;
                    const lng = -46.6333 + (Math.random() - 0.5) * 0.005;
                    
                    setTimeout(() => {
                        socket.emit('updateLocation', { lat, lng });
                    }, 500);
                } else {
                    socket.disconnect();
                    resolve({ updates, success: true });
                }
            });
            
            socket.on('locationError', (data) => {
                socket.disconnect();
                reject(new Error(data.error));
            });
            
            socket.on('connect_error', reject);
            
            setTimeout(() => reject(new Error('Timeout')), 30000);
        });
    }));
    
    // Teste 3: Performance com múltiplas buscas simultâneas
    results.push(await testGeoFunctionality('Performance - Múltiplas Buscas', async () => {
        return new Promise((resolve, reject) => {
            const buscas = [];
            const totalBuscas = 5; // Reduzido para 5
            let buscasCompletadas = 0;
            const startTime = Date.now();
            
            for (let i = 0; i < totalBuscas; i++) {
                const socket = io(SOCKET_URL, {
                    transports: ['websocket'],
                    timeout: 10000
                });
                
                socket.on('connect', () => {
                    const lat = -23.5505 + (Math.random() - 0.5) * 0.01;
                    const lng = -46.6333 + (Math.random() - 0.5) * 0.01;
                    
                    socket.emit('findNearbyDrivers', {
                        lat, lng, radius: 5000, limit: 10
                    });
                });
                
                socket.on('nearbyDrivers', (data) => {
                    buscasCompletadas++;
                    socket.disconnect();
                    
                    if (buscasCompletadas === totalBuscas) {
                        const duration = Date.now() - startTime;
                        resolve({
                            totalBuscas,
                            buscasCompletadas,
                            duration,
                            performance: (totalBuscas / (duration / 1000)).toFixed(1) + ' buscas/s'
                        });
                    }
                });
                
                socket.on('connect_error', reject);
            }
            
            setTimeout(() => reject(new Error('Timeout')), 30000);
        });
    }));
    
    // Resumo dos resultados
    console.log('\n📊 RESUMO DOS TESTES GEO:');
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const avgDuration = results.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / successful || 0;
    
    console.log(`✅ Sucessos: ${successful}`);
    console.log(`❌ Falhas: ${failed}`);
    console.log(`⏱️  Duração média: ${avgDuration.toFixed(1)}ms`);
    console.log(`📊 Taxa de sucesso: ${((successful / results.length) * 100).toFixed(1)}%`);
    
    return results;
}

// Executar testes
runGeoTests().catch(console.error);
