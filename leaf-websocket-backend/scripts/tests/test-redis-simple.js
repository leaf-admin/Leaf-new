console.log('Testando Redis Pool...');
try {
    const redisPool = require('./utils/redis-pool');
    console.log('Redis Pool criado com sucesso!');
} catch(e) {
    console.log('Erro:', e.message);
}
