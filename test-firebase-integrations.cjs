const io = require('socket.io-client');

const SOCKET_URL = 'http://216.238.107.59:3005';

console.log('🔥 Iniciando validação de Firebase e Integrações...\n');

// Função para testar funcionalidade
async function testFirebaseFunctionality(name, testFunction) {
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
async function runFirebaseTests() {
    console.log('🚀 TESTE 4: Firebase e Integrações\n');
    
    const results = [];
    
    // Teste 1: Criação de reserva com sincronização Firebase
    results.push(await testFirebaseFunctionality('Criação de Reserva + Firebase', async () => {
        return new Promise((resolve, reject) => {
            const socket = io(SOCKET_URL, {
                transports: ['websocket'],
                timeout: 10000
            });
            
            socket.on('connect', () => {
                // Criar reserva que deve sincronizar com Firebase
                socket.emit('createBooking', {
                    pickup: { lat: -23.5489, lng: -46.6388 },
                    destination: { lat: -23.5521, lng: -46.6313 },
                    userId: 'test_firebase_user',
                    driverId: null
                });
            });
            
            socket.on('bookingCreated', (data) => {
                socket.disconnect();
                resolve({
                    bookingId: data.bookingId,
                    success: data.success,
                    firebaseSync: 'Verificar logs do servidor'
                });
            });
            
            socket.on('bookingError', (data) => {
                socket.disconnect();
                reject(new Error(data.error));
            });
            
            socket.on('connect_error', reject);
            
            setTimeout(() => reject(new Error('Timeout')), 10000);
        });
    }));
    
    // Teste 2: Atualização de localização com sincronização Firebase
    results.push(await testFirebaseFunctionality('Localização + Firebase Sync', async () => {
        return new Promise((resolve, reject) => {
            const socket = io(SOCKET_URL, {
                transports: ['websocket'],
                timeout: 10000
            });
            
            let updates = 0;
            const maxUpdates = 3;
            
            socket.on('connect', () => {
                // Primeira atualização
                socket.emit('updateLocation', { lat: -23.5505, lng: -46.6333 });
            });
            
            socket.on('locationUpdated', (data) => {
                updates++;
                
                if (updates < maxUpdates) {
                    // Atualizar com nova localização
                    const lat = -23.5505 + (Math.random() - 0.5) * 0.005;
                    const lng = -46.6333 + (Math.random() - 0.5) * 0.005;
                    
                    setTimeout(() => {
                        socket.emit('updateLocation', { lat, lng });
                    }, 1000);
                } else {
                    socket.disconnect();
                    resolve({ updates, firebaseSync: 'Verificar logs do servidor' });
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
    
    // Teste 3: Múltiplas operações simultâneas (teste de batch)
    results.push(await testFirebaseFunctionality('Operações em Batch', async () => {
        return new Promise((resolve, reject) => {
            const operacoes = [];
            const totalOperacoes = 5;
            let operacoesCompletadas = 0;
            
            // Criar múltiplas operações simultâneas
            for (let i = 0; i < totalOperacoes; i++) {
                const socket = io(SOCKET_URL, {
                    transports: ['websocket'],
                    timeout: 10000
                });
                
                socket.on('connect', () => {
                    // Atualizar localização (deve sincronizar com Firebase)
                    const lat = -23.5505 + (Math.random() - 0.5) * 0.01;
                    const lng = -46.6333 + (Math.random() - 0.5) * 0.01;
                    
                    socket.emit('updateLocation', { lat, lng });
                });
                
                socket.on('locationUpdated', (data) => {
                    operacoesCompletadas++;
                    socket.disconnect();
                    
                    if (operacoesCompletadas === totalOperacoes) {
                        resolve({
                            totalOperacoes,
                            operacoesCompletadas,
                            firebaseSync: 'Verificar logs do servidor para batch operations'
                        });
                    }
                });
                
                socket.on('connect_error', reject);
            }
            
            setTimeout(() => reject(new Error('Timeout')), 30000);
        });
    }));
    
    // Teste 4: Verificação de health check do Firebase
    results.push(await testFirebaseFunctionality('Health Check Firebase', async () => {
        return new Promise((resolve, reject) => {
            const socket = io(SOCKET_URL, {
                transports: ['websocket'],
                timeout: 10000
            });
            
            socket.on('connect', () => {
                // Fazer uma operação simples para verificar se Firebase está funcionando
                socket.emit('getStats');
            });
            
            socket.on('stats', (data) => {
                socket.disconnect();
                resolve({
                    stats: data,
                    firebaseStatus: 'Verificar logs do servidor para status do Firebase'
                });
            });
            
            socket.on('connect_error', reject);
            
            setTimeout(() => reject(new Error('Timeout')), 10000);
        });
    }));
    
    // Resumo dos resultados
    console.log('\n📊 RESUMO DOS TESTES FIREBASE:');
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const avgDuration = results.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / successful || 0;
    
    console.log(`✅ Sucessos: ${successful}`);
    console.log(`❌ Falhas: ${failed}`);
    console.log(`⏱️  Duração média: ${avgDuration.toFixed(1)}ms`);
    console.log(`📊 Taxa de sucesso: ${((successful / results.length) * 100).toFixed(1)}%`);
    
    console.log('\n🔍 IMPORTANTE: Verificar logs do servidor para confirmar sincronização Firebase');
    
    return results;
}

// Executar testes
runFirebaseTests().catch(console.error);
