const { fetchNearbyDrivers } = require('./common/src/actions/usersactions');

async function testNearbyDrivers() {
    console.log('🧪 Testando busca de motoristas próximos otimizada');
    console.log('================================================');
    
    const testLocation = {
        lat: -23.5505, // São Paulo
        lng: -46.6333,
        radius: 5 // 5km
    };
    
    console.log('📍 Localização de teste:', testLocation);
    
    try {
        // Teste 1: Busca com Redis habilitado
        console.log('\n1️⃣ Testando busca com Redis...');
        const startTime = Date.now();
        
        const drivers = await fetchNearbyDrivers(
            testLocation.lat, 
            testLocation.lng, 
            testLocation.radius,
            { appType: 'app' }
        );
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log('✅ Resultado:');
        console.log(`   - Motoristas encontrados: ${drivers.length}`);
        console.log(`   - Tempo de busca: ${duration}ms`);
        console.log(`   - Fonte: ${drivers[0]?.source || 'N/A'}`);
        
        if (drivers.length > 0) {
            console.log('   - Motorista mais próximo:', {
                id: drivers[0].id,
                distance: drivers[0].distance?.toFixed(2) + 'km',
                carType: drivers[0].carType
            });
        }
        
        // Teste 2: Performance comparativa
        console.log('\n2️⃣ Teste de performance...');
        const iterations = 5;
        const times = [];
        
        for (let i = 0; i < iterations; i++) {
            const start = Date.now();
            await fetchNearbyDrivers(testLocation.lat, testLocation.lng, testLocation.radius);
            const end = Date.now();
            times.push(end - start);
        }
        
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        
        console.log('📊 Estatísticas de performance:');
        console.log(`   - Média: ${avgTime.toFixed(0)}ms`);
        console.log(`   - Mínimo: ${minTime}ms`);
        console.log(`   - Máximo: ${maxTime}ms`);
        
        // Teste 3: Diferentes raios
        console.log('\n3️⃣ Testando diferentes raios...');
        const radii = [1, 3, 5, 10];
        
        for (const radius of radii) {
            const start = Date.now();
            const driversInRadius = await fetchNearbyDrivers(
                testLocation.lat, 
                testLocation.lng, 
                radius
            );
            const end = Date.now();
            
            console.log(`   - Raio ${radius}km: ${driversInRadius.length} motoristas em ${end - start}ms`);
        }
        
        console.log('\n✅ Teste concluído com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro no teste:', error);
    }
}

// Executar teste se chamado diretamente
if (require.main === module) {
    testNearbyDrivers();
}

module.exports = { testNearbyDrivers }; 