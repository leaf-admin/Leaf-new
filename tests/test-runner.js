/**
 * EXECUTOR PRINCIPAL DE TESTES
 * Executa todos os testes automatizados do plano de testes completo
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Limpar Redis antes de iniciar testes (evita conflitos com dados antigos)
function cleanupRedis() {
    try {
        execSync('redis-cli FLUSHDB', { stdio: 'ignore', timeout: 5000 });
        console.log('✅ Redis limpo antes dos testes');
    } catch (error) {
        console.warn('⚠️  Não foi possível limpar Redis (pode estar OK se não houver dados antigos)');
    }
}

// Carregar todos os arquivos de teste
const testsDir = path.join(__dirname, 'suites');
const testFiles = fs.readdirSync(testsDir).filter(file => file.endsWith('.test.js'));

// Resultados
const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    startTime: Date.now(),
};

/**
 * Executa um arquivo de teste
 */
async function runTestFile(testFile) {
    const testPath = path.join(testsDir, testFile);
    console.log(`\n📋 Executando: ${testFile}`);
    
    try {
        const testModule = require(testPath);
        
        if (typeof testModule.run === 'function') {
            const result = await testModule.run();
            results.total += result.total || 0;
            results.passed += result.passed || 0;
            results.failed += result.failed || 0;
            results.skipped += result.skipped || 0;
            
            if (result.errors && result.errors.length > 0) {
                results.errors.push(...result.errors);
            }
        } else {
            console.warn(`⚠️  ${testFile} não exporta função run()`);
        }
    } catch (error) {
        console.error(`❌ Erro ao executar ${testFile}:`, error);
        results.errors.push({
            file: testFile,
            error: error.message,
            stack: error.stack,
        });
        results.failed++;
    }
}

/**
 * Executa todos os testes
 */
async function runAllTests() {
    console.log('🚀 INICIANDO TESTES AUTOMATIZADOS - LEAF APP');
    console.log('='.repeat(60));
    
    // Limpar Redis antes de iniciar (evita conflitos com dados antigos)
    cleanupRedis();
    
    console.log(`📁 Total de arquivos de teste: ${testFiles.length}`);
    
    for (const testFile of testFiles) {
        await runTestFile(testFile);
    }
    
    // Relatório final
    const duration = ((Date.now() - results.startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO FINAL DE TESTES');
    console.log('='.repeat(60));
    console.log(`⏱️  Duração: ${duration}s`);
    console.log(`📋 Total: ${results.total}`);
    console.log(`✅ Passou: ${results.passed}`);
    console.log(`❌ Falhou: ${results.failed}`);
    console.log(`⏭️  Pulado: ${results.skipped}`);
    console.log(`📈 Taxa de Sucesso: ${((results.passed / results.total) * 100).toFixed(2)}%`);
    
    if (results.errors.length > 0) {
        console.log('\n❌ ERROS ENCONTRADOS:');
        results.errors.forEach((error, index) => {
            console.log(`\n${index + 1}. ${error.file || 'Desconhecido'}:`);
            console.log(`   ${error.error || error.message}`);
            if (error.stack) {
                console.log(`   Stack: ${error.stack.split('\n')[0]}`);
            }
        });
    }
    
    // Salvar relatório em arquivo
    const reportPath = path.join(__dirname, 'reports', `test-report-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\n📄 Relatório salvo em: ${reportPath}`);
    
    // Exit code baseado em sucesso
    process.exit(results.failed > 0 ? 1 : 0);
}

// Executar se chamado diretamente
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    });
}

module.exports = { runAllTests, results };



