/**
 * Testes unitários para funções do script populate-places-osm.js
 */

const { normalizeQuery } = require('../utils/places-normalizer');
const { saveToRedis, fetchOSMData, formatAddress, generateOverpassQuery } = require('./populate-places-osm');
const redisPool = require('../utils/redis-pool');
const redis = redisPool.getConnection();

async function testFormatAddress() {
  console.log('🧪 Testando formatAddress()...\n');
  
  const testCases = [
    {
      name: 'Endereço completo',
      tags: {
        "addr:street": "Av. das Américas",
        "addr:housenumber": "4666",
        "addr:neighborhood": "Barra da Tijuca",
        "addr:city": "Rio de Janeiro",
        "addr:state": "RJ",
        "addr:postcode": "22640-102",
        "name": "BarraShopping"
      },
      expected: "Av. das Américas, 4666, Barra da Tijuca, Rio de Janeiro, RJ, 22640-102"
    },
    {
      name: 'Endereço parcial (sem número)',
      tags: {
        "addr:street": "Rua Copacabana",
        "addr:city": "Rio de Janeiro",
        "name": "Praia de Copacabana"
      },
      expected: "Rua Copacabana, Rio de Janeiro"
    },
    {
      name: 'Endereço mínimo (só nome)',
      tags: {
        "name": "Aeroporto Galeão"
      },
      expected: "Aeroporto Galeão"
    },
    {
      name: 'Tags vazias',
      tags: {},
      expected: "Endereço não disponível"
    },
    {
      name: 'Com suburb ao invés de neighborhood',
      tags: {
        "addr:street": "Rua Ipanema",
        "addr:suburb": "Ipanema",
        "addr:city": "Rio de Janeiro"
      },
      expected: "Rua Ipanema, Ipanema, Rio de Janeiro"
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = formatAddress(testCase.tags);
    if (result === testCase.expected) {
      console.log(`   ✅ ${testCase.name}: "${result}"`);
      passed++;
    } else {
      console.log(`   ❌ ${testCase.name}:`);
      console.log(`      Esperado: "${testCase.expected}"`);
      console.log(`      Recebido: "${result}"`);
      failed++;
    }
  }

  console.log(`\n📊 Resultado: ${passed} passaram, ${failed} falharam\n`);
  return failed === 0;
}

function testGenerateOverpassQuery() {
  console.log('🧪 Testando generateOverpassQuery()...\n');
  
  const bbox = [-22.98, -43.20, -22.96, -43.18];
  const query = generateOverpassQuery(bbox);
  
  // Validar que query contém elementos esperados
  const validations = [
    { check: query.includes('[out:json]'), name: 'Contém [out:json]' },
    { check: query.includes('[timeout:60]'), name: 'Contém [timeout:60]' },
    { check: query.includes('node["amenity"]["name"]'), name: 'Contém node amenity' },
    { check: query.includes('node["shop"]["name"]'), name: 'Contém node shop' },
    { check: query.includes('way["amenity"]["name"]'), name: 'Contém way amenity' },
    { check: query.includes(bbox.join(',')), name: 'Contém bbox' },
    { check: query.includes('out center'), name: 'Contém out center' }
  ];

  let passed = 0;
  let failed = 0;

  for (const validation of validations) {
    if (validation.check) {
      console.log(`   ✅ ${validation.name}`);
      passed++;
    } else {
      console.log(`   ❌ ${validation.name}`);
      failed++;
    }
  }

  console.log(`\n📊 Resultado: ${passed} passaram, ${failed} falharam\n`);
  return failed === 0;
}

async function testFetchOSMData() {
  console.log('🧪 Testando fetchOSMData()...\n');
  
  // Bbox pequeno: Copacabana
  const bbox = [-22.98, -43.20, -22.96, -43.18];
  
  try {
    console.log('   🔍 Fazendo requisição real...');
    const elements = await fetchOSMData(bbox);
    
    if (!Array.isArray(elements)) {
      console.log('   ❌ Retorno não é array');
      return false;
    }
    
    console.log(`   ✅ Retornou ${elements.length} elementos`);
    
    if (elements.length > 0) {
      const first = elements[0];
      const hasId = first.id !== undefined;
      const hasCoords = (first.lat !== undefined && first.lon !== undefined) || 
                        (first.center?.lat !== undefined && first.center?.lon !== undefined);
      const hasTags = first.tags && typeof first.tags === 'object';
      
      console.log(`   ${hasId ? '✅' : '❌'} Tem ID`);
      console.log(`   ${hasCoords ? '✅' : '❌'} Tem coordenadas`);
      console.log(`   ${hasTags ? '✅' : '❌'} Tem tags`);
      
      return hasId && hasCoords && hasTags;
    } else {
      console.log('   ⚠️ Nenhum elemento retornado (pode ser normal)');
      return true; // Não é erro
    }
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}`);
    return false;
  }
}

async function testSaveToRedis() {
  console.log('🧪 Testando saveToRedis()...\n');
  
  // Mock de place OSM
  const mockPlace = {
    id: 999999999,
    lat: -22.9708,
    lon: -43.3656,
    tags: {
      name: "Teste Place OSM",
      "addr:street": "Rua Teste",
      "addr:housenumber": "123",
      "addr:city": "Rio de Janeiro",
      "amenity": "restaurant"
    }
  };
  
  try {
    // Limpar antes de testar
    const alias = normalizeQuery(mockPlace.tags.name);
    await redis.del(`place:${alias}`);
    
    console.log('   💾 Salvando place mockado...');
    const result = await saveToRedis(mockPlace);
    
    if (!result) {
      console.log('   ❌ saveToRedis retornou false');
      return false;
    }
    
    console.log('   ✅ saveToRedis retornou true');
    
    // Verificar se foi salvo
    const saved = await redis.get(`place:${alias}`);
    if (!saved) {
      console.log('   ❌ Place não foi salvo no Redis');
      return false;
    }
    
    const parsed = JSON.parse(saved);
    const validations = [
      { check: parsed.alias === alias, name: 'Alias correto' },
      { check: parsed.name === mockPlace.tags.name, name: 'Nome correto' },
      { check: parsed.place_id === `osm_${mockPlace.id}`, name: 'Place ID correto' },
      { check: parsed.lat === mockPlace.lat, name: 'Latitude correta' },
      { check: parsed.lng === mockPlace.lon, name: 'Longitude correta' },
      { check: parsed.source === 'osm', name: 'Source é OSM' },
      { check: parsed.address.includes('Rua Teste'), name: 'Endereço contém rua' }
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const validation of validations) {
      if (validation.check) {
        console.log(`   ✅ ${validation.name}`);
        passed++;
      } else {
        console.log(`   ❌ ${validation.name}`);
        failed++;
      }
    }
    
    // Limpar após teste
    await redis.del(`place:${alias}`);
    
    console.log(`\n📊 Resultado: ${passed} passaram, ${failed} falharam\n`);
    return failed === 0;
    
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}`);
    return false;
  }
}

async function testGooglePriority() {
  console.log('🧪 Testando prioridade do Google...\n');
  
  // Usar mesmo nome para garantir mesmo alias
  const testName = "Teste Google Priority";
  const alias = normalizeQuery(testName);
  
  const googlePlace = {
    alias,
    query: testName,
    place_id: "ChIJTestGoogle123",
    name: testName,
    address: "Endereço Google",
    lat: -22.9708,
    lng: -43.3656,
    cached_at: new Date().toISOString(),
    source: 'google'
  };
  
  const osmPlace = {
    id: 888888888,
    lat: -22.9708,
    lon: -43.3656,
    tags: {
      name: testName // Mesmo nome para gerar mesmo alias
    }
  };
  
  try {
    // Limpar antes de testar
    await redis.del(`place:${alias}`);
    
    // 1. Salvar place do Google
    console.log(`   💾 Salvando place do Google com alias: ${alias}...`);
    await redis.setex(`place:${alias}`, 3600, JSON.stringify(googlePlace));
    console.log('   ✅ Place do Google salvo');
    
    // 2. Tentar salvar mesmo lugar do OSM (deve falhar)
    console.log('   🔄 Tentando salvar mesmo lugar do OSM...');
    const result = await saveToRedis(osmPlace);
    
    if (result) {
      console.log('   ❌ OSM sobrescreveu dados do Google (ERRO!)');
      await redis.del(`place:${alias}`);
      return false;
    } else {
      console.log('   ✅ OSM não sobrescreveu dados do Google (correto!)');
    }
    
    // 3. Verificar que dados do Google ainda estão lá
    const saved = await redis.get(`place:${alias}`);
    if (!saved) {
      console.log('   ❌ Place do Google não encontrado');
      return false;
    }
    
    const parsed = JSON.parse(saved);
    
    if (parsed.source !== 'google' || parsed.place_id !== googlePlace.place_id) {
      console.log('   ❌ Dados do Google foram alterados');
      console.log(`      Source: ${parsed.source} (esperado: google)`);
      console.log(`      Place ID: ${parsed.place_id} (esperado: ${googlePlace.place_id})`);
      await redis.del(`place:${alias}`);
      return false;
    }
    
    console.log('   ✅ Dados do Google preservados');
    
    // Limpar
    await redis.del(`place:${alias}`);
    
    console.log('\n📊 Teste de prioridade: PASSOU\n');
    return true;
    
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}`);
    await redis.del(`place:${alias}`).catch(() => {});
    return false;
  }
}

async function runAllTests() {
  console.log('='.repeat(60));
  console.log('🧪 EXECUTANDO TESTES UNITÁRIOS');
  console.log('='.repeat(60));
  console.log();
  
  const results = {
    formatAddress: await testFormatAddress(),
    generateOverpassQuery: testGenerateOverpassQuery(),
    fetchOSMData: await testFetchOSMData(),
    saveToRedis: await testSaveToRedis(),
    googlePriority: await testGooglePriority()
  };
  
  console.log('='.repeat(60));
  console.log('📊 RESULTADOS FINAIS');
  console.log('='.repeat(60));
  
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const [test, passed] of Object.entries(results)) {
    const status = passed ? '✅ PASSOU' : '❌ FALHOU';
    console.log(`   ${status}: ${test}`);
    if (passed) totalPassed++;
    else totalFailed++;
  }
  
  console.log();
  console.log(`Total: ${totalPassed} passaram, ${totalFailed} falharam`);
  console.log();
  
  if (totalFailed === 0) {
    console.log('🎉 TODOS OS TESTES PASSARAM!');
    process.exit(0);
  } else {
    console.log('❌ ALGUNS TESTES FALHARAM');
    process.exit(1);
  }
}

// Executar
runAllTests().catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});

