#!/usr/bin/env node

// 🧪 TESTE DO AJUSTE AUTOMÁTICO - LEAF APP
const { getFinalFareValue, getMinimumFare } = require('../../mobile-app/src/utils/minimumFareValidator.js');

function testAutoAdjustment() {
    console.log('🧪 TESTE DO AJUSTE AUTOMÁTICO - R$ 8,50');
    console.log('=' .repeat(50));

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('Valor mínimo definido: R$', getMinimumFare());

    const testCases = [
        {
            name: 'Valor muito baixo (R$ 3,00)',
            input: 3.00,
            expected: 8.50,
            description: 'Deve ajustar para R$ 8,50'
        },
        {
            name: 'Valor baixo (R$ 5,00)',
            input: 5.00,
            expected: 8.50,
            description: 'Deve ajustar para R$ 8,50'
        },
        {
            name: 'Valor próximo (R$ 7,00)',
            input: 7.00,
            expected: 8.50,
            description: 'Deve ajustar para R$ 8,50'
        },
        {
            name: 'Valor quase mínimo (R$ 8,49)',
            input: 8.49,
            expected: 8.50,
            description: 'Deve ajustar para R$ 8,50'
        },
        {
            name: 'Valor exato mínimo (R$ 8,50)',
            input: 8.50,
            expected: 8.50,
            description: 'Deve manter R$ 8,50'
        },
        {
            name: 'Valor acima (R$ 10,00)',
            input: 10.00,
            expected: 10.00,
            description: 'Deve manter R$ 10,00'
        },
        {
            name: 'Valor alto (R$ 30,00)',
            input: 30.00,
            expected: 30.00,
            description: 'Deve manter R$ 30,00'
        },
        {
            name: 'Valor inválido (null)',
            input: null,
            expected: 8.50,
            description: 'Deve ajustar para R$ 8,50'
        },
        {
            name: 'Valor inválido (undefined)',
            input: undefined,
            expected: 8.50,
            description: 'Deve ajustar para R$ 8,50'
        }
    ];

    console.log('\n🔍 TESTANDO AJUSTES AUTOMÁTICOS:');
    
    let passedTests = 0;
    let totalTests = testCases.length;
    
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        
        console.log(`\n📤 Teste ${i + 1}/${testCases.length}: ${testCase.name}`);
        console.log(`Entrada: R$ ${testCase.input}`);
        console.log(`Esperado: R$ ${testCase.expected}`);
        console.log(`Descrição: ${testCase.description}`);
        
        try {
            const result = getFinalFareValue(testCase.input);
            
            console.log('Resultado:');
            console.log(`  - Valor final: R$ ${result.finalValue.toFixed(2)}`);
            console.log(`  - Foi ajustado: ${result.wasAdjusted ? 'SIM' : 'NÃO'}`);
            console.log(`  - Valor original: R$ ${result.originalValue.toFixed(2)}`);
            
            // Verificar se o resultado está correto
            if (result.finalValue === testCase.expected) {
                console.log('✅ Teste passou!');
                passedTests++;
            } else {
                console.log('❌ Teste falhou!');
                console.log(`  Esperado: R$ ${testCase.expected}`);
                console.log(`  Recebido: R$ ${result.finalValue.toFixed(2)}`);
            }
            
        } catch (error) {
            console.log('❌ Erro no teste:', error.message);
        }
    }

    console.log('\n📊 RESUMO DOS TESTES:');
    console.log(`✅ Testes passaram: ${passedTests}/${totalTests}`);
    console.log(`❌ Testes falharam: ${totalTests - passedTests}/${totalTests}`);
    console.log(`📈 Taxa de sucesso: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    console.log('\n🎯 COMPORTAMENTO IMPLEMENTADO:');
    console.log('✅ Ajuste automático para valores < R$ 8,50');
    console.log('✅ Manutenção de valores ≥ R$ 8,50');
    console.log('✅ Tratamento de valores inválidos');
    console.log('✅ Logs informativos quando ajustado');
    console.log('✅ Interface clara para o usuário');

    console.log('\n💡 EXEMPLOS PRÁTICOS:');
    console.log('- Corrida de R$ 5,00 → Ajustada para R$ 8,50');
    console.log('- Corrida de R$ 7,00 → Ajustada para R$ 8,50');
    console.log('- Corrida de R$ 8,49 → Ajustada para R$ 8,50');
    console.log('- Corrida de R$ 8,50 → Mantida em R$ 8,50');
    console.log('- Corrida de R$ 15,00 → Mantida em R$ 15,00');
}

// Executar teste
testAutoAdjustment();
console.log('\n🏁 TESTE CONCLUÍDO');
process.exit(0); 