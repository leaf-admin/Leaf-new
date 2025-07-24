console.log('🚀 Testando imports...');

try {
    console.log('1. Importando redisConfig...');
    const { FEATURE_FLAGS } = await import('./common/src/config/redisConfig.mjs');
    console.log('✅ redisConfig importado:', FEATURE_FLAGS.USE_REDIS_LOCATION);
} catch (error) {
    console.error('❌ Erro ao importar redisConfig:', error.message);
}

try {
    console.log('2. Importando redisLocationService...');
    const redisLocationService = await import('./common/src/services/redisLocationService.mjs');
    console.log('✅ redisLocationService importado');
} catch (error) {
    console.error('❌ Erro ao importar redisLocationService:', error.message);
}

try {
    console.log('3. Importando redisTrackingService...');
    const redisTrackingService = await import('./common/src/services/redisTrackingService.mjs');
    console.log('✅ redisTrackingService importado');
} catch (error) {
    console.error('❌ Erro ao importar redisTrackingService:', error.message);
}

console.log('🎯 Teste de imports concluído'); 