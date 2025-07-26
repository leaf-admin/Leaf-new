// test-corrida-real-ponta-a-ponta.cjs - Simulação completa de uma corrida real
const { costMonitoringService } = require('./src/services/CostMonitoringService.js');
const NavigationService = require('./src/services/NavigationService.js');

async function simularCorridaReal() {
    console.log('🚗 SIMULAÇÃO PONTA A PONTA: CORRIDA REAL');
    console.log('='.repeat(60));
    
    const costMonitoring = costMonitoringService;
    const navigationService = new NavigationService();
    
    // RESET DOS CUSTOS
    await costMonitoring.resetCosts();
    
    // DADOS DA CORRIDA REAL
    const corrida = {
        origem: { lat: -22.9068, lng: -43.1729, endereco: 'Centro do Rio de Janeiro' },
        destino: { lat: -22.9519, lng: -43.2105, endereco: 'Copacabana, Rio de Janeiro' },
        valorCorrida: 30.00, // R$ 30,00
        distanciaReal: 15.2, // km
        tempoEstimado: 28, // minutos
        pedagios: 8.50 // R$ 8,50 (Ponte Rio-Niterói)
    };
    
    console.log('\n📍 DADOS DA CORRIDA:');
    console.log(`   Origem: ${corrida.origem.endereco}`);
    console.log(`   Destino: ${corrida.destino.endereco}`);
    console.log(`   Distância: ${corrida.distanciaReal} km`);
    console.log(`   Tempo estimado: ${corrida.tempoEstimado} minutos`);
    console.log(`   Pedágios: R$ ${corrida.pedagios.toFixed(2)}`);
    
    // ========================================
    // FASE 1: BUSCA DE VIAGEM (2 minutos)
    // ========================================
    console.log('\n🔄 FASE 1: BUSCA DE VIAGEM (2 minutos)');
    console.log('-'.repeat(50));
    
    // 1.1 Geocoding da origem
    costMonitoring.trackGoogleMapsCost('geocoding', 1);
    console.log('✅ Geocoding origem: 1 request');
    
    // 1.2 Geocoding do destino
    costMonitoring.trackGoogleMapsCost('geocoding', 1);
    console.log('✅ Geocoding destino: 1 request');
    
    // 1.3 Cálculo da rota com trânsito
    const routeData = await navigationService.calculateRouteWithTraffic(corrida.origem, corrida.destino);
    console.log('✅ Rota calculada com trânsito: 1 request');
    
    // 1.4 Busca de motoristas próximos (Redis)
    costMonitoring.trackRedisCost(10, 1);
    console.log('✅ Busca motoristas próximos: 10 operações Redis');
    
    // 1.5 API calls do mobile
    costMonitoring.trackMobileAPICost(3);
    console.log('✅ API calls mobile: 3 chamadas');
    
    // 1.6 Atualizações de localização
    costMonitoring.trackLocationCost(4);
    console.log('✅ Atualizações GPS: 4 updates');
    
    // ========================================
    // FASE 2: ACEITAÇÃO DA VIAGEM (30 segundos)
    // ========================================
    console.log('\n✅ FASE 2: ACEITAÇÃO DA VIAGEM (30 segundos)');
    console.log('-'.repeat(50));
    
    // 2.1 Firebase Function - update_booking
    costMonitoring.trackFirebaseFunctionCost('update_booking', 1);
    costMonitoring.trackFirebaseDatabaseCost('reads', 3);
    costMonitoring.trackFirebaseDatabaseCost('writes', 3);
    console.log('✅ Firebase Function update_booking: 1 execução');
    
    // 2.2 WebSocket - notificações
    costMonitoring.trackWebSocketCost(2, 10);
    console.log('✅ WebSocket notificações: 2 conexões, 10 mensagens');
    
    // ========================================
    // FASE 3: VIAGEM EM ANDAMENTO (28 minutos)
    // ========================================
    console.log('\n🚗 FASE 3: VIAGEM EM ANDAMENTO (28 minutos)');
    console.log('-'.repeat(50));
    
    // 3.1 Navegação híbrida (sem recalcular rotas)
    console.log('✅ Navegação aberta no Waze/Google Maps (gratuito)');
    
    // 3.2 Monitoramento de progresso (GPS local)
    const updatesPerMinute = 2;
    const totalUpdates = corrida.tempoEstimado * updatesPerMinute;
    costMonitoring.trackLocationCost(totalUpdates);
    console.log(`✅ Monitoramento GPS: ${totalUpdates} updates (${updatesPerMinute}/min)`);
    
    // 3.3 Sincronização com backend
    const syncsPerMinute = 1;
    const totalSyncs = corrida.tempoEstimado * syncsPerMinute;
    costMonitoring.trackMobileAPICost(totalSyncs);
    console.log(`✅ Sincronização backend: ${totalSyncs} chamadas (${syncsPerMinute}/min)`);
    
    // 3.4 Redis - tracking em tempo real
    const redisOpsPerMinute = 5;
    const totalRedisOps = corrida.tempoEstimado * redisOpsPerMinute;
    costMonitoring.trackRedisCost(totalRedisOps, 0);
    console.log(`✅ Redis tracking: ${totalRedisOps} operações (${redisOpsPerMinute}/min)`);
    
    // 3.5 WebSocket - atualizações em tempo real
    const wsMessagesPerMinute = 4;
    const totalWSMessages = corrida.tempoEstimado * wsMessagesPerMinute;
    costMonitoring.trackWebSocketCost(0, totalWSMessages);
    console.log(`✅ WebSocket updates: ${totalWSMessages} mensagens (${wsMessagesPerMinute}/min)`);
    
    // ========================================
    // FASE 4: FINALIZAÇÃO E PAGAMENTO (2 minutos)
    // ========================================
    console.log('\n💳 FASE 4: FINALIZAÇÃO E PAGAMENTO (2 minutos)');
    console.log('-'.repeat(50));
    
    // 4.1 Firebase Function - complete_trip
    costMonitoring.trackFirebaseFunctionCost('complete_trip', 1);
    costMonitoring.trackFirebaseDatabaseCost('reads', 5);
    costMonitoring.trackFirebaseDatabaseCost('writes', 5);
    console.log('✅ Firebase Function complete_trip: 1 execução');
    
    // 4.2 Pagamento via Woovi PIX
    costMonitoring.trackPaymentCost('woovi', corrida.valorCorrida);
    console.log(`✅ Pagamento Woovi PIX: R$ ${corrida.valorCorrida.toFixed(2)}`);
    
    // ========================================
    // ANÁLISE FINANCEIRA COMPLETA
    // ========================================
    console.log('\n💰 ANÁLISE FINANCEIRA COMPLETA');
    console.log('='.repeat(60));
    
    // Receitas
    const receitaOperacional = 1.55; // Taxa fixa por corrida
    const valorCorrida = corrida.valorCorrida;
    
    // Custos operacionais - calculados manualmente
    const custosAtuais = await costMonitoring.getCurrentCosts();
    const custosOperacionais = custosAtuais.total;
    
    // Cálculo do Woovi (não impacta nosso lucro)
    const taxaWoovi = Math.max(corrida.valorCorrida * 0.008, 0.50); // 0.8% ou R$ 0,50 mínimo
    
    // Pagamento ao motorista
    const pagamentoMotorista = valorCorrida; // Motorista recebe valor total
    
    // Nosso lucro
    const nossoLucro = receitaOperacional - custosOperacionais;
    const margemLucro = (nossoLucro / receitaOperacional) * 100;
    
    console.log('\n📊 RECEITAS:');
    console.log(`   Valor da corrida: R$ ${valorCorrida.toFixed(2)}`);
    console.log(`   Nossa receita (taxa operacional): R$ ${receitaOperacional.toFixed(2)}`);
    
    console.log('\n💸 CUSTOS OPERACIONAIS:');
    console.log(`   Google Maps: R$ ${custosAtuais.google.maps.cost.toFixed(6)}`);
    console.log(`   Firebase: R$ ${(custosAtuais.google.firebase.functions.cost + custosAtuais.google.firebase.database.cost).toFixed(6)}`);
    console.log(`   Redis: R$ ${custosAtuais.infrastructure.redis.cost.toFixed(6)}`);
    console.log(`   WebSocket: R$ ${custosAtuais.infrastructure.websocket.cost.toFixed(6)}`);
    console.log(`   Mobile API: R$ ${custosAtuais.mobile.apiCalls.cost.toFixed(6)}`);
    console.log(`   Location: R$ ${custosAtuais.mobile.location.cost.toFixed(6)}`);
    console.log(`   Total custos operacionais: R$ ${custosOperacionais.toFixed(6)}`);
    
    console.log('\n💳 PAGAMENTO:');
    console.log(`   Taxa Woovi PIX: R$ ${taxaWoovi.toFixed(2)} (debitada do valor da corrida)`);
    console.log(`   Pagamento ao motorista: R$ ${pagamentoMotorista.toFixed(2)}`);
    
    console.log('\n📈 RESULTADO FINANCEIRO:');
    console.log(`   Receita operacional: R$ ${receitaOperacional.toFixed(2)}`);
    console.log(`   Custos operacionais: R$ ${custosOperacionais.toFixed(6)}`);
    console.log(`   NOSSO LUCRO: R$ ${nossoLucro.toFixed(6)}`);
    console.log(`   Margem de lucro: ${margemLucro.toFixed(2)}%`);
    
    // ========================================
    // ANÁLISE DE SUSTENTABILIDADE
    // ========================================
    console.log('\n🎯 ANÁLISE DE SUSTENTABILIDADE');
    console.log('-'.repeat(50));
    
    const sustentabilidade = custosAtuais.sustainability;
    console.log(`   Nível: ${sustentabilidade.level}`);
    console.log(`   Score: ${sustentabilidade.score}/100`);
    console.log(`   Status: ${sustentabilidade.status}`);
    
    // ========================================
    // COMPARAÇÃO COM MODELO TRADICIONAL
    // ========================================
    console.log('\n📊 COMPARAÇÃO COM MODELO TRADICIONAL');
    console.log('-'.repeat(50));
    
    // Simula custos do modelo tradicional (1 direction por minuto)
    const directionsTradicional = 28 * 1; // 1 por minuto durante 28 minutos
    const custoGoogleTradicional = directionsTradicional * 0.025;
    const custoTotalTradicional = custosOperacionais + (custoGoogleTradicional - custosAtuais.google.maps.cost);
    
    const economiaGoogle = custoGoogleTradicional - custosAtuais.google.maps.cost;
    const economiaTotal = custoTotalTradicional - custosOperacionais;
    
    console.log(`   Google Maps tradicional: R$ ${custoGoogleTradicional.toFixed(3)}`);
    console.log(`   Google Maps híbrido: R$ ${custosAtuais.google.maps.cost.toFixed(3)}`);
    console.log(`   Economia Google Maps: R$ ${economiaGoogle.toFixed(3)}`);
    console.log(`   Economia total: R$ ${economiaTotal.toFixed(3)}`);
    
    // ========================================
    // PROJEÇÕES DE ESCALA
    // ========================================
    console.log('\n📈 PROJEÇÕES DE ESCALA');
    console.log('-'.repeat(50));
    
    const corridasPorDia = [10, 50, 100, 500, 1000];
    
    console.log('   Corridas/dia | Custo/dia | Lucro/dia | Margem');
    console.log('   ------------|-----------|-----------|--------');
    
    corridasPorDia.forEach(corridas => {
        const custoDia = custosOperacionais * corridas;
        const lucroDia = nossoLucro * corridas;
        const margemDia = (lucroDia / (receitaOperacional * corridas)) * 100;
        
        console.log(`   ${corridas.toString().padStart(11)} | ${custoDia.toFixed(2).padStart(9)} | ${lucroDia.toFixed(2).padStart(9)} | ${margemDia.toFixed(1)}%`);
    });
    
    // ========================================
    // RECOMENDAÇÕES
    // ========================================
    console.log('\n💡 RECOMENDAÇÕES');
    console.log('-'.repeat(50));
    
    if (margemLucro > 80) {
        console.log('✅ Margem excelente - modelo muito sustentável');
    } else if (margemLucro > 60) {
        console.log('✅ Margem boa - modelo sustentável');
    } else if (margemLucro > 40) {
        console.log('⚠️ Margem moderada - considerar otimizações');
    } else {
        console.log('❌ Margem baixa - necessidade de otimizações urgentes');
    }
    
    console.log('\n🎯 CONCLUSÃO:');
    console.log(`O modelo híbrido de navegação reduz significativamente os custos`);
    console.log(`e mantém uma margem de lucro saudável de ${margemLucro.toFixed(1)}%.`);
    console.log(`A sustentabilidade é ${sustentabilidade.status.toLowerCase()}.`);
}

simularCorridaReal().catch(console.error); 