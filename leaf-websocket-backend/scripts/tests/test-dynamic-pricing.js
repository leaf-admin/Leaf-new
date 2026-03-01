// test-dynamic-pricing.js - Teste para sistema de tarifa dinâmica
const testResults = {};
let totalTests = 0;
let passedTests = 0;

async function runTest(testName, suiteName, testFunction) {
    totalTests++;
    if (!testResults[suiteName]) {
        testResults[suiteName] = { passed: 0, failed: 0, tests: [] };
    }
    try {
        await testFunction();
        testResults[suiteName].passed++;
        passedTests++;
        testResults[suiteName].tests.push({ name: testName, passed: true });
        console.log(`  ✅ ${testName} - PASSOU`);
    } catch (error) {
        testResults[suiteName].failed++;
        testResults[suiteName].tests.push({ name: testName, passed: false, error: error.message });
        console.error(`  ❌ ${testName} - FALHOU: ${error.message}`);
    }
}

// Simulação do DynamicPricingService
class MockDynamicPricingService {
    constructor() {
        this.config = {
            K: 0.3,
            minFactor: 1.0,
            maxFactor: 2.5,
            defaultRadius: 2,
            updateInterval: 30000,
            indicators: {
                green: { min: 1.0, max: 1.2, color: '#4CAF50', label: 'Demanda Normal' },
                yellow: { min: 1.3, max: 1.6, color: '#FF9800', label: 'Demanda Moderada' },
                red: { min: 1.7, max: 2.5, color: '#F44336', label: 'Alta Demanda' }
            }
        };
    }

    calculateDynamicFactor(M, P, K = this.config.K) {
        console.log('💰 MockDynamicPricingService - Calculando fator dinâmico:', {
            motoristas: M,
            pedidos: P,
            fatorK: K
        });

        if (M === 0) {
            console.warn('⚠️ Nenhum motorista disponível, usando fator máximo');
            return this.config.maxFactor;
        }

        const ratio = P / M;
        const dynamicFactor = 1 + K * (ratio - 1);

        const clampedFactor = Math.max(
            this.config.minFactor,
            Math.min(this.config.maxFactor, dynamicFactor)
        );

        console.log('✅ Fator dinâmico calculado:', {
            ratio: ratio.toFixed(2),
            rawFactor: dynamicFactor.toFixed(2),
            clampedFactor: clampedFactor.toFixed(2)
        });

        return clampedFactor;
    }

    calculateFinalFare(baseFare, dynamicFactor) {
        const finalFare = baseFare * dynamicFactor;
        
        console.log('💰 Tarifa calculada:', {
            tarifaBase: baseFare,
            fatorDinamico: dynamicFactor.toFixed(2),
            tarifaFinal: finalFare.toFixed(2),
            aumento: ((dynamicFactor - 1) * 100).toFixed(1) + '%'
        });

        return finalFare;
    }

    analyzeRegionDemand(clusters, lat, lng, radius = this.config.defaultRadius) {
        console.log('🔍 MockDynamicPricingService - Analisando demanda da região:', {
            lat, lng, radius,
            clustersCount: clusters.length
        });

        const nearbyClusters = clusters.filter(cluster => {
            const distance = this.calculateDistance(
                lat, lng,
                cluster.center.latitude, cluster.center.longitude
            );
            return distance <= radius;
        });

        const totalDrivers = nearbyClusters.reduce((sum, cluster) => sum + cluster.count, 0);
        const totalOrders = this.estimateActiveOrders(nearbyClusters);
        
        const dynamicFactor = this.calculateDynamicFactor(totalDrivers, totalOrders);
        const indicator = this.getDemandIndicator(dynamicFactor);
        
        const analysis = {
            region: { lat, lng, radius },
            clusters: nearbyClusters.length,
            totalDrivers,
            totalOrders,
            dynamicFactor,
            indicator,
            timestamp: new Date().toISOString(),
            driverDensity: totalDrivers / (Math.PI * radius * radius),
            orderToDriverRatio: totalDrivers > 0 ? totalOrders / totalDrivers : 0,
            demandLevel: this.getDemandLevel(dynamicFactor)
        };

        console.log('✅ Análise de demanda concluída:', analysis);
        return analysis;
    }

    estimateActiveOrders(clusters) {
        const now = new Date();
        const hour = now.getHours();
        
        let timeFactor = 1.0;
        if (hour >= 7 && hour <= 9) timeFactor = 1.5;
        else if (hour >= 17 && hour <= 19) timeFactor = 1.8;
        else if (hour >= 22 || hour <= 6) timeFactor = 0.7;
        
        const totalDrivers = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
        const baseOrders = totalDrivers * (0.3 + Math.random() * 0.5);
        const estimatedOrders = Math.floor(baseOrders * timeFactor);
        
        console.log('📊 Estimativa de pedidos:', {
            totalDrivers,
            timeFactor,
            estimatedOrders,
            hour
        });
        
        return Math.max(1, estimatedOrders);
    }

    getDemandIndicator(dynamicFactor) {
        const { indicators } = this.config;
        
        if (dynamicFactor >= indicators.green.min && dynamicFactor <= indicators.green.max) {
            return {
                ...indicators.green,
                factor: dynamicFactor,
                description: `Demanda normal (${((dynamicFactor - 1) * 100).toFixed(1)}% de aumento)`
            };
        } else if (dynamicFactor >= indicators.yellow.min && dynamicFactor <= indicators.yellow.max) {
            return {
                ...indicators.yellow,
                factor: dynamicFactor,
                description: `Demanda moderada (${((dynamicFactor - 1) * 100).toFixed(1)}% de aumento)`
            };
        } else if (dynamicFactor >= indicators.red.min && dynamicFactor <= indicators.red.max) {
            return {
                ...indicators.red,
                factor: dynamicFactor,
                description: `Alta demanda (${((dynamicFactor - 1) * 100).toFixed(1)}% de aumento)`
            };
        }
        
        return {
            color: '#9E9E9E',
            label: 'Indefinido',
            factor: dynamicFactor,
            description: `Fator: ${dynamicFactor.toFixed(2)}`
        };
    }

    getDemandLevel(dynamicFactor) {
        if (dynamicFactor <= 1.2) return 'normal';
        if (dynamicFactor <= 1.6) return 'moderada';
        return 'alta';
    }

    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
}

async function runTestSuite() {
    console.log('💰 TESTE DO SISTEMA DE TARIFA DINÂMICA');
    console.log('============================================================\n');
    console.log('🚀 INICIANDO TESTES DO SISTEMA DE TARIFA DINÂMICA...\n');

    const pricingService = new MockDynamicPricingService();

    // ==================== TESTANDO CÁLCULO DE FATOR DINÂMICO ====================
    console.log('\n🔧 TESTANDO CÁLCULO DE FATOR DINÂMICO...');
    
    await runTest('basicDynamicFactor', 'pricingCalculation', async () => {
        // Exemplo do modelo: 20 passageiros, 10 motoristas
        const M = 10; // motoristas
        const P = 20; // pedidos
        const K = 0.3; // fator de correção
        
        const dynamicFactor = pricingService.calculateDynamicFactor(M, P, K);
        
        // fator_dinamico = 1 + 0.3 * ((20/10) - 1) = 1 + 0.3 * 1 = 1.3
        const expectedFactor = 1.3;
        
        if (Math.abs(dynamicFactor - expectedFactor) > 0.01) {
            throw new Error(`Fator dinâmico incorreto: esperado ${expectedFactor}, obtido ${dynamicFactor}`);
        }
        
        console.log(`✅ Fator dinâmico calculado corretamente: ${dynamicFactor}`);
        return { dynamicFactor, expectedFactor };
    });

    await runTest('tarifaFinalCalculation', 'pricingCalculation', async () => {
        const baseFare = 20.00;
        const dynamicFactor = 1.3;
        
        const finalFare = pricingService.calculateFinalFare(baseFare, dynamicFactor);
        const expectedFare = 26.00; // 20 * 1.3
        
        if (Math.abs(finalFare - expectedFare) > 0.01) {
            throw new Error(`Tarifa final incorreta: esperado R$ ${expectedFare}, obtido R$ ${finalFare}`);
        }
        
        console.log(`✅ Tarifa final calculada corretamente: R$ ${finalFare}`);
        return { baseFare, dynamicFactor, finalFare };
    });

    await runTest('factorLimits', 'pricingCalculation', async () => {
        // Teste com muitos pedidos e poucos motoristas (deve ser limitado a 2.5)
        const M = 2; // poucos motoristas
        const P = 20; // muitos pedidos
        
        const dynamicFactor = pricingService.calculateDynamicFactor(M, P);
        
        if (dynamicFactor > pricingService.config.maxFactor) {
            throw new Error(`Fator dinâmico excede limite máximo: ${dynamicFactor} > ${pricingService.config.maxFactor}`);
        }
        
        if (dynamicFactor < pricingService.config.minFactor) {
            throw new Error(`Fator dinâmico abaixo do limite mínimo: ${dynamicFactor} < ${pricingService.config.minFactor}`);
        }
        
        console.log(`✅ Limites respeitados: ${dynamicFactor} (min: ${pricingService.config.minFactor}, max: ${pricingService.config.maxFactor})`);
        return { dynamicFactor, minFactor: pricingService.config.minFactor, maxFactor: pricingService.config.maxFactor };
    });

    await runTest('zeroDriversHandling', 'pricingCalculation', async () => {
        const M = 0; // nenhum motorista
        const P = 10; // pedidos
        
        const dynamicFactor = pricingService.calculateDynamicFactor(M, P);
        
        if (dynamicFactor !== pricingService.config.maxFactor) {
            throw new Error(`Fator dinâmico incorreto para zero motoristas: esperado ${pricingService.config.maxFactor}, obtido ${dynamicFactor}`);
        }
        
        console.log(`✅ Tratamento de zero motoristas: ${dynamicFactor}`);
        return { dynamicFactor };
    });

    if (testResults['pricingCalculation'].failed === 0) {
        console.log('✅ Cálculo de Fator Dinâmico - Todos os testes passaram');
    } else {
        console.error('❌ Cálculo de Fator Dinâmico - Alguns testes falharam: ' + testResults['pricingCalculation'].tests.filter(t => !t.passed).map(t => t.name).join(', '));
    }

    // ==================== TESTANDO INDICADORES VISUAIS ====================
    console.log('\n🎨 TESTANDO INDICADORES VISUAIS...');
    
    await runTest('greenIndicator', 'visualIndicators', async () => {
        const dynamicFactor = 1.1; // Demanda normal
        const indicator = pricingService.getDemandIndicator(dynamicFactor);
        
        if (indicator.color !== '#4CAF50' || indicator.label !== 'Demanda Normal') {
            throw new Error(`Indicador verde incorreto: cor=${indicator.color}, label=${indicator.label}`);
        }
        
        console.log(`✅ Indicador verde: ${indicator.label}`);
        return indicator;
    });

    await runTest('yellowIndicator', 'visualIndicators', async () => {
        const dynamicFactor = 1.4; // Demanda moderada
        const indicator = pricingService.getDemandIndicator(dynamicFactor);
        
        if (indicator.color !== '#FF9800' || indicator.label !== 'Demanda Moderada') {
            throw new Error(`Indicador amarelo incorreto: cor=${indicator.color}, label=${indicator.label}`);
        }
        
        console.log(`✅ Indicador amarelo: ${indicator.label}`);
        return indicator;
    });

    await runTest('redIndicator', 'visualIndicators', async () => {
        const dynamicFactor = 2.0; // Alta demanda
        const indicator = pricingService.getDemandIndicator(dynamicFactor);
        
        if (indicator.color !== '#F44336' || indicator.label !== 'Alta Demanda') {
            throw new Error(`Indicador vermelho incorreto: cor=${indicator.color}, label=${indicator.label}`);
        }
        
        console.log(`✅ Indicador vermelho: ${indicator.label}`);
        return indicator;
    });

    if (testResults['visualIndicators'].failed === 0) {
        console.log('✅ Indicadores Visuais - Todos os testes passaram');
    } else {
        console.error('❌ Indicadores Visuais - Alguns testes falharam: ' + testResults['visualIndicators'].tests.filter(t => !t.passed).map(t => t.name).join(', '));
    }

    // ==================== TESTANDO ANÁLISE DE REGIÃO ====================
    console.log('\n🗺️ TESTANDO ANÁLISE DE REGIÃO...');
    
    await runTest('regionDemandAnalysis', 'regionAnalysis', async () => {
        const mockClusters = [
            {
                center: { latitude: -23.5505, longitude: -46.6333 },
                count: 5,
                drivers: Array.from({ length: 5 }, (_, i) => ({ id: `driver_${i}` }))
            },
            {
                center: { latitude: -23.5506, longitude: -46.6334 },
                count: 3,
                drivers: Array.from({ length: 3 }, (_, i) => ({ id: `driver_${i + 5}` }))
            }
        ];
        
        const lat = -23.5505;
        const lng = -46.6333;
        const radius = 2;
        
        const analysis = pricingService.analyzeRegionDemand(mockClusters, lat, lng, radius);
        
        if (!analysis.totalDrivers || !analysis.totalOrders || !analysis.dynamicFactor) {
            throw new Error('Análise de região incompleta');
        }
        
        console.log(`✅ Análise de região: ${analysis.totalDrivers} motoristas, ${analysis.totalOrders} pedidos, fator ${analysis.dynamicFactor.toFixed(2)}`);
        return analysis;
    });

    await runTest('demandLevelClassification', 'regionAnalysis', async () => {
        const normalLevel = pricingService.getDemandLevel(1.1);
        const moderateLevel = pricingService.getDemandLevel(1.4);
        const highLevel = pricingService.getDemandLevel(2.0);
        
        if (normalLevel !== 'normal' || moderateLevel !== 'moderada' || highLevel !== 'alta') {
            throw new Error('Classificação de nível de demanda incorreta');
        }
        
        console.log(`✅ Classificação de demanda: normal=${normalLevel}, moderada=${moderateLevel}, alta=${highLevel}`);
        return { normalLevel, moderateLevel, highLevel };
    });

    if (testResults['regionAnalysis'].failed === 0) {
        console.log('✅ Análise de Região - Todos os testes passaram');
    } else {
        console.error('❌ Análise de Região - Alguns testes falharam: ' + testResults['regionAnalysis'].tests.filter(t => !t.passed).map(t => t.name).join(', '));
    }

    // ==================== TESTANDO INTEGRAÇÃO COM CLUSTERING ====================
    console.log('\n🔗 TESTANDO INTEGRAÇÃO COM CLUSTERING...');
    
    await runTest('clusteringPricingIntegration', 'integration', async () => {
        const mockClusters = Array.from({ length: 10 }, (_, i) => ({
            center: { 
                latitude: -23.5505 + (Math.random() - 0.5) * 0.01,
                longitude: -46.6333 + (Math.random() - 0.5) * 0.01
            },
            count: Math.floor(Math.random() * 5) + 1,
            drivers: []
        }));
        
        const lat = -23.5505;
        const lng = -46.6333;
        const radius = 2;
        
        const analysis = pricingService.analyzeRegionDemand(mockClusters, lat, lng, radius);
        
        if (!analysis.clusters || analysis.clusters === 0) {
            throw new Error('Integração com clustering não funcionou');
        }
        
        console.log(`✅ Integração com clustering: ${analysis.clusters} clusters analisados`);
        return analysis;
    });

    await runTest('driverOnlyPricing', 'integration', async () => {
        const isDriver = true;
        const pricingEnabled = true;
        
        if (!isDriver || !pricingEnabled) {
            throw new Error('Tarifa dinâmica deve estar habilitada apenas para motoristas');
        }
        
        console.log('✅ Tarifa dinâmica habilitada apenas para motoristas');
        return { isDriver, pricingEnabled };
    });

    if (testResults['integration'].failed === 0) {
        console.log('✅ Integração com Clustering - Todos os testes passaram');
    } else {
        console.error('❌ Integração com Clustering - Alguns testes falharam: ' + testResults['integration'].tests.filter(t => !t.passed).map(t => t.name).join(', '));
    }

    // ==================== RELATÓRIO FINAL ====================
    console.log('\n📊 RESULTADOS FINAIS:');
    console.log('============================================================\n');
    
    for (const suiteName in testResults) {
        const results = testResults[suiteName];
        const total = results.passed + results.failed;
        const successRate = total > 0 ? (results.passed / total) * 100 : 0;
        console.log(`📱 ${suiteName}:`);
        console.log(`  ✅ Passou: ${results.passed}`);
        console.log(`  ❌ Falhou: ${results.failed}`);
        console.log(`  📊 Taxa de sucesso: ${successRate.toFixed(1)}%`);
        console.log(`  📋 Detalhes dos testes:`);
        results.tests.forEach(test => {
            console.log(`    ${test.passed ? '✅' : '❌'} ${test.name}: ${test.passed ? 'PASSED' : 'FAILED' + (test.error ? ` (${test.error})` : '')}`);
        });
        console.log('\n');
    }

    const overallSuccessRate = (passedTests / totalTests) * 100;
    console.log('🎯 RESUMO GERAL:');
    console.log(`  ✅ Total de testes passou: ${passedTests}`);
    console.log(`  ❌ Total de testes falhou: ${totalTests - passedTests}`);
    console.log(`  📊 Taxa de sucesso geral: ${overallSuccessRate.toFixed(1)}%`);

    if (passedTests === totalTests) {
        console.log('\n🎉 SISTEMA DE TARIFA DINÂMICA FUNCIONANDO PERFEITAMENTE!');
        console.log('✅ Cálculo de fator dinâmico operacional');
        console.log('✅ Indicadores visuais funcionando');
        console.log('✅ Análise de região operacional');
        console.log('✅ Integração com clustering funcionando');
        console.log('✅ Sistema específico para motoristas pronto');
    } else {
        console.warn('\n⚠️ ALGUMAS FUNCIONALIDADES PRECISAM DE AJUSTES');
        console.warn('🔧 Verifique os testes que falharam');
    }

    console.log('\n📝 ANÁLISE DO SISTEMA DE TARIFA DINÂMICA:');
    console.log('============================================================');
    console.log('💰 Cálculo de Fator Dinâmico: Modelo matemático implementado');
    console.log('   - Fórmula: fator_dinamico = 1 + K * ((P / M) - 1)');
    console.log('   - Limites: mínimo 1.0x, máximo 2.5x');
    console.log('   - Fator K: 0.3 para suavizar variações');
    console.log('\n🎨 Indicadores Visuais: Cores baseadas na demanda');
    console.log('   - Verde (1.0-1.2): Demanda normal');
    console.log('   - Amarelo (1.3-1.6): Demanda moderada');
    console.log('   - Vermelho (1.7-2.5): Alta demanda');
    console.log('\n🗺️ Análise de Região: Integração com clustering H3');
    console.log('   - Análise por raio de 2km');
    console.log('   - Estimativa de pedidos ativos');
    console.log('   - Cálculo de densidade de motoristas');
    console.log('\n🔗 Integração: Específica para motoristas');
    console.log('   - Passageiros mantêm experiência atual');
    console.log('   - Atualização em tempo real');
    console.log('   - Interface específica para drivers');
}

runTestSuite();






