require('dotenv').config();

const RequestRideCommand = require('./commands/RequestRideCommand');

// Limpar vars de bypass
process.env.GEOFENCE_RADIUS_KM = undefined;
process.env.BYPASS_GEOFENCE = undefined;

async function testPolygonGeofence() {
    console.log(`Verificando restrições contra config/geofence.json (Região Capital do RJ)...\n`);

    // TESTE 1: Dentro do Polígono (Barra da Tijuca/Copacabana - RJ)
    try {
        console.log('--- TESTE 1: Origem Permitida (Rio de Janeiro/RJ) ---');
        const cmd1 = new RequestRideCommand({
            customerId: 'customer-rj-1',
            pickupLocation: { lat: -22.970722, lng: -43.182365 }, // Copacabana
            destinationLocation: { lat: -22.911667, lng: -43.205278 },
            estimatedFare: 20
        });
        cmd1.validate(); // Isso deve passar
        console.log('✅ SUCESSO! Passou na validação.');
    } catch (e) {
        console.error('❌ ERRO INESPERADO:', e.message);
    }

    console.log('\n');

    // TESTE 2: Fora do Polígono (Niterói - Muito perto, mas geometricamente fora do limite)
    try {
        console.log('--- TESTE 2: Origem Fora da Área (Niterói/RJ) ---');
        const cmd2 = new RequestRideCommand({
            customerId: 'customer-rj-2',
            pickupLocation: { lat: -22.8833, lng: -43.1036 }, // Niterói, outro município além da baía
            destinationLocation: { lat: -22.970, lng: -43.182 },
            estimatedFare: 50
        });
        cmd2.validate(); // Isso deve falhar
        console.log('❌ ERRO INESPERADO: Validação deveria ter falhado!');
    } catch (e) {
        console.log('✅ SUCESSO ESPERADO:', e.message);
    }

    console.log('\n');

    // TESTE 3: Fora do Polígono (Sāo Paulo - SP)
    try {
        console.log('--- TESTE 3: Origem Remota (São Paulo/SP) ---');
        const cmd3 = new RequestRideCommand({
            customerId: 'customer-sp-1',
            pickupLocation: { lat: -23.5505, lng: -46.6333 }, // SP
            destinationLocation: { lat: -23.5505, lng: -46.6333 },
            estimatedFare: 15
        });
        cmd3.validate(); // Isso deve falhar
        console.log('❌ ERRO INESPERADO: Validação deveria ter falhado!');
    } catch (e) {
        console.log('✅ SUCESSO ESPERADO:', e.message);
    }
}

testPolygonGeofence();
