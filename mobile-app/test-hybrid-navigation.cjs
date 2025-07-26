// test-hybrid-navigation.cjs - Teste do fluxo de navegação híbrida
const NavigationService = require('./src/services/NavigationService.js');
const { costMonitoringService } = require('./src/services/CostMonitoringService.js');

async function testHybridNavigation() {
    console.log('🚗 TESTE DO FLUXO DE NAVEGAÇÃO HÍBRIDA');
    console.log('='.repeat(60));
    
    const navigationService = new NavigationService();
    const costMonitoring = costMonitoringService;
    
    // Simula uma corrida completa
    const origin = { lat: -22.9068, lng: -43.1729 }; // Centro do Rio
    const destination = { lat: -22.9519, lng: -43.2105 }; // Copacabana
    
    console.log('\n📍 ORIGEM: Centro do Rio');
    console.log('🎯 DESTINO: Copacabana');
    
    // FASE 1: Cálculo da rota com trânsito (1x por corrida)
    console.log('\n🔄 FASE 1: CALCULANDO ROTA COM TRÂNSITO');
    console.log('-'.repeat(40));
    
    const routeData = await navigationService.calculateRouteWithTraffic(origin, destination);
    
    console.log(`⏱️ Tempo estimado: ${Math.round(routeData.estimatedTime / 60)} minutos`);
    console.log(`📏 Distância: ${Math.round(routeData.estimatedDistance / 1000)} km`);
    console.log(`🚦 Trânsito: ${routeData.trafficInfo.trafficLevel}`);
    console.log(`💰 Pedágios: R$ ${routeData.tolls.total.toFixed(2)}`);
    
    // FASE 2: Preview da rota no app
    console.log('\n📱 FASE 2: PREVIEW DA ROTA NO APP');
    console.log('-'.repeat(40));
    
    const preview = await navigationService.showRoutePreview(routeData);
    console.log('✅ Preview da rota exibido no app');
    console.log('📊 Informações de tempo e distância mostradas');
    
    // FASE 3: Abertura da navegação externa
    console.log('\n🚀 FASE 3: ABRINDO NAVEGAÇÃO EXTERNA');
    console.log('-'.repeat(40));
    
    const navigationResult = await navigationService.openExternalNavigation(origin, destination, routeData);
    console.log(`✅ Navegação aberta no: ${navigationResult.app}`);
    
    // FASE 4: Monitoramento do progresso (simulado)
    console.log('\n📍 FASE 4: MONITORAMENTO DO PROGRESSO');
    console.log('-'.repeat(40));
    
    // Simula 3 pontos de monitoramento durante a viagem
    const progressPoints = [
        { lat: -22.9068, lng: -43.1729, progress: 0 }, // Início
        { lat: -22.9294, lng: -43.1917, progress: 50 }, // Meio
        { lat: -22.9519, lng: -43.2105, progress: 100 } // Fim
    ];
    
    for (let i = 0; i < progressPoints.length; i++) {
        const point = progressPoints[i];
        const progress = await navigationService.monitorTripProgress(point, destination, routeData);
        
        console.log(`📍 Ponto ${i + 1}: ${Math.round(progress.progress)}% concluído`);
        console.log(`   Distância restante: ${progress.distanceToDestination.toFixed(1)} km`);
        console.log(`   Tempo restante: ${Math.round(progress.estimatedTimeRemaining / 60)} min`);
    }
    
    // ANÁLISE DE CUSTOS
    console.log('\n💰 ANÁLISE DE CUSTOS - NAVEGAÇÃO HÍBRIDA');
    console.log('='.repeat(60));
    
    // Custos da navegação híbrida
    const hybridCosts = {
        googleMapsDirections: 1, // 1 consulta por corrida
        geocoding: 2, // origem e destino
        totalGoogleMaps: 3
    };
    
    console.log('📊 CUSTOS DA NAVEGAÇÃO HÍBRIDA:');
    console.log(`   Google Directions: ${hybridCosts.googleMapsDirections} × R$ 0,025 = R$ ${(hybridCosts.googleMapsDirections * 0.025).toFixed(3)}`);
    console.log(`   Geocoding: ${hybridCosts.geocoding} × R$ 0,025 = R$ ${(hybridCosts.geocoding * 0.025).toFixed(3)}`);
    console.log(`   Total Google Maps: R$ ${(hybridCosts.totalGoogleMaps * 0.025).toFixed(3)}`);
    console.log(`   Navegação externa: R$ 0,000 (gratuita)`);
    console.log(`   TOTAL: R$ ${(hybridCosts.totalGoogleMaps * 0.025).toFixed(3)}`);
    
    // Comparação com navegação tradicional
    console.log('\n📊 COMPARAÇÃO COM NAVEGAÇÃO TRADICIONAL:');
    console.log('-'.repeat(40));
    
    const traditionalCosts = {
        googleMapsDirections: 15, // 1 por minuto durante 15 minutos
        geocoding: 2,
        totalGoogleMaps: 17
    };
    
    console.log('🚗 NAVEGAÇÃO TRADICIONAL (recalculando rotas):');
    console.log(`   Google Directions: ${traditionalCosts.googleMapsDirections} × R$ 0,025 = R$ ${(traditionalCosts.googleMapsDirections * 0.025).toFixed(3)}`);
    console.log(`   Geocoding: ${traditionalCosts.geocoding} × R$ 0,025 = R$ ${(traditionalCosts.geocoding * 0.025).toFixed(3)}`);
    console.log(`   Total: R$ ${(traditionalCosts.totalGoogleMaps * 0.025).toFixed(3)}`);
    
    // Economia
    const economia = (traditionalCosts.totalGoogleMaps * 0.025) - (hybridCosts.totalGoogleMaps * 0.025);
    const percentualEconomia = (economia / (traditionalCosts.totalGoogleMaps * 0.025)) * 100;
    
    console.log('\n💡 ECONOMIA:');
    console.log(`   Economia por corrida: R$ ${economia.toFixed(3)}`);
    console.log(`   Percentual de economia: ${percentualEconomia.toFixed(1)}%`);
    
    // VANTAGENS E DESVANTAGENS
    console.log('\n✅ VANTAGENS DA NAVEGAÇÃO HÍBRIDA:');
    console.log('-'.repeat(40));
    console.log('💰 Custo muito menor (82,4% de economia)');
    console.log('🚀 Navegação em tempo real gratuita (Waze/Google Maps)');
    console.log('📱 Experiência familiar para o usuário');
    console.log('🔋 Menor consumo de bateria do app');
    console.log('🌐 Funciona offline (app externo)');
    console.log('🚦 Alertas de trânsito em tempo real');
    console.log('🛣️ Recalculo automático de rotas');
    
    console.log('\n⚠️ DESVANTAGENS DA NAVEGAÇÃO HÍBRIDA:');
    console.log('-'.repeat(40));
    console.log('🔄 Troca de contexto (app → app externo)');
    console.log('📊 Menos controle sobre a experiência');
    console.log('🔗 Dependência de apps externos');
    console.log('📱 Pode não funcionar se apps não instalados');
    console.log('🎨 Menos personalização da interface');
    
    // RECOMENDAÇÕES
    console.log('\n💡 RECOMENDAÇÕES:');
    console.log('-'.repeat(40));
    console.log('1. Implementar fallback para browser se apps não disponíveis');
    console.log('2. Mostrar tutorial na primeira vez');
    console.log('3. Permitir escolha do app de navegação preferido');
    console.log('4. Manter preview da rota no app para referência');
    console.log('5. Monitorar progresso via GPS para ETA');
    
    // IMPACTO NO CUSTO TOTAL DA CORRIDA
    console.log('\n📈 IMPACTO NO CUSTO TOTAL DA CORRIDA:');
    console.log('-'.repeat(40));
    
    const custoAtualGoogleMaps = 0.400; // R$ 0,40 (15 directions)
    const custoNovoGoogleMaps = 0.075; // R$ 0,075 (3 requests)
    const economiaGoogleMaps = custoAtualGoogleMaps - custoNovoGoogleMaps;
    
    console.log(`💰 Custo atual Google Maps: R$ ${custoAtualGoogleMaps.toFixed(3)}`);
    console.log(`💰 Custo novo Google Maps: R$ ${custoNovoGoogleMaps.toFixed(3)}`);
    console.log(`💸 Economia Google Maps: R$ ${economiaGoogleMaps.toFixed(3)}`);
    
    const custoTotalAtual = 0.902; // R$ 0,90 total por corrida
    const custoTotalNovo = custoTotalAtual - economiaGoogleMaps;
    const economiaTotal = custoTotalAtual - custoTotalNovo;
    
    console.log(`\n📊 CUSTO TOTAL DA CORRIDA:`);
    console.log(`   Atual: R$ ${custoTotalAtual.toFixed(3)}`);
    console.log(`   Novo: R$ ${custoTotalNovo.toFixed(3)}`);
    console.log(`   Economia: R$ ${economiaTotal.toFixed(3)} (${((economiaTotal/custoTotalAtual)*100).toFixed(1)}%)`);
    
    console.log('\n🎯 CONCLUSÃO:');
    console.log('A navegação híbrida reduz significativamente os custos');
    console.log('e oferece uma experiência de navegação superior,');
    console.log('seguindo o padrão dos grandes players do mercado.');
}

testHybridNavigation().catch(console.error); 