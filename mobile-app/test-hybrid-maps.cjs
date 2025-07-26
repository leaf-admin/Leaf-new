// test-hybrid-maps.cjs - Teste do modelo híbrido Google Maps + OpenStreetMap
const HybridMapsService = require('./src/services/HybridMapsService.js');
const { costMonitoringService } = require('./src/services/CostMonitoringService.js');

async function testHybridMaps() {
    console.log('🗺️ TESTE DO MODELO HÍBRIDO GOOGLE MAPS + OPENSTREETMAP');
    console.log('='.repeat(60));
    
    const hybridMaps = new HybridMapsService();
    const costMonitoring = costMonitoringService;
    
    // Simular uma corrida completa com modelo híbrido
    console.log('\n🚗 SIMULAÇÃO DE CORRIDA COM MODELO HÍBRIDO');
    console.log('-'.repeat(40));
    
    // FASE 1: Geocoding (Google Maps - melhor precisão)
    console.log('\n📍 FASE 1: GEOCODING');
    const origin = await hybridMaps.geocode('Rua Augusta, São Paulo');
    const destination = await hybridMaps.geocode('Avenida Paulista, São Paulo');
    
    console.log(`   Origem: ${origin.lat}, ${origin.lng}`);
    console.log(`   Destino: ${destination.lat}, ${destination.lng}`);
    
    // FASE 2: Directions (OpenStreetMap - gratuito)
    console.log('\n🗺️ FASE 2: DIRECTIONS');
    const directions = await hybridMaps.getDirections(origin, destination, 'driving');
    
    console.log(`   Distância: ${directions.distance} km`);
    console.log(`   Duração: ${directions.duration} minutos`);
    console.log(`   Provedor: ${directions.provider}`);
    
    // FASE 3: Places (Google Maps - dados ricos)
    console.log('\n🏢 FASE 3: PLACES');
    const places = await hybridMaps.searchPlaces('restaurante', origin, 1000);
    
    console.log(`   Encontrados: ${places.length} estabelecimentos`);
    places.forEach((place, index) => {
        console.log(`   ${index + 1}. ${place.name} - ${place.address} (${place.rating}⭐)`);
    });
    
    // FASE 4: Reverse Geocoding (OpenStreetMap - gratuito)
    console.log('\n📍 FASE 4: REVERSE GEOCODING');
    const reverseAddress = await hybridMaps.reverseGeocode(origin.lat, origin.lng);
    
    console.log(`   Endereço: ${reverseAddress.address}`);
    console.log(`   Cidade: ${reverseAddress.city}, ${reverseAddress.state}`);
    
    // Análise de custos
    console.log('\n💰 ANÁLISE DE CUSTOS');
    console.log('-'.repeat(40));
    
    const costAnalysis = await hybridMaps.getCostAnalysis();
    
    console.log('📊 CUSTOS ATUAIS (Google Maps puro):');
    console.log(`   Geocoding: R$ 0,025 × 2 = R$ 0,050`);
    console.log(`   Directions: R$ 0,025 × 15 = R$ 0,375`);
    console.log(`   Places: R$ 0,017 × 1 = R$ 0,017`);
    console.log(`   Total: R$ 0,442`);
    
    console.log('\n📊 CUSTOS HÍBRIDOS:');
    console.log(`   Geocoding (Google): R$ 0,025 × 2 = R$ 0,050`);
    console.log(`   Directions (OSM): R$ 0,000 × 15 = R$ 0,000`);
    console.log(`   Places (Google): R$ 0,017 × 1 = R$ 0,017`);
    console.log(`   Reverse (OSM): R$ 0,000 × 1 = R$ 0,000`);
    console.log(`   Total: R$ 0,067`);
    
    console.log('\n💡 ECONOMIA:');
    const economia = 0.442 - 0.067;
    const percentualEconomia = (economia / 0.442) * 100;
    console.log(`   Economia por corrida: R$ ${economia.toFixed(3)}`);
    console.log(`   Percentual de economia: ${percentualEconomia.toFixed(1)}%`);
    
    // Simulação de escala
    console.log('\n📈 SIMULAÇÃO DE ESCALA');
    console.log('-'.repeat(40));
    
    const corridas = [100, 1000, 10000, 100000];
    
    corridas.forEach(numCorridas => {
        const custoAtual = 0.442 * numCorridas;
        const custoHibrido = 0.067 * numCorridas;
        const economiaTotal = custoAtual - custoHibrido;
        
        console.log(`${numCorridas.toLocaleString()} corridas/dia:`);
        console.log(`   Custo atual: R$ ${custoAtual.toFixed(2)}`);
        console.log(`   Custo híbrido: R$ ${custoHibrido.toFixed(2)}`);
        console.log(`   Economia: R$ ${economiaTotal.toFixed(2)}`);
        console.log('');
    });
    
    // Cache stats
    console.log('🗂️ ESTATÍSTICAS DE CACHE');
    console.log('-'.repeat(40));
    
    const cacheStats = hybridMaps.getCacheStats();
    console.log(`   Itens em cache: ${cacheStats.size}`);
    console.log(`   Tipos: ${cacheStats.keys.map(key => key.split(':')[0]).join(', ')}`);
    
    // Recomendações
    console.log('\n💡 RECOMENDAÇÕES DE IMPLEMENTAÇÃO');
    console.log('-'.repeat(40));
    
    console.log('✅ VANTAGENS DO MODELO HÍBRIDO:');
    console.log('   • Economia de 84,8% nos custos de mapas');
    console.log('   • Mantém precisão do Google Maps onde necessário');
    console.log('   • Cache inteligente reduz requisições');
    console.log('   • Fallback automático em caso de falha');
    
    console.log('\n⚠️ CONSIDERAÇÕES:');
    console.log('   • OpenStreetMap pode ter menor precisão em algumas regiões');
    console.log('   • Rate limiting do OSM (1 request/segundo)');
    console.log('   • Necessário implementar cache robusto');
    console.log('   • Monitoramento de qualidade dos dados');
    
    console.log('\n🚀 PRÓXIMOS PASSOS:');
    console.log('   1. Implementar cache Redis para mapas');
    console.log('   2. Configurar rate limiting para OSM');
    console.log('   3. Implementar métricas de qualidade');
    console.log('   4. A/B testing entre provedores');
    console.log('   5. Monitoramento de custos em tempo real');
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ TESTE DO MODELO HÍBRIDO CONCLUÍDO');
}

// Executar teste
testHybridMaps().catch(console.error); 