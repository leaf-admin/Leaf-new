const testFile = require('./test-queue-system-complete.js');

async function runTC008() {
    console.log('\n🧪 EXECUTANDO TESTE QUE FALHOU (TC-008)\n');
    console.log('='.repeat(60));

    try {
        const startTime = Date.now();
        await testFile.testRaceConditionMultipleAccept();
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n✅ PASSOU (${duration}s)`);
        process.exit(0);
    } catch (error) {
        console.log(`\n❌ FALHOU: ${error.message}`);
        console.log(error.stack);
        process.exit(1);
    }
}

runTC008();
