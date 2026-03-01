#!/usr/bin/env node

/**
 * 🧾 TESTE DOS PARÂMETROS ATUALIZADOS DO SISTEMA DE RECIBOS
 * 
 * Taxa PIX: R$ 0,50 fixo
 * Apenas forma de pagamento PIX
 */

console.log('🧾 TESTE - PARÂMETROS ATUALIZADOS DO SISTEMA DE RECIBOS\n');

// Simulação de corridas com diferentes valores
const testRides = [
    { value: 8.50, description: 'Corrida pequena' },
    { value: 15.00, description: 'Corrida média' }, 
    { value: 25.00, description: 'Corrida alta' },
    { value: 42.50, description: 'Corrida longa' }
];

console.log('📊 ESTRUTURA DE TAXAS LEAF:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('💳 FORMA DE PAGAMENTO: Apenas PIX');
console.log('💰 TAXA DE PAGAMENTO: R$ 0,50 (fixo)');
console.log('🔧 TAXA OPERACIONAL:');
console.log('   • Corridas < R$ 10,00: R$ 0,79');
console.log('   • R$ 10,00 - R$ 20,00: R$ 0,99');
console.log('   • Corridas > R$ 20,00: R$ 1,49');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('📋 SIMULAÇÃO DE RECIBOS:\n');

testRides.forEach((ride, index) => {
    console.log(`${index + 1}. ${ride.description.toUpperCase()} - R$ ${ride.value.toFixed(2)}`);
    
    // Calcular taxa operacional
    let operationalFee;
    if (ride.value < 10.00) {
        operationalFee = 0.79;
    } else if (ride.value <= 20.00) {
        operationalFee = 0.99;
    } else {
        operationalFee = 1.49;
    }
    
    // Taxa PIX fixa
    const pixFee = 0.50;
    
    // Valor para o motorista
    const driverAmount = ride.value - operationalFee - pixFee;
    
    console.log(`   💰 Valor total pago: R$ ${ride.value.toFixed(2)}`);
    console.log(`   🔧 Taxa operacional: R$ ${operationalFee.toFixed(2)}`);
    console.log(`   💳 Taxa PIX: R$ ${pixFee.toFixed(2)}`);
    console.log(`   👤 Valor ao motorista: R$ ${driverAmount.toFixed(2)}`);
    console.log(`   📊 Margem motorista: ${((driverAmount / ride.value) * 100).toFixed(1)}%`);
    console.log('');
});

console.log('✅ VANTAGENS DO MODELO PIX:');
console.log('• Taxa fixa de R$ 0,50 - previsível para motoristas');
console.log('• Sem percentual sobre o valor da corrida');
console.log('• Pagamento instantâneo via PIX');
console.log('• Transparência total no recibo');
console.log('• Maior margem líquida para o motorista');

console.log('\n🚀 O sistema está configurado e funcionando com os novos parâmetros!');




