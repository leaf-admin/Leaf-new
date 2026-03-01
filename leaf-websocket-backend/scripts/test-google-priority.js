/**
 * Teste de prioridade: Verificar se dados do Google têm prioridade sobre OSM
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const { normalizeQuery } = require('../utils/places-normalizer');
const { saveToRedis } = require('./populate-places-osm');
const placesCacheService = require('../services/places-cache-service');

const redis = redisPool.getConnection();

async function testGooglePriority() {
  console.log('🧪 Testando prioridade do Google sobre OSM...\n');
  
  await placesCacheService.initialize();
  
  const testName = "Teste Prioridade Google OSM";
  const alias = normalizeQuery(testName);
  
  // 1. Salvar place do OSM primeiro
  console.log('1️⃣ Salvando place do OSM...');
  const osmPlace = {
    id: 111111111,
    lat: -22.9708,
    lon: -43.3656,
    tags: {
      name: testName,
      "addr:street": "Rua OSM",
      "addr:city": "Rio de Janeiro"
    }
  };
  
  const osmResult = await saveToRedis(osmPlace);
  if (!osmResult) {
    console.log('   ❌ Erro ao salvar OSM');
    return false;
  }
  console.log('   ✅ Place do OSM salvo');
  
  // 2. Verificar que está no cache
  const beforeGoogle = await placesCacheService.searchPlace(testName);
  if (!beforeGoogle) {
    console.log('   ❌ Place do OSM não encontrado no cache');
    return false;
  }
  console.log(`   ✅ Place encontrado: ${beforeGoogle.name} (source: ${beforeGoogle.source || 'N/A'})`);
  console.log(`   ✅ Place ID: ${beforeGoogle.place_id}`);
  
  if (beforeGoogle.place_id !== `osm_${osmPlace.id}`) {
    console.log('   ❌ Place ID incorreto');
    return false;
  }
  
  // 3. Salvar mesmo lugar do Google (deve sobrescrever OSM)
  console.log('\n2️⃣ Salvando mesmo lugar do Google...');
  const googlePlaceData = {
    place_id: "ChIJTestGooglePriority123",
    name: testName,
    address: "Endereço Google",
    lat: -22.9708,
    lng: -43.3656
  };
  
  const googleResult = await placesCacheService.savePlace(testName, googlePlaceData);
  if (!googleResult) {
    console.log('   ❌ Erro ao salvar Google');
    return false;
  }
  console.log('   ✅ Place do Google salvo');
  
  // 4. Verificar que agora tem dados do Google
  const afterGoogle = await placesCacheService.searchPlace(testName);
  if (!afterGoogle) {
    console.log('   ❌ Place não encontrado após salvar Google');
    return false;
  }
  
  console.log(`   ✅ Place encontrado: ${afterGoogle.name}`);
  console.log(`   ✅ Source: ${afterGoogle.source || 'N/A'}`);
  console.log(`   ✅ Place ID: ${afterGoogle.place_id}`);
  
  if (afterGoogle.place_id !== googlePlaceData.place_id) {
    console.log('   ❌ Place ID não é do Google');
    console.log(`      Esperado: ${googlePlaceData.place_id}`);
    console.log(`      Recebido: ${afterGoogle.place_id}`);
    return false;
  }
  
  if (afterGoogle.source && afterGoogle.source !== 'redis_cache') {
    // Source pode ser 'redis_cache' (do searchPlace) ou 'google' (do payload)
    // O importante é que place_id seja do Google
    console.log('   ⚠️ Source não é "google", mas place_id está correto');
  }
  
  // 5. Tentar salvar OSM novamente (não deve sobrescrever)
  console.log('\n3️⃣ Tentando salvar OSM novamente (não deve sobrescrever)...');
  const osmResult2 = await saveToRedis(osmPlace);
  if (osmResult2) {
    console.log('   ❌ OSM sobrescreveu dados do Google (ERRO!)');
    return false;
  } else {
    console.log('   ✅ OSM não sobrescreveu dados do Google (correto!)');
  }
  
  // 6. Verificar que dados do Google ainda estão lá
  const finalCheck = await placesCacheService.searchPlace(testName);
  if (!finalCheck || finalCheck.place_id !== googlePlaceData.place_id) {
    console.log('   ❌ Dados do Google foram alterados');
    return false;
  }
  
  console.log('   ✅ Dados do Google preservados');
  
  // Limpar
  await redis.del(`place:${alias}`);
  console.log('\n✅ Teste de prioridade: PASSOU!\n');
  
  return true;
}

// Executar
testGooglePriority()
  .then(success => {
    if (success) {
      console.log('🎉 Todos os testes de prioridade passaram!');
      process.exit(0);
    } else {
      console.log('❌ Testes de prioridade falharam');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
































