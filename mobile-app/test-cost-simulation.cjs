// test-cost-simulation.cjs - Simulação completa de custos de uma viagem
const { costMonitoringService } = require('./src/services/CostMonitoringService.js');

async function simulateCompleteTrip() {
    console.log('🚗 SIMULAÇÃO COMPLETA DE CUSTOS DE UMA VIAGEM');
    console.log('='.repeat(60));
    console.log('📅 Data/Hora:', new Date().toLocaleString('pt-BR'));
    console.log('='.repeat(60));

    const tripId = 'trip_simulation_001';
    const userId = 'user_simulation_001';
    const tripAmount = 30.00; // Valor da corrida em BRL (exemplo: R$ 30)

    // ===== INICIAR MONITORAMENTO DA VIAGEM =====
    console.log('\n🚀 INICIANDO VIAGEM...');
    await costMonitoringService.startTripCost(tripId, userId);

    // ===== FASE 1: BUSCA DE VIAGEM (2 minutos) =====
    console.log('\n📱 FASE 1: BUSCA DE VIAGEM (2 minutos)');
    console.log('-'.repeat(40));

    // Usuário abre o app e busca motoristas
    await costMonitoringService.trackGoogleMapsCost('geocoding', 1); // Geocodificar endereço
    await costMonitoringService.addTripCost(tripId, 'google', 'maps', 0.025);
    
    await costMonitoringService.trackFirebaseDatabaseCost('read', 5); // Buscar configurações
    await costMonitoringService.addTripCost(tripId, 'google', 'firebase', 0.0000003);
    
    await costMonitoringService.trackRedisCost(10, 1); // Buscar motoristas próximos
    await costMonitoringService.addTripCost(tripId, 'infrastructure', 'redis', 0.000011);
    
    await costMonitoringService.trackMobileAPICost(3, 2048); // 3 chamadas API, 2KB cada
    await costMonitoringService.addTripCost(tripId, 'mobile', 'api', 0.000003);
    
    await costMonitoringService.trackLocationCost(4); // 4 atualizações de localização
    await costMonitoringService.addTripCost(tripId, 'mobile', 'location', 0.000004);

    // ===== FASE 2: ACEITAÇÃO DA VIAGEM (30 segundos) =====
    console.log('\n✅ FASE 2: ACEITAÇÃO DA VIAGEM (30 segundos)');
    console.log('-'.repeat(40));

    // Motorista aceita a viagem
    await costMonitoringService.trackFirebaseFunctionCost('update_booking', 500, 256); // 500ms, 256MB
    await costMonitoringService.addTripCost(tripId, 'google', 'firebase', 0.00032);
    
    await costMonitoringService.trackFirebaseDatabaseCost('write', 3); // Atualizar status da viagem
    await costMonitoringService.addTripCost(tripId, 'google', 'firebase', 0.00000054);
    
    // Removido SMS - apenas OTP no cadastro, não por corrida
    
    await costMonitoringService.trackWebSocketCost(2, 10); // 2 conexões, 10 mensagens
    await costMonitoringService.addTripCost(tripId, 'infrastructure', 'websocket', 0.0003);

    // ===== FASE 3: VIAGEM EM ANDAMENTO (15 minutos) =====
    console.log('\n🚗 FASE 3: VIAGEM EM ANDAMENTO (15 minutos)');
    console.log('-'.repeat(40));

    // Tracking em tempo real
    for (let i = 0; i < 15; i++) { // 15 minutos
        await costMonitoringService.trackLocationCost(2); // 2 atualizações por minuto
        await costMonitoringService.addTripCost(tripId, 'mobile', 'location', 0.000002);
        
        await costMonitoringService.trackGoogleMapsCost('directions', 1); // Rota atualizada
        await costMonitoringService.addTripCost(tripId, 'google', 'maps', 0.025);
        
        await costMonitoringService.trackRedisCost(5, 0); // 5 operações Redis por minuto
        await costMonitoringService.addTripCost(tripId, 'infrastructure', 'redis', 0.000005);
        
        await costMonitoringService.trackWebSocketCost(0, 4); // 4 mensagens por minuto
        await costMonitoringService.addTripCost(tripId, 'infrastructure', 'websocket', 0.000004);
        
        await costMonitoringService.trackMobileAPICost(1, 512); // 1 chamada API por minuto
        await costMonitoringService.addTripCost(tripId, 'mobile', 'api', 0.000001);
    }

    // ===== FASE 4: FINALIZAÇÃO E PAGAMENTO (2 minutos) =====
    console.log('\n💳 FASE 4: FINALIZAÇÃO E PAGAMENTO (2 minutos)');
    console.log('-'.repeat(40));

    // Finalizar viagem
    await costMonitoringService.trackFirebaseFunctionCost('complete_trip', 1000, 512); // 1s, 512MB
    await costMonitoringService.addTripCost(tripId, 'google', 'firebase', 0.00128);
    
    await costMonitoringService.trackFirebaseDatabaseCost('write', 5); // Salvar dados da viagem
    await costMonitoringService.addTripCost(tripId, 'google', 'firebase', 0.0000009);
    
    // Processar pagamento
    await costMonitoringService.trackPaymentCost('woovi', tripAmount);
    const wooviFeeAmount = costMonitoringService.calculateWooviFee(tripAmount);
    await costMonitoringService.addTripCost(tripId, 'apis', 'payment', wooviFeeAmount); // Apenas taxa Woovi
    
    // Removido SMS - apenas OTP no cadastro
    
    await costMonitoringService.trackFirebaseDatabaseCost('read', 3); // Ler dados do usuário
    await costMonitoringService.addTripCost(tripId, 'google', 'firebase', 0.00000018);

    // ===== FINALIZAR VIAGEM =====
    console.log('\n🏁 FINALIZANDO VIAGEM...');
    const tripCost = await costMonitoringService.endTripCost(tripId);
    
    // ===== CÁLCULO DE LUCRO =====
    console.log('\n💰 ANÁLISE DE LUCRO');
    console.log('-'.repeat(40));
    
    const operationalRevenue = costMonitoringService.calculateOperationalRevenue(tripAmount);
    const wooviFee = costMonitoringService.calculateWooviFee(tripAmount);
    const driverPayment = costMonitoringService.calculateDriverPayment(tripAmount);
    const totalCosts = tripCost.details ? 
        Object.values(tripCost.details).reduce((sum, category) => 
            sum + Object.values(category).reduce((catSum, val) => catSum + (typeof val === 'number' ? val : 0), 0), 0
        ) : 0;
    const profit = costMonitoringService.calculateProfit(tripAmount, totalCosts);
    
    console.log(`💵 Valor da Corrida: R$ ${tripAmount.toFixed(2)}`);
    console.log(`🚗 Pagamento Motorista: R$ ${driverPayment.toFixed(2)} (valor total)`);
    console.log(`💰 Nossa Receita (Taxa Operacional): R$ ${operationalRevenue.toFixed(2)}`);
    console.log(`💳 Taxa Woovi: R$ ${wooviFee.toFixed(2)} (debitada do valor da corrida)`);
    console.log(`💸 Custos Operacionais: R$ ${totalCosts.toFixed(6)}`);
    console.log(`📈 NOSSO LUCRO: R$ ${profit.toFixed(6)}`);
    console.log(`🎯 Margem de Lucro: ${((profit / operationalRevenue) * 100).toFixed(2)}%`);

    // ===== RELATÓRIO COMPLETO =====
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO DE CUSTOS DA VIAGEM');
    console.log('='.repeat(60));

    const report = await costMonitoringService.getTripCostReport(tripId);
    
    console.log(`🚗 Viagem ID: ${report.tripId}`);
    console.log(`👤 Usuário: ${report.userId}`);
    console.log(`⏱️  Duração: ${(report.duration / 60000).toFixed(1)} minutos`);
    console.log(`💰 Custo total: $${report.totalCost.toFixed(6)}`);
    console.log(`📈 Custo por minuto: $${report.costPerMinute.toFixed(6)}`);
    console.log(`💵 Valor da corrida: R$${tripAmount.toFixed(2)}`);
    console.log(`📊 Margem: R$${(operationalRevenue - report.totalCost).toFixed(6)}`);
    console.log(`🎯 Percentual de custo: ${((report.totalCost / operationalRevenue) * 100).toFixed(4)}%`);
    console.log(`🌱 Sustentabilidade: ${report.sustainability.level} (${report.sustainability.percentage.toFixed(2)}%)`);

    console.log('\n📋 DETALHAMENTO DE CUSTOS:');
    console.log('Google Maps:', `$${report.breakdown.google.maps.toFixed(6)}`);
    console.log('Firebase:', `$${report.breakdown.google.firebase.toFixed(6)}`);
    console.log('APIs (Payment):', `$${report.breakdown.apis.payment.toFixed(6)}`);
    console.log('APIs (SMS):', `$${report.breakdown.apis.sms.toFixed(6)}`);
    console.log('Infrastructure (Redis):', `$${report.breakdown.infrastructure.redis.toFixed(6)}`);
    console.log('Infrastructure (WebSocket):', `$${report.breakdown.infrastructure.websocket.toFixed(6)}`);
    console.log('Mobile (API):', `$${report.breakdown.mobile.api.toFixed(6)}`);
    console.log('Mobile (Location):', `$${report.breakdown.mobile.location.toFixed(6)}`);

    // ===== ANÁLISE DE SUSTENTABILIDADE =====
    console.log('\n' + '='.repeat(60));
    console.log('🌱 ANÁLISE DE SUSTENTABILIDADE');
    console.log('='.repeat(60));

    const sustainabilityReport = await costMonitoringService.getSustainabilityReport();
    
    console.log(`💰 Custo total acumulado: $${sustainabilityReport.totalCost.toFixed(6)}`);
    console.log(`🌱 Nível de sustentabilidade: ${sustainabilityReport.sustainability.level}`);
    console.log(`📊 Percentual de custo: ${sustainabilityReport.sustainability.percentage.toFixed(2)}%`);

    console.log('\n🔝 TOP 5 MAIORES CUSTOS:');
    sustainabilityReport.topCostDrivers.forEach((driver, index) => {
        console.log(`${index + 1}. ${driver.name}: $${driver.cost.toFixed(6)}`);
    });

    console.log('\n💡 RECOMENDAÇÕES:');
    sustainabilityReport.recommendations.forEach((rec, index) => {
        console.log(`${index + 1}. ${rec}`);
    });

    // ===== SIMULAÇÃO DE ESCALA =====
    console.log('\n' + '='.repeat(60));
    console.log('📈 SIMULAÇÃO DE ESCALA');
    console.log('='.repeat(60));

    const scenarios = [
        { name: '100 viagens/dia', trips: 100, revenue: 1500 },
        { name: '1.000 viagens/dia', trips: 1000, revenue: 15000 },
        { name: '10.000 viagens/dia', trips: 10000, revenue: 150000 },
        { name: '100.000 viagens/dia', trips: 100000, revenue: 1500000 }
    ];

    scenarios.forEach(scenario => {
        const dailyCost = report.totalCost * scenario.trips;
        const dailyRevenue = scenario.revenue;
        const dailyProfit = dailyRevenue - dailyCost;
        const profitMargin = (dailyProfit / dailyRevenue) * 100;
        
        console.log(`\n${scenario.name}:`);
        console.log(`   💰 Custo diário: $${dailyCost.toFixed(2)}`);
        console.log(`   💵 Receita diária: $${dailyRevenue.toFixed(2)}`);
        console.log(`   📈 Lucro diário: $${dailyProfit.toFixed(2)}`);
        console.log(`   🎯 Margem de lucro: ${profitMargin.toFixed(2)}%`);
        
        if (profitMargin > 70) {
            console.log(`   ✅ EXCELENTE - Modelo muito sustentável`);
        } else if (profitMargin > 50) {
            console.log(`   ✅ BOM - Modelo sustentável`);
        } else if (profitMargin > 30) {
            console.log(`   ⚠️  ACEITÁVEL - Precisa de otimizações`);
        } else if (profitMargin > 10) {
            console.log(`   🔴 PREOCUPANTE - Necessita revisão urgente`);
        } else {
            console.log(`   💥 CRÍTICO - Modelo insustentável`);
        }
    });

    console.log('\n' + '='.repeat(60));
    console.log('🏁 SIMULAÇÃO CONCLUÍDA');
    console.log('='.repeat(60));

    return {
        tripCost: report,
        sustainability: sustainabilityReport,
        scenarios
    };
}

// Executar simulação
simulateCompleteTrip().catch(console.error); 