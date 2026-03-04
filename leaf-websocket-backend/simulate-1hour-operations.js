/**
 * Script de Simulação - 1 Hora de Operação na Leaf
 * 
 * Este script simula o comportamento estatístico de uma operação de 1 hora
 * com 250 motoristas ativos em uma cidade como o Rio de Janeiro.
 * Distribui corridas, calcula precificação dinâmica, pedágios, 
 * cancelamentos e gera um relatório financeiro final da plataforma.
 */

// Configurações da Simulação
const NUM_DRIVERS = 250;
const SIMULATION_HOURS = 1;
// Um motorista ocupado faz em média 2.5 corridas por hora. Se 250 estão online, vamos ter demanda aproximada.
const TOTAL_EXPECTED_RIDES = NUM_DRIVERS * 3;

// Tiers de Configuração de Preço
const CATEGORIES = {
    'Leaf Plus': { base_fare: 2.79, fixed_fee: 1.10, rate_per_hour: 15.60, rate_per_unit_distance: 1.53, min_fare: 8.50, weight: 0.85 },
    'Leaf Elite': { base_fare: 4.98, fixed_fee: 1.80, rate_per_hour: 17.40, rate_per_unit_distance: 2.41, min_fare: 10.50, weight: 0.15 }
};

// Constantes de Probabilidade e Fluxo
const CHANCE_CANCELED = 0.12; // 12% passageiros cancelam antes de embarcar (0 custo pra plataforma)
const CHANCE_DRIVER_REJECTED = 0.08; // 8% motoristas rejeitam/ignoram o chamado (0 custo, volta pra fila ou cancela)
const CHANCE_REFUNDED = 0.01; // 1% corridas SÃO CONCLUÍDAS mas o passageiro pede estorno/chargeback (Leaf arca com prejuízo para não tirar do motorista)
const CHANCE_TOLL = 0.08; // 8% de terem pedágio na rota (ex: Linha Amarela, Transolímpica)
const TOLL_VALUES = [8.95, 9.40];

// Variáveis de Estado do Relatório
let report = {
    totalRequests: 0,
    completed: 0,
    canceledByPassenger: 0,
    rejectedByDriver: 0,
    refundedAfterCompletion: 0,
    totalDistanceKm: 0,
    totalTimeHours: 0,

    // Financeiro
    grossVolume: 0,       // Total processado na ponta do passageiro (GMV)
    totalTollsPaid: 0,    // Total repassado pros pedágios
    totalWooviFees: 0,    // Custos de gateways PIX
    totalDriverPayout: 0, // Total líquido transferido para os motoristas
    leafGrossRevenue: 0,  // Receita bruta da Leaf (Taxas Operacionais Base)
    leafNetRevenue: 0,    // Receita líquida ajustada (após arcar com reembolsos)
    preAcceptanceCancellationCosts: 0 // Phase 8: Custos de taxas PIX assumidos em corridas canceladas na fila
};

// Histograma de distâncias
const distanceBrackets = { short: 0, medium: 0, long: 0 };

// --- Helpers Matemáticos --- //
function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

function pickCategory() {
    const r = Math.random();
    return r <= CATEGORIES['Leaf Plus'].weight ? 'Leaf Plus' : 'Leaf Elite';
}

function generateRide() {
    // 1. Distância entre 1.5km e 35km
    let isLong = Math.random() < 0.2; // 20% chances de ser corrida longa (+12km)
    let distKm = isLong ? randomFloat(12, 35) : randomFloat(1.5, 12);

    // 2. Tempo: depende do trânsito. Media de 3 min/km a 5 min/km em cidade
    let timeHours = distKm * randomFloat(2.5, 6) / 60;

    // 3. Status da Corrida
    const rStatus = Math.random();
    let status = 'completed';
    if (rStatus < CHANCE_CANCELED) {
        status = 'canceled_passenger';
    } else if (rStatus < CHANCE_CANCELED + CHANCE_DRIVER_REJECTED) {
        status = 'rejected_driver';
    } else if (rStatus < CHANCE_CANCELED + CHANCE_DRIVER_REJECTED + CHANCE_REFUNDED) {
        status = 'refunded_post_ride';
    }

    // 4. Pedágio
    let toll = 0;
    if (status !== 'canceled_passenger' && status !== 'rejected_driver' && Math.random() < CHANCE_TOLL) {
        toll = TOLL_VALUES[Math.floor(Math.random() * TOLL_VALUES.length)];
    }

    return { category: pickCategory(), distKm, timeHours, status, toll };
}

function processRide(ride) {
    report.totalRequests++;

    // Fase 1: Se a corrida nunca chegou a acontecer (NÃO gera custos para a Leaf nem pedágio/woovi)
    if (ride.status === 'canceled_passenger') {
        report.canceledByPassenger++;

        // Fase 8: Taxa Woovi Assumida (Fundo de Reserva)
        // O passageiro pagou PIX, a Woovi cobrou a tarifa. O passageiro cancelou, 
        // nós devolvemos 100% mas arcamos com a taxa PIX do gateway.
        const cat = CATEGORIES[ride.category];
        let distCost = ride.distKm * cat.rate_per_unit_distance;
        let timeCost = ride.timeHours * cat.rate_per_hour;
        let estimatedSubTotal = cat.base_fare + cat.fixed_fee + distCost + timeCost;
        if (estimatedSubTotal < cat.min_fare) estimatedSubTotal = cat.min_fare;

        let assumedWooviFee = estimatedSubTotal * 0.0008;
        if (assumedWooviFee < 0.50) assumedWooviFee = 0.50; // Mínimo de 50 centavos

        report.preAcceptanceCancellationCosts += assumedWooviFee;
        report.leafNetRevenue -= assumedWooviFee; // Fundo de Reserva cobre o prejuízo

        return;
    }
    if (ride.status === 'rejected_driver') {
        report.rejectedByDriver++;
        return;
    }

    // Fase 2: A partir daqui, a corrida FOI completada, portanto gerou pagamento PIX via Woovi.
    // Pode ser que ela vire um "refunded" depois se o passageiro reclamar, mas a tarifa já foi cobrada momentaneamente.
    if (ride.distKm < 5) distanceBrackets.short++;
    else if (ride.distKm < 15) distanceBrackets.medium++;
    else distanceBrackets.long++;

    report.totalDistanceKm += ride.distKm;
    report.totalTimeHours += ride.timeHours;

    const cat = CATEGORIES[ride.category];

    // Subtotal Leaf
    let distCost = ride.distKm * cat.rate_per_unit_distance;
    let timeCost = ride.timeHours * cat.rate_per_hour;
    let subTotal = cat.base_fare + cat.fixed_fee + distCost + timeCost;
    if (subTotal < cat.min_fare) subTotal = cat.min_fare;

    let grandTotal = subTotal + ride.toll;
    let rawFare = grandTotal - ride.toll;

    // Calculo da Taxa Operacional Variável da Leaf
    let opFee = 0;
    if (rawFare <= 10.00) opFee = 0.79;
    else if (rawFare <= 25.00) opFee = 0.99;
    else opFee = 1.49;

    // Calculo Woovi PIX (0.08% via regra anterior)
    let wooviFee = grandTotal * 0.0008;
    if (wooviFee < 0.50) wooviFee = 0.50; // Woovi min fee assumido

    let driverShare = grandTotal - opFee - wooviFee;

    // Somar aos acumuladores
    report.grossVolume += grandTotal;
    report.totalTollsPaid += ride.toll;
    report.totalWooviFees += wooviFee;
    report.totalDriverPayout += driverShare;

    // Lógica Financeira do Reembolso: Se a corrida for alvo de refund pós-suporte,
    // a Leaf assume a devolução pro cliente (depende da política real, aqui vamos assumir
    // que a Leaf absorve o estorno pra garantir satisfação e repassa pro motorista).
    if (ride.status === 'completed') {
        report.completed++;
        report.leafGrossRevenue += opFee;
        report.leafNetRevenue += opFee; // Lucra a taxa operacional
    } else if (ride.status === 'refunded_post_ride') {
        report.refundedAfterCompletion++;
        report.leafGrossRevenue += opFee;
        // Estornamos o grossTotal inteiro pro cliente. Como o driver já recebeu, 
        // a Leaf arca com TODO O PREJUÍZO DO SEU PRÓPRIO CAIXA (Valor da Corrida + Woovi Fee)
        report.leafNetRevenue -= (grandTotal + wooviFee - opFee);
    }
}

// ==========================================
// MÁQUINA DE SIMULAÇÃO
// ==========================================
console.log(`\n🚙 INICIANDO SIMULAÇÃO: 1 HORA EM TEMPO REAL...`);
console.log(`📡 Solicitando requisições na região de operação...`);

setTimeout(() => {
    // Variar número de corridas com precisão aleatória ao redor da expectativa
    const numRides = Math.floor(randomFloat(TOTAL_EXPECTED_RIDES * 0.85, TOTAL_EXPECTED_RIDES * 1.15));

    for (let i = 0; i < numRides; i++) {
        const ride = generateRide();
        processRide(ride);
    }

    console.log(`\n======================================================`);
    console.log(`📊 RELATÓRIO DE DESEMPENHO - VISÃO CONSOLIDADA`);
    console.log(`======================================================`);
    console.log(`• Duração Simulada: 1 Hora`);
    console.log(`• Frota Ativa: ${NUM_DRIVERS} motoristas conectados`);
    console.log(`• Requisições Atendidas (Volume Misto): ${numRides}`);
    console.log(`------------------------------------------------------`);
    console.log(`✅ Corridas Concluídas Sucesso: ${report.completed} (${((report.completed / report.totalRequests) * 100).toFixed(1)}%)`);
    console.log(`------------------------------------------------------`);
    console.log(`❌ Cancelado pelo Passageiro (Antes do embarque / R$ 0 de Custo): ${report.canceledByPassenger} (${((report.canceledByPassenger / report.totalRequests) * 100).toFixed(1)}%)`);
    console.log(`❌ Rejeitado/Ignorado pelo Motorista (Voltou pra fila / R$ 0 de Custo): ${report.rejectedByDriver} (${((report.rejectedByDriver / report.totalRequests) * 100).toFixed(1)}%)`);
    console.log(`⚠️ Chargeback / Ticket Suporte (Corrida Paga, mas Reembolsada Lógo Após): ${report.refundedAfterCompletion} (${((report.refundedAfterCompletion / report.totalRequests) * 100).toFixed(1)}%)`);
    console.log(`------------------------------------------------------`);
    console.log(`📏 Distância Total Percorrida: ${report.totalDistanceKm.toFixed(1)} km`);
    console.log(`⏳ Tempo Total Estimado em Trânsito: ${(report.totalTimeHours).toFixed(1)} horas`);
    console.log(`🚗 Perfil de Viagens = Curtas: ${distanceBrackets.short} | Médias: ${distanceBrackets.medium} | Longas: ${distanceBrackets.long}`);

    console.log(`\n======================================================`);
    console.log(`💰 FLUXO FINANCEIRO E FATURAMENTO`);
    console.log(`======================================================`);
    console.log(`[+] Gross Merchandise Volume (GMV): R$ ${report.grossVolume.toFixed(2)}  <-- Total movimentado via Pix`);
    console.log(`[-] Dedução - Custo de Gateway (Woovi): R$ ${report.totalWooviFees.toFixed(2)}`);
    console.log(`[-] Dedução - Pedágios Automáticos: R$ ${report.totalTollsPaid.toFixed(2)}`);
    console.log(`======================================================`);
    console.log(`🚀 REPASSE GERAL LÍQUIDO AOS MOTORISTAS: R$ ${report.totalDriverPayout.toFixed(2)}`);
    console.log(`======================================================\n`);

    console.log(`🍃 RECEITA APLICATIVO (LEAF OP FEES)`);
    console.log(`➜ Receita Bruta Arrecadada: R$ ${report.leafGrossRevenue.toFixed(2)}`);

    let chargebacksLosses = report.leafGrossRevenue - report.leafNetRevenue - report.preAcceptanceCancellationCosts;
    if (chargebacksLosses > 0) {
        console.log(`➜ Custo Assumido via Chargebacks Pós-Corrida: R$ ${chargebacksLosses.toFixed(2)}`);
    }

    console.log(`➜ Custo Fundo de Reserva (Taxas PIX de Corridas Canceladas na Busca): R$ ${report.preAcceptanceCancellationCosts.toFixed(2)}`);

    console.log(`➜ RESULTADO LÍQUIDO ESTIMADO DA HORA: R$ ${report.leafNetRevenue.toFixed(2)}\n`);

    console.log(`💡 PROJEÇÃO MENSAL (Escala de 1 Hora Equivalente x 12h Pico/Dia x 30 Dias)`);
    let dailyNet = report.leafNetRevenue * 12; // Supõe 12 horas de fluxo similar
    let monthlyNet = dailyNet * 30;
    console.log(`➜ Projeção Lucro Líquido ao Mês com 250 motoristas: R$ ${monthlyNet.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`======================================================\n`);

}, 1500);
