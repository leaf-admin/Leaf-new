/**
 * Script de teste para validar dependências necessárias
 * para o script de população OSM do cache Places
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const { normalizeQuery } = require('../utils/places-normalizer');
const fetch = require('node-fetch');

async function testDependencies() {
  console.log('🧪 Testando dependências...\n');
  
  let allTestsPassed = true;

  // Teste 1: Redis Pool
  console.log('1️⃣ Testando Redis Pool...');
  try {
    const redis = redisPool.getConnection();
    if (!redis) {
      throw new Error('Redis Pool não retornou conexão');
    }
    console.log('   ✅ Redis Pool disponível');
    
    // Testar ping
    const pingResult = await redis.ping();
    if (pingResult !== 'PONG') {
      throw new Error('Redis ping falhou');
    }
    console.log('   ✅ Redis conectado e respondendo');
  } catch (error) {
    console.error('   ❌ Erro no Redis:', error.message);
    allTestsPassed = false;
  }

  // Teste 2: Logger
  console.log('\n2️⃣ Testando Logger...');
  try {
    if (!logger) {
      throw new Error('Logger não disponível');
    }
    logger.info('Teste de log');
    console.log('   ✅ Logger disponível e funcionando');
  } catch (error) {
    console.error('   ❌ Erro no Logger:', error.message);
    allTestsPassed = false;
  }

  // Teste 3: normalizeQuery
  console.log('\n3️⃣ Testando normalizeQuery()...');
  try {
    const testCases = [
      { input: "BarraShopping", expected: "barra_shopping" },
      { input: "Copacabana Beach", expected: "copacabana_beach" },
      { input: "Aeroporto Galeão", expected: "aeroporto_galeao" },
      { input: "Shopping Leblon", expected: "shopping_leblon" },
      { input: "Ipanema - RJ", expected: "ipanema_rj" }
    ];

    for (const testCase of testCases) {
      const result = normalizeQuery(testCase.input);
      if (result !== testCase.expected) {
        throw new Error(`Normalização falhou: "${testCase.input}" → "${result}" (esperado: "${testCase.expected}")`);
      }
      console.log(`   ✅ "${testCase.input}" → "${result}"`);
    }
  } catch (error) {
    console.error('   ❌ Erro na normalização:', error.message);
    allTestsPassed = false;
  }

  // Teste 4: node-fetch
  console.log('\n4️⃣ Testando node-fetch...');
  try {
    if (!fetch) {
      throw new Error('node-fetch não disponível');
    }
    console.log('   ✅ node-fetch disponível');
  } catch (error) {
    console.error('   ❌ Erro no node-fetch:', error.message);
    allTestsPassed = false;
  }

  // Teste 5: Redis setex
  console.log('\n5️⃣ Testando Redis setex()...');
  try {
    const redis = redisPool.getConnection();
    const testKey = 'test:osm:dependencies';
    const testData = { test: 'data', timestamp: new Date().toISOString() };
    
    await redis.setex(testKey, 60, JSON.stringify(testData));
    console.log('   ✅ setex() funcionando');
    
    const retrieved = await redis.get(testKey);
    if (!retrieved) {
      throw new Error('Não foi possível recuperar dados');
    }
    
    const parsed = JSON.parse(retrieved);
    if (parsed.test !== 'data') {
      throw new Error('Dados recuperados não correspondem');
    }
    console.log('   ✅ get() funcionando');
    
    // Limpar
    await redis.del(testKey);
    console.log('   ✅ Redis setex/get/del funcionando corretamente');
  } catch (error) {
    console.error('   ❌ Erro no Redis setex:', error.message);
    allTestsPassed = false;
  }

  // Resultado final
  console.log('\n' + '='.repeat(50));
  if (allTestsPassed) {
    console.log('✅ TODOS OS TESTES PASSARAM!');
    console.log('✅ Dependências estão prontas para uso');
    process.exit(0);
  } else {
    console.log('❌ ALGUNS TESTES FALHARAM');
    console.log('❌ Corrija os erros antes de continuar');
    process.exit(1);
  }
}

// Executar testes
testDependencies().catch(error => {
  console.error('❌ Erro fatal nos testes:', error);
  process.exit(1);
});
































