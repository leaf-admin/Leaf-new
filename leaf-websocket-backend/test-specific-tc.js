/**
 * TESTE ESPECÍFICO: TC-010, TC-011, TC-016
 * 
 * Executa apenas os testes que estavam falhando por não haver DriverPoolMonitor
 */

const testFile = require('./test-queue-system-complete.js');

// Executar apenas os testes específicos
async function runSpecificTests() {
    console.log('\n🧪 EXECUTANDO TESTES ESPECÍFICOS\n');
    console.log('='.repeat(60));
    
    const tests = [
        { name: 'TC-010: Múltiplas Rejeições Consecutivas', fn: testFile.testMultipleRejections },
        { name: 'TC-011: Timing Entre Rejeição e Nova Corrida', fn: testFile.testTimingRejectionNewRide },
        { name: 'TC-016: Motorista Rejeita e Recebe Corrida Mais Antiga', fn: testFile.testDriverRejectsAndGetsOldestRide }
    ];
    
    const results = [];
    
    for (const test of tests) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🧪 ${test.name}`);
        console.log('='.repeat(60));
        
        try {
            const startTime = Date.now();
            await test.fn();
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`\n✅ PASSOU (${duration}s)`);
            results.push({ name: test.name, status: 'PASSOU', duration });
        } catch (error) {
            const duration = ((Date.now() - Date.now()) / 1000).toFixed(1);
            console.log(`\n❌ FALHOU: ${error.message}`);
            results.push({ name: test.name, status: 'FALHOU', error: error.message });
        }
        
        // Aguardar um pouco entre testes
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Resumo final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DOS TESTES');
    console.log('='.repeat(60));
    
    results.forEach(result => {
        if (result.status === 'PASSOU') {
            console.log(`✅ ${result.name}: PASSOU (${result.duration}s)`);
        } else {
            console.log(`❌ ${result.name}: FALHOU - ${result.error}`);
        }
    });
    
    const passed = results.filter(r => r.status === 'PASSOU').length;
    const failed = results.filter(r => r.status === 'FALHOU').length;
    
    console.log('\n' + '='.repeat(60));
    console.log(`📈 RESULTADO: ${passed}/${results.length} passaram, ${failed} falharam`);
    console.log('='.repeat(60) + '\n');
}

// Verificar se as funções estão exportadas
if (typeof testFile.testMultipleRejections === 'function' &&
    typeof testFile.testTimingRejectionNewRide === 'function' &&
    typeof testFile.testDriverRejectsAndGetsOldestRide === 'function') {
    runSpecificTests()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
} else {
    console.error('❌ Funções de teste não encontradas no arquivo');
    console.error('   Verificando exports...');
    console.log('Exports disponíveis:', Object.keys(testFile));
    process.exit(1);
}


