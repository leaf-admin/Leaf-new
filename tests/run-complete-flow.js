#!/usr/bin/env node
/**
 * EXECUTOR SIMPLES PARA TESTE DE CORRIDA COMPLETA
 * 
 * Uso: node run-complete-flow.js [--url WS_URL]
 */

const CompleteRideFlowTest = require('./suites/00-ride-complete-flow.test');
const PARAMS = require('./config/test-parameters');

// Configurar URL do servidor se fornecida
const args = process.argv.slice(2);
if (args.includes('--url')) {
    const urlIndex = args.indexOf('--url');
    if (args[urlIndex + 1]) {
        PARAMS.SERVER.WS_URL = args[urlIndex + 1];
        console.log(`🌐 Usando servidor: ${PARAMS.SERVER.WS_URL}`);
    }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`🚀 TESTE END-TO-END: CORRIDA COMPLETA`);
console.log(`${'='.repeat(60)}`);
console.log(`\n📋 Configurações:`);
console.log(`   Servidor WebSocket: ${PARAMS.SERVER.WS_URL}`);
console.log(`   Timeout de requisição: ${PARAMS.TIMEOUTS.RIDE_REQUEST_TIMEOUT}s`);
console.log(`   Tarifa mínima: R$ ${PARAMS.FARES.MINIMUM_FARE}`);
console.log(`\n${'='.repeat(60)}\n`);

const test = new CompleteRideFlowTest();

test.testCompleteRideFlow()
    .then(() => {
        const results = test.getResults();
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📊 RESULTADOS FINAIS:`);
        console.log(`${'='.repeat(60)}`);
        console.log(`   Total de testes: ${results.total}`);
        console.log(`   ✅ Passou: ${results.passed}`);
        console.log(`   ❌ Falhou: ${results.failed}`);
        
        if (results.errors.length > 0) {
            console.log(`\n   ⚠️  Erros encontrados:`);
            results.errors.forEach((err, index) => {
                console.log(`\n   ${index + 1}. ${err.test}`);
                if (err.reason) {
                    console.log(`      Motivo: ${err.reason}`);
                }
                if (err.error) {
                    console.log(`      Erro: ${err.error}`);
                }
                if (err.stack) {
                    console.log(`      Stack: ${err.stack.split('\n').slice(0, 3).join('\n')}`);
                }
            });
        }
        
        console.log(`\n${'='.repeat(60)}`);
        
        if (results.failed === 0) {
            console.log(`✅ TESTE COMPLETO: TODOS OS PASSOS FORAM EXECUTADOS COM SUCESSO!`);
            process.exit(0);
        } else {
            console.log(`❌ TESTE COMPLETO: ALGUNS PASSOS FALHARAM`);
            process.exit(1);
        }
    })
    .catch(error => {
        console.error(`\n${'='.repeat(60)}`);
        console.error(`❌ ERRO FATAL NO TESTE:`);
        console.error(`${'='.repeat(60)}`);
        console.error(`   ${error.message}`);
        if (error.stack) {
            console.error(`\n   Stack trace:`);
            console.error(`   ${error.stack.split('\n').slice(0, 10).join('\n   ')}`);
        }
        process.exit(1);
    });


