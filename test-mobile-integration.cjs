const io = require('socket.io-client');

console.log('📱 Testando integração mobile com nova estrutura...\n');

// Simular diferentes cenários do app mobile
const testScenarios = [
    {
        name: 'Android Emulator',
        url: 'http://216.238.107.59:3005',
        platform: 'android'
    },
    {
        name: 'iOS Simulator',
        url: 'http://216.238.107.59:3005',
        platform: 'ios'
    },
    {
        name: 'Dispositivo Físico',
        url: 'http://216.238.107.59:3005',
        platform: 'device'
    }
];

async function testMobileIntegration() {
    console.log('🚀 TESTE DE INTEGRAÇÃO MOBILE\n');
    
    const results = [];
    
    for (const scenario of testScenarios) {
        console.log(`📱 Testando: ${scenario.name}`);
        
        try {
            const start = Date.now();
            
            const socket = io(scenario.url, {
                transports: ['websocket'],
                timeout: 10000,
                forceNew: true,
                extraHeaders: {
                    'User-Agent': 'ReactNative',
                    'Platform': scenario.platform
                }
            });
            
            const result = await new Promise((resolve, reject) => {
                socket.on('connect', () => {
                    const duration = Date.now() - start;
                    console.log(`✅ ${scenario.name}: Conectado em ${duration}ms`);
                    
                    // Testar funcionalidades básicas
                    socket.emit('getStats');
                    
                    setTimeout(() => {
                        socket.disconnect();
                        resolve({ success: true, duration, socketId: socket.id });
                    }, 1000);
                });
                
                socket.on('connect_error', (error) => {
                    const duration = Date.now() - start;
                    console.log(`❌ ${scenario.name}: Erro em ${duration}ms - ${error.message}`);
                    socket.disconnect();
                    resolve({ success: false, duration, error: error.message });
                });
                
                setTimeout(() => {
                    socket.disconnect();
                    reject(new Error('Timeout'));
                }, 15000);
            });
            
            results.push({ ...result, scenario: scenario.name });
            
        } catch (error) {
            console.log(`❌ ${scenario.name}: Exceção - ${error.message}`);
            results.push({ success: false, scenario: scenario.name, error: error.message });
        }
    }
    
    // Resumo dos resultados
    console.log('\n📊 RESUMO DA INTEGRAÇÃO MOBILE:');
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const avgDuration = results.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / successful || 0;
    
    console.log(`✅ Sucessos: ${successful}`);
    console.log(`❌ Falhas: ${failed}`);
    console.log(`⏱️  Duração média: ${avgDuration.toFixed(1)}ms`);
    console.log(`📊 Taxa de sucesso: ${((successful / results.length) * 100).toFixed(1)}%`);
    
    if (successful === results.length) {
        console.log('\n🎉 SUCESSO TOTAL! App mobile integrado à nova estrutura!');
    } else {
        console.log('\n⚠️ Alguns cenários falharam. Verificar configurações.');
    }
    
    return results;
}

// Executar teste
testMobileIntegration().catch(console.error);
