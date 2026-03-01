/**
 * Script de teste para validar Overpass API
 * Testa com bbox pequeno (Copacabana) para validar resposta
 */

const { logger } = require('../utils/logger');

// Node.js 18+ tem fetch nativo
// Se não estiver disponível, usar node-fetch via import dinâmico
const fetch = globalThis.fetch || (async () => {
  const nodeFetch = await import('node-fetch');
  return nodeFetch.default;
})();

async function testOverpassAPI() {
  console.log('🧪 Testando Overpass API...\n');
  
  // Bbox pequeno: Copacabana
  const bbox = [-22.98, -43.20, -22.96, -43.18];
  console.log(`📍 Bbox de teste: ${bbox.join(', ')} (Copacabana)`);
  
  const query = `
[out:json][timeout:25];
(
  node["amenity"]["name"](${bbox.join(',')});
  node["shop"]["name"](${bbox.join(',')});
);
out center;
`;

  try {
    console.log('\n🔍 Fazendo requisição para Overpass API...');
    const startTime = Date.now();
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
    });

    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    console.log(`✅ Resposta recebida em ${duration}ms`);
    console.log(`📊 Elementos encontrados: ${data.elements?.length || 0}`);
    
    if (!data.elements || data.elements.length === 0) {
      console.log('⚠️ Nenhum elemento encontrado (pode ser normal para bbox pequeno)');
      return true; // Não é erro, apenas não há dados
    }

    // Analisar primeiro elemento
    const firstElement = data.elements[0];
    console.log('\n📋 Estrutura do primeiro elemento:');
    console.log(`   - id: ${firstElement.id}`);
    console.log(`   - lat: ${firstElement.lat || firstElement.center?.lat || 'N/A'}`);
    console.log(`   - lon: ${firstElement.lon || firstElement.center?.lon || 'N/A'}`);
    console.log(`   - tags:`, firstElement.tags ? Object.keys(firstElement.tags).slice(0, 5).join(', ') : 'N/A');
    
    // Validar estrutura
    const hasId = firstElement.id !== undefined;
    const hasCoords = (firstElement.lat !== undefined && firstElement.lon !== undefined) || 
                      (firstElement.center?.lat !== undefined && firstElement.center?.lon !== undefined);
    const hasTags = firstElement.tags && typeof firstElement.tags === 'object';
    const hasName = firstElement.tags?.name;

    console.log('\n✅ Validações:');
    console.log(`   ${hasId ? '✅' : '❌'} Tem ID`);
    console.log(`   ${hasCoords ? '✅' : '❌'} Tem coordenadas`);
    console.log(`   ${hasTags ? '✅' : '❌'} Tem tags`);
    console.log(`   ${hasName ? '✅' : '❌'} Tem nome`);

    if (hasId && hasCoords && hasTags) {
      console.log('\n✅ Estrutura de resposta válida!');
      console.log('✅ Overpass API está funcionando corretamente');
      return true;
    } else {
      throw new Error('Estrutura de resposta inválida');
    }

  } catch (error) {
    console.error('\n❌ Erro ao testar Overpass API:', error.message);
    if (error.message.includes('timeout')) {
      console.error('⚠️ Timeout - pode ser que o bbox seja muito grande ou API esteja lenta');
    }
    return false;
  }
}

// Executar teste
testOverpassAPI()
  .then(success => {
    if (success) {
      console.log('\n🎉 Teste concluído com sucesso!');
      process.exit(0);
    } else {
      console.log('\n❌ Teste falhou');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });

