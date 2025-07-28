#!/usr/bin/env node

console.log('🧪 TESTE FINAL DAS APIs REDIS');
console.log('================================');

const https = require('https');

// Configuração
const BASE_URL = 'https://us-central1-leaf-reactnative.cloudfunctions.net';
const TIMEOUT = 30000; // 30 segundos

// Função para fazer requisição HTTPS
function makeRequest(endpoint, data = {}) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        const options = {
            hostname: 'us-central1-leaf-reactnative.cloudfunctions.net',
            port: 443,
            path: `/${endpoint}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: TIMEOUT
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    resolve({
                        status: res.statusCode,
                        data: parsed,
                        headers: res.headers
                    });
                } catch (error) {
                    resolve({
                        status: res.statusCode,
                        data: responseData,
                        error: 'Invalid JSON response'
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
    });
}

// Testes
async function testHealth() {
    console.log('\n🏥 Testando API Health...');
    try {
        const result = await makeRequest('health', {});
        console.log('✅ Health API:', result.status === 200 ? 'SUCESSO' : 'FALHOU');
        console.log('   Status:', result.status);
        console.log('   Response:', JSON.stringify(result.data, null, 2));
        return result.status === 200;
    } catch (error) {
        console.log('❌ Health API: ERRO');
        console.log('   Error:', error.message);
        return false;
    }
}

async function testRedisStats() {
    console.log('\n📊 Testando API Redis Stats...');
    try {
        const result = await makeRequest('get_redis_stats', {});
        console.log('✅ Redis Stats API:', result.status === 200 ? 'SUCESSO' : 'FALHOU');
        console.log('   Status:', result.status);
        console.log('   Response:', JSON.stringify(result.data, null, 2));
        return result.status === 200;
    } catch (error) {
        console.log('❌ Redis Stats API: ERRO');
        console.log('   Error:', error.message);
        return false;
    }
}

async function testNearbyDrivers() {
    console.log('\n🚗 Testando API Nearby Drivers...');
    try {
        const result = await makeRequest('get_nearby_drivers', {
            latitude: -23.5505,
            longitude: -46.6333,
            radius: 5
        });
        console.log('✅ Nearby Drivers API:', result.status === 200 ? 'SUCESSO' : 'FALHOU');
        console.log('   Status:', result.status);
        console.log('   Response:', JSON.stringify(result.data, null, 2));
        return result.status === 200;
    } catch (error) {
        console.log('❌ Nearby Drivers API: ERRO');
        console.log('   Error:', error.message);
        return false;
    }
}

async function testUpdateUserLocation() {
    console.log('\n📍 Testando API Update User Location...');
    try {
        const result = await makeRequest('update_user_location', {
            userId: 'test-user-123',
            latitude: -23.5505,
            longitude: -46.6333,
            timestamp: Date.now()
        });
        console.log('✅ Update User Location API:', result.status === 200 ? 'SUCESSO' : 'FALHOU');
        console.log('   Status:', result.status);
        console.log('   Response:', JSON.stringify(result.data, null, 2));
        return result.status === 200;
    } catch (error) {
        console.log('❌ Update User Location API: ERRO');
        console.log('   Error:', error.message);
        return false;
    }
}

async function testStartTripTracking() {
    console.log('\n🚀 Testando API Start Trip Tracking...');
    try {
        const result = await makeRequest('start_trip_tracking', {
            tripId: 'test-trip-123',
            driverId: 'driver-123',
            passengerId: 'passenger-123',
            initialLocation: {
                latitude: -23.5505,
                longitude: -46.6333
            }
        });
        console.log('✅ Start Trip Tracking API:', result.status === 200 ? 'SUCESSO' : 'FALHOU');
        console.log('   Status:', result.status);
        console.log('   Response:', JSON.stringify(result.data, null, 2));
        return result.status === 200;
    } catch (error) {
        console.log('❌ Start Trip Tracking API: ERRO');
        console.log('   Error:', error.message);
        return false;
    }
}

async function runAllTests() {
    console.log('🚀 Iniciando testes das APIs Redis...');
    console.log('⏱️  Timeout configurado:', TIMEOUT / 1000, 'segundos');
    
    const tests = [
        { name: 'Health', fn: testHealth },
        { name: 'Redis Stats', fn: testRedisStats },
        { name: 'Nearby Drivers', fn: testNearbyDrivers },
        { name: 'Update User Location', fn: testUpdateUserLocation },
        { name: 'Start Trip Tracking', fn: testStartTripTracking }
    ];

    const results = [];
    
    for (const test of tests) {
        console.log(`\n🔄 Executando teste: ${test.name}`);
        const success = await test.fn();
        results.push({ name: test.name, success });
        
        // Aguardar um pouco entre os testes
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Resumo
    console.log('\n📊 RESUMO DOS TESTES');
    console.log('====================');
    
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    
    results.forEach(result => {
        const status = result.success ? '✅' : '❌';
        console.log(`${status} ${result.name}: ${result.success ? 'PASSOU' : 'FALHOU'}`);
    });
    
    console.log(`\n🎯 RESULTADO FINAL: ${passed}/${total} APIs funcionando`);
    
    if (passed === total) {
        console.log('🎉 TODAS AS APIs REDIS ESTÃO OPERACIONAIS!');
        console.log('✅ Sistema 100% pronto para produção!');
    } else if (passed > 0) {
        console.log('⚠️  Algumas APIs estão funcionando, outras precisam de ajustes');
    } else {
        console.log('❌ APIs Redis precisam de verificação');
    }
    
    return passed === total;
}

// Executar testes
if (require.main === module) {
    runAllTests()
        .then(success => {
            console.log(`\n🏁 Teste finalizado com ${success ? 'SUCESSO' : 'FALHAS'}`);
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('💥 Erro durante os testes:', error);
            process.exit(1);
        });
}

module.exports = { runAllTests }; 