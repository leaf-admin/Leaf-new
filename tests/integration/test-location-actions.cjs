const { 
    saveUserLocation, 
    getUserLocation, 
    saveTracking, 
    getNearbyDrivers,
    startTripTracking,
    endTripTracking,
    getTripData
} = require('./common/src/actions/locationactions');

async function testLocationActions() {
    console.log('🧪 Testando Actions de Localização...\n');

    // Simular usuário autenticado
    const mockUser = {
        uid: 'test-user-123'
    };

    // Mock do Firebase auth
    const mockFirebase = {
        auth: {
            currentUser: mockUser
        }
    };

    // Substituir firebase global
    global.firebase = mockFirebase;

    try {
        // Teste 1: Salvar localização do usuário
        console.log('1️⃣ Testando saveUserLocation...');
        const userLocation = {
            lat: -22.9068,
            lng: -43.1729,
            at: Date.now()
        };

        await saveUserLocation(userLocation);
        console.log('✅ saveUserLocation executado com sucesso');

        // Teste 2: Obter localização do usuário
        console.log('\n2️⃣ Testando getUserLocation...');
        const retrievedLocation = await getUserLocation(mockUser.uid);
        if (retrievedLocation) {
            console.log('✅ getUserLocation:', retrievedLocation);
        } else {
            console.log('⚠️ getUserLocation retornou null');
        }

        // Teste 3: Buscar motoristas próximos
        console.log('\n3️⃣ Testando getNearbyDrivers...');
        const nearbyDrivers = await getNearbyDrivers(-22.9068, -43.1729, 5);
        console.log('✅ getNearbyDrivers:', nearbyDrivers.length, 'motoristas encontrados');

        // Teste 4: Tracking de viagem
        console.log('\n4️⃣ Testando tracking de viagem...');
        const tripId = 'test-trip-456';
        const driverId = 'driver-123';
        const passengerId = 'passenger-456';
        const initialLocation = { lat: -22.9068, lng: -43.1729 };

        // Iniciar tracking
        await startTripTracking(tripId, driverId, passengerId, initialLocation);
        console.log('✅ startTripTracking executado');

        // Salvar ponto de tracking
        const trackingPoint = {
            lat: -22.9100,
            lng: -43.1750,
            at: Date.now()
        };
        await saveTracking(tripId, trackingPoint);
        console.log('✅ saveTracking executado');

        // Obter dados da viagem
        const tripData = await getTripData(tripId);
        if (tripData) {
            console.log('✅ getTripData:', tripData);
        } else {
            console.log('⚠️ getTripData retornou null');
        }

        // Finalizar tracking
        const endLocation = { lat: -22.9150, lng: -43.1800 };
        await endTripTracking(tripId, endLocation);
        console.log('✅ endTripTracking executado');

        console.log('\n🎉 Todos os testes de actions concluídos com sucesso!');

    } catch (error) {
        console.error('❌ Erro nos testes:', error);
    }
}

// Executar testes
testLocationActions().catch(console.error); 