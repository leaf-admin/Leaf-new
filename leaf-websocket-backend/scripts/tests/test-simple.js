console.log('Testando Ride Service...');
try {
    const RideService = require('./services/ride-service');
    console.log('Ride Service carregado com sucesso!');
} catch(e) {
    console.log('Erro:', e.message);
}
