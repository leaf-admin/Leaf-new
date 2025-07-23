const firebaseConfig = require('./firebase-config');

async function testFirebase() {
    console.log('🧪 Testando Firebase apenas...');
    console.log('=' .repeat(50));

    try {
        // 1. Inicializar Firebase
        console.log('1️⃣ Inicializando Firebase...');
        const app = firebaseConfig.initializeFirebase();
        console.log('✅ Firebase inicializado:', app ? 'SUCESSO' : 'FALHA');

        // 2. Testar sincronização de viagem
        console.log('\n2️⃣ Testando sincronização de viagem...');
        const testTripData = {
            tripId: 'test_trip_123',
            driverId: 'test_driver_123',
            startTime: Date.now() - 300000,
            endTime: Date.now(),
            startLocation: { lat: -23.5505, lng: -46.6333 },
            endLocation: { lat: -23.5605, lng: -46.6433 },
            distance: 1500,
            fare: 15.50,
            status: 'completed',
            completedAt: new Date().toISOString(),
            driverLocation: { lat: -23.5505, lng: -46.6333 }
        };

        const result = await firebaseConfig.syncTripData('test_trip_123', testTripData);
        console.log('✅ Sincronização de viagem:', result ? 'SUCESSO' : 'FALHA');

        // 3. Testar leitura de dados
        console.log('\n3️⃣ Testando leitura de dados...');
        const readData = await firebaseConfig.getFromFirestore('trips', 'test_trip_123');
        console.log('✅ Leitura de dados:', readData ? 'SUCESSO' : 'FALHA');
        if (readData) {
            console.log('📊 Dados lidos:', JSON.stringify(readData, null, 2));
        }

        console.log('\n🎉 Teste do Firebase concluído com sucesso!');

    } catch (error) {
        console.error('❌ Erro no teste do Firebase:', error.message);
        console.error('❌ Stack trace:', error.stack);
    }
}

// Executar teste
testFirebase().then(() => {
    console.log('\n🏁 Teste finalizado');
    process.exit(0);
}).catch((error) => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
}); 