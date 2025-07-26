// test-corrida-real-simples.cjs - Simulação simplificada de uma corrida real
const NavigationService = require('./src/services/NavigationService.js');

async function simularCorridaReal() {
    console.log('🚗 SIMULAÇÃO PONTA A PONTA: CORRIDA REAL');
    console.log('='.repeat(60));
    
    const navigationService = new NavigationService();
    
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
    // CÁLCULO MANUAL DOS CUSTOS
    // ========================================
    console.log('\n💰 CÁLCULO DETALHADO DOS CUSTOS');
    console.log('-'.repeat(50));
    
    // FASE 1: Busca de viagem (2 minutos)
    const custosFase1 = {
        googleMaps: {
            geocoding: 2 * 0.025, // 2 requests (origem + destino)
            directions: 1 * 0.025, // 1 request (rota com trânsito)
            total: 3 * 0.025
        },
        redis: {
            operations: 10 * 0.000005, // 10 operações
            connections: 1 * 0.0005, // 1 conexão
            total: 0.00055
        },
        mobileApi: 3 * 0.000005, // 3 chamadas
        location: 4 * 0.000005 // 4 updates
    };
    
    // FASE 2: Aceitação da viagem (30 segundos)
    const custosFase2 = {
        firebase: {
            functions: 1 * 0.0000125, // 1 execução
            database: {
                reads: 3 * 0.0000003, // 3 reads
                writes: 3 * 0.0000009, // 3 writes
                total: 0.0000036
            },
            total: 0.0000161
        },
        websocket: {
            connections: 2 * 0.0005, // 2 conexões
            messages: 10 * 0.000005, // 10 mensagens
            total: 0.00105
        }
    };
    
    // FASE 3: Viagem em andamento (28 minutos)
    const custosFase3 = {
        location: 56 * 0.000005, // 56 updates (2/min × 28 min)
        mobileApi: 28 * 0.000005, // 28 chamadas (1/min × 28 min)
        redis: 140 * 0.000005, // 140 operações (5/min × 28 min)
        websocket: 112 * 0.000005 // 112 mensagens (4/min × 28 min)
    };
    
    // FASE 4: Finalização e pagamento (2 minutos)
    const custosFase4 = {
        firebase: {
            functions: 1 * 0.0000125, // 1 execução
            database: {
                reads: 5 * 0.0000003, // 5 reads
                writes: 5 * 0.0000009, // 5 writes
                total: 0.000006
            },
            total: 0.0000185
        },
        woovi: Math.max(corrida.valorCorrida * 0.008, 0.50) // 0.8% ou R$ 0,50 mínimo
    };
    
    // CUSTOS TOTAIS
    const custosTotais = {
        googleMaps: custosFase1.googleMaps.total,
        firebase: custosFase2.firebase.total + custosFase4.firebase.total,
        redis: custosFase1.redis.total + custosFase3.redis,
        websocket: custosFase2.websocket.total + custosFase3.websocket,
        mobileApi: custosFase1.mobileApi + custosFase3.mobileApi,
        location: custosFase1.location + custosFase3.location,
        woovi: custosFase4.woovi
    };
    
    const custoOperacionalTotal = custosTotais.googleMaps + custosTotais.firebase + 
                                 custosTotais.redis + custosTotais.websocket + 
                                 custosTotais.mobileApi + custosTotais.location;
    
    // ========================================
    // ANÁLISE FINANCEIRA
    // ========================================
    console.log('\n📊 CUSTOS POR FASE:');
    console.log('-'.repeat(50));
    
    console.log('🔄 FASE 1 - Busca de viagem:');
    console.log(`   Google Maps: R$ ${custosFase1.googleMaps.total.toFixed(6)}`);
    console.log(`   Redis: R$ ${custosFase1.redis.total.toFixed(6)}`);
    console.log(`   Mobile API: R$ ${custosFase1.mobileApi.toFixed(6)}`);
    console.log(`   Location: R$ ${custosFase1.location.toFixed(6)}`);
    
    console.log('\n✅ FASE 2 - Aceitação:');
    console.log(`   Firebase: R$ ${custosFase2.firebase.total.toFixed(6)}`);
    console.log(`   WebSocket: R$ ${custosFase2.websocket.total.toFixed(6)}`);
    
    console.log('\n🚗 FASE 3 - Viagem (28 min):');
    console.log(`   Location: R$ ${custosFase3.location.toFixed(6)}`);
    console.log(`   Mobile API: R$ ${custosFase3.mobileApi.toFixed(6)}`);
    console.log(`   Redis: R$ ${custosFase3.redis.toFixed(6)}`);
    console.log(`   WebSocket: R$ ${custosFase3.websocket.toFixed(6)}`);
    
    console.log('\n💳 FASE 4 - Pagamento:');
    console.log(`   Firebase: R$ ${custosFase4.firebase.total.toFixed(6)}`);
    console.log(`   Woovi PIX: R$ ${custosFase4.woovi.toFixed(2)}`);
    
    console.log('\n💰 CUSTOS TOTAIS POR CATEGORIA:');
    console.log('-'.repeat(50));
    console.log(`   Google Maps: R$ ${custosTotais.googleMaps.toFixed(6)}`);
    console.log(`   Firebase: R$ ${custosTotais.firebase.toFixed(6)}`);
    console.log(`   Redis: R$ ${custosTotais.redis.toFixed(6)}`);
    console.log(`   WebSocket: R$ ${custosTotais.websocket.toFixed(6)}`);
    console.log(`   Mobile API: R$ ${custosTotais.mobileApi.toFixed(6)}`);
    console.log(`   Location: R$ ${custosTotais.location.toFixed(6)}`);
    console.log(`   Total operacional: R$ ${custoOperacionalTotal.toFixed(6)}`);
    console.log(`   Woovi PIX: R$ ${custosTotais.woovi.toFixed(2)} (não impacta nosso lucro)`);
    
    // ========================================
    // RESULTADO FINANCEIRO
    // ========================================
    console.log('\n📈 RESULTADO FINANCEIRO:');
    console.log('='.repeat(60));
    
    const receitaOperacional = 1.55; // Taxa fixa por corrida
    const valorCorrida = corrida.valorCorrida;
    const pagamentoMotorista = valorCorrida; // Motorista recebe valor total
    const nossoLucro = receitaOperacional - custoOperacionalTotal;
    const margemLucro = (nossoLucro / receitaOperacional) * 100;
    
    console.log('\n📊 RECEITAS:');
    console.log(`   Valor da corrida: R$ ${valorCorrida.toFixed(2)}`);
    console.log(`   Nossa receita (taxa operacional): R$ ${receitaOperacional.toFixed(2)}`);
    
    console.log('\n💳 PAGAMENTO:');
    console.log(`   Taxa Woovi PIX: R$ ${custosTotais.woovi.toFixed(2)} (debitada do valor da corrida)`);
    console.log(`   Pagamento ao motorista: R$ ${pagamentoMotorista.toFixed(2)}`);
    
    console.log('\n📈 RESULTADO:');
    console.log(`   Receita operacional: R$ ${receitaOperacional.toFixed(2)}`);
    console.log(`   Custos operacionais: R$ ${custoOperacionalTotal.toFixed(6)}`);
    console.log(`   NOSSO LUCRO: R$ ${nossoLucro.toFixed(6)}`);
    console.log(`   Margem de lucro: ${margemLucro.toFixed(2)}%`);
    
    // ========================================
    // COMPARAÇÃO COM MODELO TRADICIONAL
    // ========================================
    console.log('\n📊 COMPARAÇÃO COM MODELO TRADICIONAL:');
    console.log('-'.repeat(50));
    
    // Modelo tradicional: 1 direction por minuto durante 28 minutos
    const directionsTradicional = 28 * 1;
    const custoGoogleTradicional = directionsTradicional * 0.025;
    const economiaGoogle = custoGoogleTradicional - custosTotais.googleMaps;
    const economiaPercentual = (economiaGoogle / custoGoogleTradicional) * 100;
    
    console.log(`   Google Maps tradicional: R$ ${custoGoogleTradicional.toFixed(3)}`);
    console.log(`   Google Maps híbrido: R$ ${custosTotais.googleMaps.toFixed(3)}`);
    console.log(`   Economia Google Maps: R$ ${economiaGoogle.toFixed(3)}`);
    console.log(`   Economia percentual: ${economiaPercentual.toFixed(1)}%`);
    
    // ========================================
    // PROJEÇÕES DE ESCALA
    // ========================================
    console.log('\n📈 PROJEÇÕES DE ESCALA:');
    console.log('-'.repeat(50));
    
    const corridasPorDia = [10, 50, 100, 500, 1000];
    
    console.log('   Corridas/dia | Custo/dia | Lucro/dia | Margem');
    console.log('   ------------|-----------|-----------|--------');
    
    corridasPorDia.forEach(corridas => {
        const custoDia = custoOperacionalTotal * corridas;
        const lucroDia = nossoLucro * corridas;
        const margemDia = (lucroDia / (receitaOperacional * corridas)) * 100;
        
        console.log(`   ${corridas.toString().padStart(11)} | ${custoDia.toFixed(2).padStart(9)} | ${lucroDia.toFixed(2).padStart(9)} | ${margemDia.toFixed(1)}%`);
    });
    
    // ========================================
    // ANÁLISE DE SUSTENTABILIDADE
    // ========================================
    console.log('\n🎯 ANÁLISE DE SUSTENTABILIDADE:');
    console.log('-'.repeat(50));
    
    let nivelSustentabilidade, statusSustentabilidade;
    
    if (margemLucro > 80) {
        nivelSustentabilidade = 'EXCELENTE';
        statusSustentabilidade = 'Muito sustentável';
    } else if (margemLucro > 60) {
        nivelSustentabilidade = 'BOA';
        statusSustentabilidade = 'Sustentável';
    } else if (margemLucro > 40) {
        nivelSustentabilidade = 'MODERADA';
        statusSustentabilidade = 'Aceitável';
    } else if (margemLucro > 20) {
        nivelSustentabilidade = 'BAIXA';
        statusSustentabilidade = 'Precisa otimização';
    } else {
        nivelSustentabilidade = 'CRÍTICA';
        statusSustentabilidade = 'Insustentável';
    }
    
    console.log(`   Nível: ${nivelSustentabilidade}`);
    console.log(`   Margem: ${margemLucro.toFixed(1)}%`);
    console.log(`   Status: ${statusSustentabilidade}`);
    
    // ========================================
    // RECOMENDAÇÕES
    // ========================================
    console.log('\n💡 RECOMENDAÇÕES:');
    console.log('-'.repeat(50));
    
    if (margemLucro > 80) {
        console.log('✅ Margem excelente - modelo muito sustentável');
        console.log('🚀 Pode expandir agressivamente');
    } else if (margemLucro > 60) {
        console.log('✅ Margem boa - modelo sustentável');
        console.log('📈 Pode crescer com confiança');
    } else if (margemLucro > 40) {
        console.log('⚠️ Margem moderada - considerar otimizações');
        console.log('🔧 Implementar cache Redis para mapas');
        console.log('📊 Otimizar Firebase Functions');
    } else {
        console.log('❌ Margem baixa - necessidade de otimizações urgentes');
        console.log('🚨 Revisar arquitetura de custos');
        console.log('💰 Negociar melhores taxas com provedores');
    }
    
    console.log('\n🎯 CONCLUSÃO:');
    console.log(`O modelo híbrido de navegação reduz significativamente os custos`);
    console.log(`e mantém uma margem de lucro de ${margemLucro.toFixed(1)}%.`);
    console.log(`A sustentabilidade é ${statusSustentabilidade.toLowerCase()}.`);
    console.log(`Economia de ${economiaPercentual.toFixed(1)}% nos custos do Google Maps.`);
}

simularCorridaReal().catch(console.error); 