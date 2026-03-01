/**
 * Recomendações de Escalabilidade
 * 
 * Analisa a capacidade atual e recomenda configurações para expansão
 */

const SERVER_SPECS = {
    current: {
        vCPUs: 4,
        RAM: 8, // GB
        MAX_CONNECTIONS: 10000,
        MAX_REQUESTS_PER_SECOND: 5000,
        dailyCapacity: 16000, // corridas/dia
        cost: 200, // R$/mês (estimado)
    }
};

// Configurações recomendadas por volume
const SCALING_TIERS = [
    {
        tier: 'Atual',
        dailyRides: '0 - 16.000',
        vCPUs: 4,
        RAM: 8,
        connections: 10000,
        reqPerSecond: 5000,
        cost: 200,
        recommendation: '✅ Configuração atual adequada',
        notes: [
            'Servidor atual suporta até 16k corridas/dia',
            'Monitorar recursos durante picos',
            'Considerar otimizações de código antes de upgrade'
        ]
    },
    {
        tier: 'Crescimento Inicial',
        dailyRides: '16.000 - 50.000',
        vCPUs: 8,
        RAM: 16,
        connections: 20000,
        reqPerSecond: 10000,
        cost: 400,
        recommendation: '🟡 Upgrade para VPS 16GB',
        notes: [
            'Dobrar recursos (CPU e RAM)',
            'Aumentar limite de conexões para 20k',
            'Manter mesma arquitetura',
            'Custo: ~R$ 400/mês'
        ]
    },
    {
        tier: 'Escala Média',
        dailyRides: '50.000 - 150.000',
        vCPUs: 16,
        RAM: 32,
        connections: 50000,
        reqPerSecond: 25000,
        cost: 800,
        recommendation: '🟠 Upgrade para VPS 32GB ou Load Balancer',
        notes: [
            'Opção 1: VPS única 32GB (mais simples)',
            'Opção 2: Load Balancer + 2x VPS 16GB (mais resiliente)',
            'Implementar cluster de servidores',
            'Custo: R$ 800-1000/mês'
        ]
    },
    {
        tier: 'Alta Escala',
        dailyRides: '150.000 - 500.000',
        vCPUs: 32,
        RAM: 64,
        connections: 100000,
        reqPerSecond: 50000,
        cost: 1600,
        recommendation: '🔴 Arquitetura Distribuída',
        notes: [
            'Load Balancer (Nginx/HAProxy)',
            '3-4 servidores WebSocket (16GB cada)',
            'Redis Cluster dedicado',
            'CDN para assets estáticos',
            'Custo: R$ 1.600-2.000/mês'
        ]
    },
    {
        tier: 'Escala Enterprise',
        dailyRides: '500.000+',
        vCPUs: 'Multi-region',
        RAM: 'Distribuído',
        connections: 500000,
        reqPerSecond: 100000,
        cost: 5000,
        recommendation: '🚀 Arquitetura Multi-Region',
        notes: [
            'Múltiplas regiões (SP, RJ, etc)',
            'Load Balancer global',
            'Redis Cluster distribuído',
            'Database replicação',
            'Custo: R$ 5.000+/mês'
        ]
    }
];

// Estratégias de escalabilidade
const SCALING_STRATEGIES = {
    vertical: {
        name: 'Escalabilidade Vertical (Scale Up)',
        description: 'Aumentar recursos da VPS atual',
        pros: [
            'Mais simples de implementar',
            'Sem mudanças na arquitetura',
            'Menor latência (tudo em um servidor)',
            'Mais barato para volumes médios'
        ],
        cons: [
            'Limite físico do servidor',
            'Ponto único de falha',
            'Downtime durante upgrade',
            'Custo cresce linearmente'
        ],
        whenToUse: 'Até 50.000 corridas/dia'
    },
    horizontal: {
        name: 'Escalabilidade Horizontal (Scale Out)',
        description: 'Adicionar mais servidores',
        pros: [
            'Sem limite teórico',
            'Alta disponibilidade',
            'Sem downtime para expansão',
            'Melhor distribuição de carga'
        ],
        cons: [
            'Mais complexo de gerenciar',
            'Requer Load Balancer',
            'Sincronização entre servidores',
            'Custo inicial maior'
        ],
        whenToUse: 'Acima de 50.000 corridas/dia'
    },
    hybrid: {
        name: 'Escalabilidade Híbrida',
        description: 'Combinar scale up e scale out',
        pros: [
            'Melhor custo-benefício',
            'Flexibilidade',
            'Pode escalar gradualmente'
        ],
        cons: [
            'Mais complexo',
            'Requer planejamento'
        ],
        whenToUse: '50.000 - 150.000 corridas/dia'
    }
};

// Triggers para expansão
const EXPANSION_TRIGGERS = {
    cpu: {
        threshold: 75, // %
        action: 'Considerar upgrade quando CPU > 75% por mais de 1 hora',
        monitoring: 'Monitorar via top/htop ou ferramentas de métricas'
    },
    memory: {
        threshold: 80, // %
        action: 'Considerar upgrade quando RAM > 80% por mais de 1 hora',
        monitoring: 'Monitorar via free -m ou ferramentas de métricas'
    },
    connections: {
        threshold: 80, // % do máximo
        action: 'Considerar upgrade quando conexões > 8.000 (80% de 10k)',
        monitoring: 'Monitorar via métricas do Socket.IO'
    },
    latency: {
        threshold: 500, // ms
        action: 'Considerar upgrade quando latência P95 > 500ms',
        monitoring: 'Monitorar via logs e métricas de performance'
    },
    errorRate: {
        threshold: 1, // %
        action: 'Considerar upgrade quando taxa de erro > 1%',
        monitoring: 'Monitorar via logs de erro'
    }
};

function generateRecommendations() {
    console.log('📊 RECOMENDAÇÕES DE ESCALABILIDADE\n');
    console.log('='.repeat(80));
    
    // 1. Situação atual
    console.log('\n📈 SITUAÇÃO ATUAL:');
    console.log(`   VPS: ${SERVER_SPECS.current.vCPUs} vCPUs, ${SERVER_SPECS.current.RAM}GB RAM`);
    console.log(`   Capacidade: ${SERVER_SPECS.current.dailyCapacity.toLocaleString()} corridas/dia`);
    console.log(`   Custo: R$ ${SERVER_SPECS.current.cost}/mês`);
    
    // 2. Tiers de escalabilidade
    console.log('\n' + '='.repeat(80));
    console.log('🎯 TIERS DE ESCALABILIDADE');
    console.log('='.repeat(80));
    
    SCALING_TIERS.forEach((tier, index) => {
        console.log(`\n${index + 1}. ${tier.tier.toUpperCase()}`);
        console.log(`   Volume: ${tier.dailyRides} corridas/dia`);
        console.log(`   Configuração: ${tier.vCPUs} vCPUs, ${tier.RAM}GB RAM`);
        console.log(`   Conexões: ${tier.connections.toLocaleString()}`);
        console.log(`   Requisições: ${tier.reqPerSecond.toLocaleString()}/s`);
        console.log(`   Custo: R$ ${tier.cost}/mês`);
        console.log(`   Recomendação: ${tier.recommendation}`);
        console.log(`   Notas:`);
        tier.notes.forEach(note => console.log(`     - ${note}`));
    });
    
    // 3. Estratégias de escalabilidade
    console.log('\n' + '='.repeat(80));
    console.log('🔄 ESTRATÉGIAS DE ESCALABILIDADE');
    console.log('='.repeat(80));
    
    Object.values(SCALING_STRATEGIES).forEach(strategy => {
        console.log(`\n📌 ${strategy.name}`);
        console.log(`   Descrição: ${strategy.description}`);
        console.log(`   Quando usar: ${strategy.whenToUse}`);
        console.log(`   ✅ Vantagens:`);
        strategy.pros.forEach(pro => console.log(`      - ${pro}`));
        console.log(`   ⚠️  Desvantagens:`);
        strategy.cons.forEach(con => console.log(`      - ${con}`));
    });
    
    // 4. Triggers para expansão
    console.log('\n' + '='.repeat(80));
    console.log('🚨 TRIGGERS PARA EXPANSÃO');
    console.log('='.repeat(80));
    
    Object.entries(EXPANSION_TRIGGERS).forEach(([metric, config]) => {
        console.log(`\n📊 ${metric.toUpperCase()}:`);
        console.log(`   Limite: ${config.threshold}${metric === 'cpu' || metric === 'memory' || metric === 'connections' ? '%' : metric === 'latency' ? 'ms' : '%'}`);
        console.log(`   Ação: ${config.action}`);
        console.log(`   Monitoramento: ${config.monitoring}`);
    });
    
    // 5. Plano de ação recomendado
    console.log('\n' + '='.repeat(80));
    console.log('📋 PLANO DE AÇÃO RECOMENDADO');
    console.log('='.repeat(80));
    
    console.log('\n🟢 FASE 1: Otimização (0 - 16k corridas/dia)');
    console.log('   ✅ Manter configuração atual');
    console.log('   ✅ Implementar monitoramento detalhado');
    console.log('   ✅ Otimizar queries e cache');
    console.log('   ✅ Implementar rate limiting');
    console.log('   💰 Custo: R$ 200/mês');
    
    console.log('\n🟡 FASE 2: Upgrade Vertical (16k - 50k corridas/dia)');
    console.log('   🔄 Upgrade para VPS 16GB (8 vCPUs, 16GB RAM)');
    console.log('   🔄 Aumentar limites de conexão para 20k');
    console.log('   🔄 Implementar cluster Redis');
    console.log('   💰 Custo: R$ 400/mês');
    
    console.log('\n🟠 FASE 3: Escala Híbrida (50k - 150k corridas/dia)');
    console.log('   🔄 Opção A: VPS única 32GB (16 vCPUs, 32GB RAM)');
    console.log('   🔄 Opção B: Load Balancer + 2x VPS 16GB');
    console.log('   🔄 Implementar auto-scaling');
    console.log('   💰 Custo: R$ 800-1000/mês');
    
    console.log('\n🔴 FASE 4: Arquitetura Distribuída (150k+ corridas/dia)');
    console.log('   🔄 Load Balancer (Nginx/HAProxy)');
    console.log('   🔄 3-4 servidores WebSocket (16GB cada)');
    console.log('   🔄 Redis Cluster dedicado');
    console.log('   🔄 CDN para assets');
    console.log('   💰 Custo: R$ 1.600-2.000/mês');
    
    // 6. Recomendação específica
    console.log('\n' + '='.repeat(80));
    console.log('💡 RECOMENDAÇÃO ESPECÍFICA');
    console.log('='.repeat(80));
    
    console.log('\n🎯 Para sua situação atual:');
    console.log('   1. ✅ Manter VPS atual (4 vCPUs, 8GB RAM)');
    console.log('   2. 📊 Implementar monitoramento proativo');
    console.log('   3. 🔍 Observar métricas por 30 dias');
    console.log('   4. 📈 Quando atingir 12k corridas/dia (75% da capacidade):');
    console.log('      - Planejar upgrade para VPS 16GB');
    console.log('      - Tempo estimado: 1-2 meses de crescimento');
    
    console.log('\n⚡ Quando fazer upgrade:');
    console.log('   - CPU > 75% por mais de 1 hora consecutiva');
    console.log('   - RAM > 80% por mais de 1 hora consecutiva');
    console.log('   - Conexões > 8.000 (80% do máximo)');
    console.log('   - Latência P95 > 500ms');
    console.log('   - Taxa de erro > 1%');
    
    console.log('\n💰 Análise de Custo:');
    console.log('   - Atual: R$ 200/mês = R$ 0,0125 por corrida (16k/dia)');
    console.log('   - Upgrade 16GB: R$ 400/mês = R$ 0,008 por corrida (50k/dia)');
    console.log('   - Upgrade 32GB: R$ 800/mês = R$ 0,0053 por corrida (150k/dia)');
    console.log('   💡 Conclusão: Custo por corrida diminui com escala!');
    
    return {
        current: SERVER_SPECS.current,
        tiers: SCALING_TIERS,
        strategies: SCALING_STRATEGIES,
        triggers: EXPANSION_TRIGGERS
    };
}

// Executar
if (require.main === module) {
    const results = generateRecommendations();
    
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.join(__dirname, `scaling-recommendations-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    
    console.log(`\n💾 Relatório salvo em: ${reportPath}`);
}

module.exports = { generateRecommendations };


