/**
 * Cálculo de Capacidade do Servidor
 * 
 * Analisa os dados do teste de carga e calcula o limite de corridas por dia
 */

const fs = require('fs');
const path = require('path');

// Configurações do servidor VPS
const SERVER_SPECS = {
    vCPUs: 4,
    RAM: 8, // GB
    MAX_CONNECTIONS: 10000,
    MAX_REQUESTS_PER_SECOND: 5000,
    CLUSTER_WORKERS: 2,
    MEMORY_LIMIT_MB: 512,
};

// Eventos por corrida completa
const EVENTS_PER_RIDE = {
    rideCreated: 1,
    driverNotification: 3, // Média de 3 motoristas notificados por corrida
    rideAccepted: 1,
    tripStarted: 1,
    tripCompleted: 1,
    locationUpdates: 10, // ~10 atualizações durante a viagem (30s / 3s)
    total: 17 // Total de eventos por corrida completa
};

// Duração média de uma corrida (em segundos)
const AVERAGE_RIDE_DURATION = 1800; // 30 minutos

// Fatores de segurança e overhead
const SAFETY_FACTORS = {
    peakHourMultiplier: 1.5, // Picos de tráfego
    overhead: 0.3, // 30% de overhead para outros processos
    buffer: 0.2, // 20% de margem de segurança
    utilization: 0.7, // Usar 70% da capacidade teórica
};

function calculateCapacity() {
    console.log('📊 ANÁLISE DE CAPACIDADE DO SERVIDOR\n');
    console.log('='.repeat(80));
    
    // 1. Capacidade de requisições por segundo
    const maxRequestsPerSecond = SERVER_SPECS.MAX_REQUESTS_PER_SECOND;
    const usableRequestsPerSecond = maxRequestsPerSecond * SAFETY_FACTORS.utilization;
    
    console.log('\n🔢 CAPACIDADE DE REQUISIÇÕES:');
    console.log(`   Máximo teórico: ${maxRequestsPerSecond.toLocaleString()} req/s`);
    console.log(`   Utilizável (70%): ${Math.floor(usableRequestsPerSecond).toLocaleString()} req/s`);
    
    // 2. Eventos por corrida
    const eventsPerRide = EVENTS_PER_RIDE.total;
    console.log(`\n🚗 EVENTOS POR CORRIDA COMPLETA: ${eventsPerRide}`);
    console.log(`   - Criação: ${EVENTS_PER_RIDE.rideCreated}`);
    console.log(`   - Notificações: ${EVENTS_PER_RIDE.driverNotification}`);
    console.log(`   - Aceitação: ${EVENTS_PER_RIDE.rideAccepted}`);
    console.log(`   - Início: ${EVENTS_PER_RIDE.tripStarted}`);
    console.log(`   - Conclusão: ${EVENTS_PER_RIDE.tripCompleted}`);
    console.log(`   - Atualizações de localização: ${EVENTS_PER_RIDE.locationUpdates}`);
    
    // 3. Análise baseada em conexões simultâneas
    // Assumindo que 10% dos passageiros estão em corrida ativa
    const maxConcurrentRides = Math.floor(SERVER_SPECS.MAX_CONNECTIONS * 0.6 * 0.1); // 60% passageiros, 10% em corrida
    console.log(`\n🚗 CORRIDAS SIMULTÂNEAS:`);
    console.log(`   Máximo teórico: ${maxConcurrentRides.toLocaleString()} corridas ativas`);
    
    // 4. Taxa de criação de novas corridas
    // Considerando que cada corrida gera ~17 eventos, mas eventos são distribuídos no tempo
    // Eventos críticos (criação, notificação, aceitação) são ~5 eventos iniciais
    const criticalEventsPerRide = 5;
    const ridesPerSecond = Math.floor(usableRequestsPerSecond / criticalEventsPerRide);
    console.log(`\n⚡ NOVAS CORRIDAS POR SEGUNDO:`);
    console.log(`   Capacidade: ${ridesPerSecond} corridas/s`);
    
    // 5. Throughput considerando duração das corridas
    // Se cada corrida dura 30 minutos (1800s), e temos capacidade para X corridas/s
    // O throughput real é limitado pelo número de corridas simultâneas
    const ridesPerMinute = ridesPerSecond * 60;
    const ridesPerHour = ridesPerMinute * 60;
    
    // Limite real: não podemos ter mais corridas simultâneas do que o máximo
    // Se cada corrida dura 30 min, em 1 hora podemos processar: maxConcurrentRides * 2
    const realisticRidesPerHour = Math.min(
        ridesPerHour,
        maxConcurrentRides * (3600 / AVERAGE_RIDE_DURATION)
    );
    
    console.log(`\n⏱️  CORRIDAS POR MINUTO: ${ridesPerMinute.toLocaleString()}`);
    console.log(`\n🕐 CORRIDAS POR HORA (TEÓRICO): ${ridesPerHour.toLocaleString()}`);
    console.log(`\n🕐 CORRIDAS POR HORA (REALISTA): ${Math.floor(realisticRidesPerHour).toLocaleString()}`);
    
    // 6. Corridas por dia (24 horas)
    const ridesPerDay = realisticRidesPerHour * 24;
    console.log(`\n📅 CORRIDAS POR DIA (24h): ${Math.floor(ridesPerDay).toLocaleString()}`);
    
    // 7. Considerando picos de tráfego
    const peakHourRides = ridesPerHour * SAFETY_FACTORS.peakHourMultiplier;
    console.log(`\n📈 CORRIDAS POR HORA (PICO): ${Math.floor(peakHourRides).toLocaleString()}`);
    
    // 8. Capacidade com overhead
    const ridesPerDayWithOverhead = ridesPerDay * (1 - SAFETY_FACTORS.overhead);
    console.log(`\n⚠️  CORRIDAS POR DIA (COM OVERHEAD 30%): ${Math.floor(ridesPerDayWithOverhead).toLocaleString()}`);
    
    // 9. Capacidade recomendada (com buffer de segurança)
    const recommendedDailyCapacity = ridesPerDayWithOverhead * (1 - SAFETY_FACTORS.buffer);
    console.log(`\n✅ CAPACIDADE RECOMENDADA (COM BUFFER 20%): ${Math.floor(recommendedDailyCapacity).toLocaleString()} corridas/dia`);
    
    // 9.1. Análise adicional: limite por conexões simultâneas
    const maxRidesByConnections = maxConcurrentRides * (86400 / AVERAGE_RIDE_DURATION); // 24h em segundos
    console.log(`\n🔗 LIMITE POR CONEXÕES SIMULTÂNEAS: ${Math.floor(maxRidesByConnections).toLocaleString()} corridas/dia`);
    
    // Usar o menor valor entre os dois limites
    const finalCapacity = Math.min(recommendedDailyCapacity, maxRidesByConnections * (1 - SAFETY_FACTORS.overhead) * (1 - SAFETY_FACTORS.buffer));
    console.log(`\n🎯 CAPACIDADE FINAL (CONSIDERANDO AMBOS OS LIMITES): ${Math.floor(finalCapacity).toLocaleString()} corridas/dia`);
    
    // 10. Análise de conexões simultâneas
    console.log(`\n👥 ANÁLISE DE CONEXÕES:`);
    console.log(`   Máximo de conexões: ${SERVER_SPECS.MAX_CONNECTIONS.toLocaleString()}`);
    
    // Assumindo 2:1 ratio de motoristas:passageiros
    const maxDrivers = Math.floor(SERVER_SPECS.MAX_CONNECTIONS * 0.4); // 40% motoristas
    const maxPassengers = Math.floor(SERVER_SPECS.MAX_CONNECTIONS * 0.6); // 60% passageiros
    console.log(`   Motoristas simultâneos: ~${maxDrivers.toLocaleString()}`);
    console.log(`   Passageiros simultâneos: ~${maxPassengers.toLocaleString()}`);
    
    // 11. Corridas simultâneas (em andamento)
    const concurrentRides = Math.floor((maxPassengers * 0.1)); // 10% dos passageiros em corrida
    console.log(`   Corridas simultâneas: ~${concurrentRides.toLocaleString()}`);
    
    // 12. Resumo final
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMO FINAL');
    console.log('='.repeat(80));
    console.log(`\n🎯 LIMITE RECOMENDADO DE CORRIDAS POR DIA:`);
    console.log(`   ${Math.floor(finalCapacity).toLocaleString()} corridas/dia`);
    console.log(`\n📈 DISTRIBUIÇÃO SUGERIDA:`);
    const avgRidesPerHour = finalCapacity / 24;
    const normalRidesPerHour = Math.floor(avgRidesPerHour);
    const peakRidesPerHour = Math.floor(avgRidesPerHour * SAFETY_FACTORS.peakHourMultiplier);
    console.log(`   - Horário normal: ${normalRidesPerHour.toLocaleString()} corridas/hora`);
    console.log(`   - Horário de pico: ${peakRidesPerHour.toLocaleString()} corridas/hora`);
    console.log(`   - Média diária: ${normalRidesPerHour.toLocaleString()} corridas/hora`);
    
    // 13. Comparação com teste realizado
    console.log(`\n🧪 COMPARAÇÃO COM TESTE REALIZADO:`);
    console.log(`   Teste: 60 motoristas, 30 passageiros, 8 corridas/s configurado`);
    console.log(`   Capacidade teórica: ${ridesPerSecond} corridas/s`);
    console.log(`   Status: ${ridesPerSecond >= 8 ? '✅ Dentro da capacidade' : '⚠️  Próximo do limite'}`);
    
    // 14. Recomendações
    console.log(`\n💡 RECOMENDAÇÕES:`);
    if (recommendedDailyCapacity >= 100000) {
        console.log(`   ✅ Servidor pode suportar operação em escala`);
        console.log(`   ✅ Considerar monitoramento de recursos em picos`);
    } else if (recommendedDailyCapacity >= 50000) {
        console.log(`   ✅ Servidor adequado para operação média`);
        console.log(`   ⚠️  Monitorar recursos durante picos`);
    } else {
        console.log(`   ⚠️  Servidor pode precisar de otimizações`);
        console.log(`   ⚠️  Considerar upgrade ou distribuição de carga`);
    }
    
    console.log(`\n📝 NOTAS:`);
    console.log(`   - Valores calculados com margem de segurança de 20%`);
    console.log(`   - Considera overhead de 30% para outros processos`);
    console.log(`   - Baseado em configuração atual do servidor (${SERVER_SPECS.vCPUs} vCPUs, ${SERVER_SPECS.RAM}GB RAM)`);
    console.log(`   - Assumindo duração média de corrida de ${AVERAGE_RIDE_DURATION / 60} minutos`);
    
    return {
        recommendedDailyCapacity: Math.floor(finalCapacity),
        ridesPerSecond,
        ridesPerHour: Math.floor(realisticRidesPerHour),
        peakHourRides: Math.floor(realisticRidesPerHour * SAFETY_FACTORS.peakHourMultiplier),
        maxConnections: SERVER_SPECS.MAX_CONNECTIONS,
        maxConcurrentRides,
    };
}

// Executar cálculo
if (require.main === module) {
    const results = calculateCapacity();
    
    // Salvar resultados
    const reportPath = path.join(__dirname, `capacity-analysis-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        serverSpecs: SERVER_SPECS,
        eventsPerRide: EVENTS_PER_RIDE,
        safetyFactors: SAFETY_FACTORS,
        results,
    }, null, 2));
    
    console.log(`\n💾 Relatório salvo em: ${reportPath}`);
}

module.exports = { calculateCapacity };

