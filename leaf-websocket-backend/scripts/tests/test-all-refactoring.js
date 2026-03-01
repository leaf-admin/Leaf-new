/**
 * TESTE COMPLETO: Refatoração Incremental
 * 
 * Executa todos os testes relacionados à refatoração.
 */

const { spawn } = require('child_process');
const path = require('path');

const tests = [
    {
        name: 'Eventos Canônicos',
        file: 'test-canonical-events.js',
        description: 'Valida estrutura e validação de eventos canônicos'
    },
    {
        name: 'Idempotency Service',
        file: 'test-idempotency-service.js',
        description: 'Valida funcionamento do serviço de idempotency'
    }
];

console.log('🧪 TESTE COMPLETO: Refatoração Incremental\n');
console.log('='.repeat(60));
console.log(`📋 Total de testes: ${tests.length}\n`);

let results = [];
let currentTest = 0;

function runTest(test) {
    return new Promise((resolve) => {
        console.log(`\n📝 Executando: ${test.name}`);
        console.log(`   ${test.description}`);
        console.log('   ' + '-'.repeat(50));
        
        const testPath = path.join(__dirname, test.file);
        const proc = spawn('node', [testPath], {
            cwd: path.join(__dirname, '../..'),
            stdio: 'pipe'
        });
        
        let output = '';
        let errorOutput = '';
        
        proc.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        proc.on('close', (code) => {
            const passed = output.includes('✅ TODOS OS TESTES PASSARAM');
            const failed = output.includes('❌ ALGUNS TESTES FALHARAM');
            
            results.push({
                name: test.name,
                passed: passed,
                failed: failed,
                exitCode: code,
                output: output,
                error: errorOutput
            });
            
            if (passed) {
                console.log(`   ✅ ${test.name}: PASSOU\n`);
            } else if (failed) {
                console.log(`   ❌ ${test.name}: FALHOU\n`);
                console.log('   Output:', output.split('\n').slice(-5).join('\n'));
            } else {
                console.log(`   ⚠️  ${test.name}: INCONCLUSIVO (exit code: ${code})\n`);
            }
            
            resolve();
        });
    });
}

async function runAllTests() {
    for (const test of tests) {
        await runTest(test);
    }
    
    // Resumo
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 RESUMO DOS TESTES\n');
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => r.failed).length;
    const inconclusive = results.filter(r => !r.passed && !r.failed).length;
    
    console.log(`✅ Passou: ${passed}/${tests.length}`);
    console.log(`❌ Falhou: ${failed}/${tests.length}`);
    if (inconclusive > 0) {
        console.log(`⚠️  Inconclusivo: ${inconclusive}/${tests.length}`);
    }
    
    console.log('\n' + '='.repeat(60));
    
    // Detalhes
    if (failed > 0 || inconclusive > 0) {
        console.log('\n📋 DETALHES:\n');
        results.forEach((result, index) => {
            if (result.failed || (!result.passed && !result.failed)) {
                console.log(`${index + 1}. ${result.name}:`);
                if (result.error) {
                    console.log(`   Erro: ${result.error.split('\n')[0]}`);
                }
                console.log('');
            }
        });
    }
    
    if (failed === 0 && inconclusive === 0) {
        console.log('\n✅ TODOS OS TESTES PASSARAM!\n');
        process.exit(0);
    } else {
        console.log('\n❌ ALGUNS TESTES FALHARAM OU ESTÃO INCONCLUSIVOS!\n');
        process.exit(1);
    }
}

runAllTests().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});

