#!/usr/bin/env node

/**
 * Script para executar testes que falharam isoladamente
 * Uso: node run-failed-tests.js [teste1] [teste2] ...
 * 
 * Testes disponíveis:
 * - 00-ride-complete-flow
 * - 02-cancelamentos
 * - 03-timeouts-rejeicoes
 * - 04-no-show
 * - 05-multiplas-corridas
 * - 06-reconexao
 * - 07-casos-erro
 */

const path = require('path');
const fs = require('fs');

const testsDir = path.join(__dirname, 'suites');

// Mapeamento de nomes curtos para arquivos
const testMap = {
    '00': '00-ride-complete-flow.test.js',
    'ride-complete': '00-ride-complete-flow.test.js',
    '02': '02-cancelamentos.test.js',
    'cancelamentos': '02-cancelamentos.test.js',
    '03': '03-timeouts-rejeicoes.test.js',
    'timeouts': '03-timeouts-rejeicoes.test.js',
    '04': '04-no-show.test.js',
    'noshow': '04-no-show.test.js',
    '05': '05-multiplas-corridas.test.js',
    'multiplas': '05-multiplas-corridas.test.js',
    '06': '06-reconexao.test.js',
    'reconexao': '06-reconexao.test.js',
    '07': '07-casos-erro.test.js',
    'erro': '07-casos-erro.test.js',
};

// Testes que falharam (baseado no último relatório)
const failedTests = [
    '00-ride-complete-flow.test.js',  // Notificação não corresponde
    '02-cancelamentos.test.js',        // Vários timeouts
    '03-timeouts-rejeicoes.test.js',  // Timeout newRideRequest
    '04-no-show.test.js',             // Accept ride timeout
    '06-reconexao.test.js',           // Accept ride timeout
];

async function runTestFile(testFile) {
    const testPath = path.join(testsDir, testFile);
    
    if (!fs.existsSync(testPath)) {
        console.error(`❌ Arquivo não encontrado: ${testFile}`);
        return null;
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 Executando: ${testFile}`);
    console.log('='.repeat(60));
    
    try {
        const testModule = require(testPath);
        if (typeof testModule.run === 'function') {
            const startTime = Date.now();
            const result = await testModule.run();
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            
            console.log(`\n${'='.repeat(60)}`);
            console.log(`📊 Resultado: ${testFile}`);
            console.log('='.repeat(60));
            console.log(`⏱️  Duração: ${duration}s`);
            console.log(`📋 Total: ${result.total || 0}`);
            console.log(`✅ Passou: ${result.passed || 0}`);
            console.log(`❌ Falhou: ${result.failed || 0}`);
            console.log(`⏭️  Pulado: ${result.skipped || 0}`);
            
            if (result.errors && result.errors.length > 0) {
                console.log(`\n❌ Erros:`);
                result.errors.forEach((err, idx) => {
                    console.log(`\n${idx + 1}. ${err.test || 'Desconhecido'}:`);
                    console.log(`   ${err.error || err.reason || JSON.stringify(err)}`);
                    if (err.stack) {
                        console.log(`   Stack: ${err.stack.split('\n')[0]}`);
                    }
                });
            }
            
            return result;
        } else {
            console.warn(`⚠️  ${testFile} não exporta função run()`);
            return null;
        }
    } catch (error) {
        console.error(`❌ Erro ao executar ${testFile}:`, error);
        return {
            total: 0,
            passed: 0,
            failed: 1,
            skipped: 0,
            errors: [{ test: testFile, error: error.message, stack: error.stack }]
        };
    }
}

async function main() {
    // Limpar Redis antes de iniciar (evita conflitos com dados antigos)
    const { execSync } = require('child_process');
    try {
        execSync('redis-cli FLUSHDB', { stdio: 'ignore', timeout: 5000 });
        console.log('✅ Redis limpo antes dos testes');
    } catch (error) {
        console.warn('⚠️  Não foi possível limpar Redis (pode estar OK se não houver dados antigos)');
    }
    
    const args = process.argv.slice(2);
    
    let testsToRun = [];
    
    if (args.length === 0) {
        // Se não especificou, roda os que falharam
        console.log('🚀 Executando testes que falharam...\n');
        testsToRun = failedTests;
    } else {
        // Mapear argumentos para arquivos
        for (const arg of args) {
            const testFile = testMap[arg.toLowerCase()];
            if (testFile) {
                testsToRun.push(testFile);
            } else if (arg.endsWith('.test.js')) {
                testsToRun.push(arg);
            } else {
                console.warn(`⚠️  Teste não reconhecido: ${arg}`);
            }
        }
    }
    
    if (testsToRun.length === 0) {
        console.log('❌ Nenhum teste para executar');
        console.log('\nTestes disponíveis:');
        Object.entries(testMap).forEach(([key, file]) => {
            console.log(`  - ${key} → ${file}`);
        });
        process.exit(1);
    }
    
    console.log(`\n🚀 Executando ${testsToRun.length} teste(s)...\n`);
    
    const results = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        errors: []
    };
    
    for (const testFile of testsToRun) {
        const result = await runTestFile(testFile);
        if (result) {
            results.total += result.total || 0;
            results.passed += result.passed || 0;
            results.failed += result.failed || 0;
            results.skipped += result.skipped || 0;
            if (result.errors && result.errors.length > 0) {
                results.errors.push(...result.errors);
            }
        }
        
        // Pequena pausa entre testes
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RELATÓRIO FINAL`);
    console.log('='.repeat(60));
    console.log(`📋 Total: ${results.total}`);
    console.log(`✅ Passou: ${results.passed}`);
    console.log(`❌ Falhou: ${results.failed}`);
    console.log(`⏭️  Pulado: ${results.skipped}`);
    if (results.total > 0) {
        const successRate = ((results.passed / results.total) * 100).toFixed(2);
        console.log(`📈 Taxa de Sucesso: ${successRate}%`);
    }
    
    if (results.errors.length > 0) {
        console.log(`\n❌ Total de erros: ${results.errors.length}`);
    }
    
    process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});

