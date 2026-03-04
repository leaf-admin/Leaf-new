require('dotenv').config();

// Sobrescrever variáveis de ambiente para teste (Ponto: Praça da Sé, SP, Raio: 10km)
process.env.GEOFENCE_LAT = '-23.550520';
process.env.GEOFENCE_LNG = '-46.633308';
process.env.GEOFENCE_RADIUS_KM = '10';

const RequestRideCommand = require('./commands/RequestRideCommand');

async function testGeofence() {
    console.log(`Configuração: Centro ${process.env.GEOFENCE_LAT}, ${process.env.GEOFENCE_LNG} | Raio: ${process.env.GEOFENCE_RADIUS_KM}km\n`);

    // TESTE 1: Dentro da área (Av Paulista, SP)
    try {
        console.log('--- TESTE 1: Origem Permitida (Av Paulista - ~2.5km do centro) ---');
        const cmd1 = new RequestRideCommand({
            customerId: 'customer-1',
            pickupLocation: { lat: -23.561, lng: -46.655 },
            destinationLocation: { lat: -23.60, lng: -46.69 },
            estimatedFare: 20
        });
        cmd1.validate(); // Isso deve passar
        console.log('✅ SUCESSO! Passou na validação.');
    } catch (e) {
        console.error('❌ ERRO INESPERADO:', e.message);
    }

    console.log('\n');

    // TESTE 2: Fora da área (Campinas, SP -> ~90km)
    try {
        console.log('--- TESTE 2: Origem Fora da Área (Campinas - ~90km do centro) ---');
        const cmd2 = new RequestRideCommand({
            customerId: 'customer-2',
            pickupLocation: { lat: -22.9099, lng: -47.0626 },
            destinationLocation: { lat: -23.60, lng: -46.69 },
            estimatedFare: 150
        });
        cmd2.validate(); // Isso de falhar
        console.log('❌ ERRO INESPERADO: Validação deveria ter falhado!');
    } catch (e) {
        console.log('✅ SUCESSO ESPERADO:', e.message);
    }
}

testGeofence();
