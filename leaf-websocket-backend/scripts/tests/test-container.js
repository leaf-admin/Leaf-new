console.log('Testando Ride Service otimizado no container...');
try {
    const RideService = require('./services/ride-service');
    const rideService = new RideService();
    console.log('Ride Service instanciado com sucesso!');
    console.log('Estatisticas:', JSON.stringify(rideService.getStats(), null, 2));
} catch(e) {
    console.log('Erro:', e.message);
}
