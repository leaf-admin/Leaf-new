const axios = require('axios');

// Configuração
const BASE_URL = 'http://localhost:5001/your-project/us-central1'; // Ajuste para seu projeto
const TEST_TOKEN = 'your-test-token'; // Token de teste do Firebase

// Headers padrão
const headers = {
    'Authorization': `Bearer ${TEST_TOKEN}`,
    'Content-Type': 'application/json'
};

// Função para fazer requisições
async function makeRequest(method, endpoint, data = null) {
    try {
        const config = {
            method,
            url: `${BASE_URL}${endpoint}`,
            headers,
            data
        };

        console.log(`\n🔍 ${method.toUpperCase()} ${endpoint}`);
        if (data) {
            console.log('📤 Request Data:', JSON.stringify(data, null, 2));
        }

        const response = await axios(config);
        
        console.log('✅ Response Status:', response.status);
        console.log('📥 Response Data:', JSON.stringify(response.data, null, 2));
        
        return response.data;
    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
        return null;
    }
}

// Teste 1: Estatísticas do Redis
async function testRedisStats() {
    console.log('\n🧪 Teste 1: Estatísticas do Redis');
    console.log('=====================================');
    
    await makeRequest('GET', '/get_redis_stats');
}

// Teste 2: Salvar localização do usuário
async function testSaveUserLocation() {
    console.log('\n🧪 Teste 2: Salvar Localização do Usuário');
    console.log('============================================');
    
    const locationData = {
        lat: -22.9068,
        lng: -43.1729,
        timestamp: Date.now()
    };
    
    await makeRequest('POST', '/save_user_location', locationData);
}

// Teste 3: Obter localização do usuário
async function testGetUserLocation() {
    console.log('\n🧪 Teste 3: Obter Localização do Usuário');
    console.log('===========================================');
    
    await makeRequest('GET', '/get_user_location');
}

// Teste 4: Buscar usuários próximos
async function testGetNearbyUsers() {
    console.log('\n🧪 Teste 4: Buscar Usuários Próximos');
    console.log('======================================');
    
    const params = new URLSearchParams({
        lat: -22.9068,
        lng: -43.1729,
        radius: 5,
        limit: 10,
        userType: 'driver'
    });
    
    await makeRequest('GET', `/get_nearby_users?${params}`);
}

// Teste 5: Iniciar tracking de viagem
async function testStartTripTracking() {
    console.log('\n🧪 Teste 5: Iniciar Tracking de Viagem');
    console.log('=========================================');
    
    const tripData = {
        tripId: 'test-trip-123',
        driverId: 'driver-456',
        passengerId: 'passenger-789',
        initialLocation: {
            lat: -22.9068,
            lng: -43.1729
        }
    };
    
    await makeRequest('POST', '/start_trip_tracking', tripData);
}

// Teste 6: Atualizar localização da viagem
async function testUpdateTripLocation() {
    console.log('\n🧪 Teste 6: Atualizar Localização da Viagem');
    console.log('==============================================');
    
    const locationData = {
        tripId: 'test-trip-123',
        lat: -22.9100,
        lng: -43.1750,
        timestamp: Date.now()
    };
    
    await makeRequest('POST', '/update_trip_location', locationData);
}

// Teste 7: Obter dados da viagem
async function testGetTripData() {
    console.log('\n🧪 Teste 7: Obter Dados da Viagem');
    console.log('====================================');
    
    await makeRequest('GET', '/get_trip_data?tripId=test-trip-123');
}

// Teste 8: Finalizar tracking de viagem
async function testEndTripTracking() {
    console.log('\n🧪 Teste 8: Finalizar Tracking de Viagem');
    console.log('===========================================');
    
    const endData = {
        tripId: 'test-trip-123',
        endLocation: {
            lat: -22.9200,
            lng: -43.1800
        }
    };
    
    await makeRequest('POST', '/end_trip_tracking', endData);
}

// Teste 9: Cenário completo de viagem
async function testCompleteTripScenario() {
    console.log('\n🧪 Teste 9: Cenário Completo de Viagem');
    console.log('=========================================');
    
    const tripId = `trip-${Date.now()}`;
    
    // 1. Iniciar viagem
    console.log('\n📍 1. Iniciando viagem...');
    await makeRequest('POST', '/start_trip_tracking', {
        tripId,
        driverId: 'driver-test',
        passengerId: 'passenger-test',
        initialLocation: { lat: -22.9068, lng: -43.1729 }
    });
    
    // 2. Atualizar localizações
    console.log('\n📍 2. Atualizando localizações...');
    const locations = [
        { lat: -22.9100, lng: -43.1750 },
        { lat: -22.9150, lng: -43.1770 },
        { lat: -22.9200, lng: -43.1800 }
    ];
    
    for (let i = 0; i < locations.length; i++) {
        console.log(`   Atualização ${i + 1}/${locations.length}`);
        await makeRequest('POST', '/update_trip_location', {
            tripId,
            ...locations[i],
            timestamp: Date.now() + (i * 60000) // 1 minuto entre cada atualização
        });
        
        // Aguardar um pouco entre as atualizações
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 3. Obter dados da viagem
    console.log('\n📍 3. Obtendo dados da viagem...');
    await makeRequest('GET', `/get_trip_data?tripId=${tripId}`);
    
    // 4. Finalizar viagem
    console.log('\n📍 4. Finalizando viagem...');
    await makeRequest('POST', '/end_trip_tracking', {
        tripId,
        endLocation: locations[locations.length - 1]
    });
    
    // 5. Verificar dados finais
    console.log('\n📍 5. Verificando dados finais...');
    await makeRequest('GET', `/get_trip_data?tripId=${tripId}`);
}

// Teste 10: Teste de performance
async function testPerformance() {
    console.log('\n🧪 Teste 10: Teste de Performance');
    console.log('===================================');
    
    const startTime = Date.now();
    const iterations = 10;
    
    console.log(`Executando ${iterations} requisições de localização...`);
    
    for (let i = 0; i < iterations; i++) {
        const locationData = {
            lat: -22.9068 + (Math.random() * 0.01),
            lng: -43.1729 + (Math.random() * 0.01),
            timestamp: Date.now()
        };
        
        await makeRequest('POST', '/save_user_location', locationData);
        
        // Aguardar um pouco entre as requisições
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const avgTime = totalTime / iterations;
    
    console.log(`\n📊 Resultados de Performance:`);
    console.log(`   Total de requisições: ${iterations}`);
    console.log(`   Tempo total: ${totalTime}ms`);
    console.log(`   Tempo médio por requisição: ${avgTime.toFixed(2)}ms`);
    console.log(`   Requisições por segundo: ${(1000 / avgTime).toFixed(2)}`);
}

// Função principal
async function runAllTests() {
    console.log('🚀 Iniciando Testes das APIs Redis');
    console.log('===================================');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Token: ${TEST_TOKEN.substring(0, 20)}...`);
    
    try {
        // Testes básicos
        await testRedisStats();
        await testSaveUserLocation();
        await testGetUserLocation();
        await testGetNearbyUsers();
        
        // Testes de tracking
        await testStartTripTracking();
        await testUpdateTripLocation();
        await testGetTripData();
        await testEndTripTracking();
        
        // Testes avançados
        await testCompleteTripScenario();
        await testPerformance();
        
        console.log('\n✅ Todos os testes concluídos!');
        
    } catch (error) {
        console.error('\n❌ Erro durante os testes:', error);
    }
}

// Executar testes se o arquivo for executado diretamente
if (require.main === module) {
    runAllTests();
}

module.exports = {
    makeRequest,
    testRedisStats,
    testSaveUserLocation,
    testGetUserLocation,
    testGetNearbyUsers,
    testStartTripTracking,
    testUpdateTripLocation,
    testGetTripData,
    testEndTripTracking,
    testCompleteTripScenario,
    testPerformance,
    runAllTests
}; 