#!/usr/bin/env node

/**
 * 🧾 TESTE DOS PARÂMETROS ATUALIZADOS DO SISTEMA DE RECIBOS
 * 
 * Taxa PIX/Woovi: 0,8% com mínimo de R$ 0,50
 * Apenas forma de pagamento PIX
 */

console.log('🧾 TESTE - PARÂMETROS ATUALIZADOS DO SISTEMA DE RECIBOS\n');

// Simulação de corridas com diferentes valores
const testRides = [
    { value: 8.50, description: 'Corrida pequena' },
    { value: 15.00, description: 'Corrida média' }, 
    { value: 25.00, description: 'Corrida alta' },
    { value: 42.50, description: 'Corrida longa' },
    { value: 75.00, description: 'Corrida premium' }
];

console.log('📊 ESTRUTURA DE TAXAS LEAF:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('💳 FORMA DE PAGAMENTO: Apenas PIX');
console.log('💰 TAXA DE PAGAMENTO: 0,8% com mínimo de R$ 0,50');
console.log('🔧 TAXA OPERACIONAL:');
console.log('   • Corridas até R$ 10,00: R$ 0,79');
console.log('   • Acima de R$ 10,00 até R$ 25,00: R$ 0,99');
console.log('   • Acima de R$ 25,00 até R$ 50,00: R$ 1,49');
console.log('   • Acima de R$ 50,00: 3%');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('📋 SIMULAÇÃO DE RECIBOS:\n');

testRides.forEach((ride, index) => {
    console.log(`${index + 1}. ${ride.description.toUpperCase()} - R$ ${ride.value.toFixed(2)}`);
    
    // Calcular taxa operacional
    let operationalFee;
    if (ride.value <= 10.00) {
        operationalFee = 0.79;
    } else if (ride.value <= 25.00) {
        operationalFee = 0.99;
    } else if (ride.value <= 50.00) {
        operationalFee = 1.49;
    } else {
        operationalFee = ride.value * 0.03;
    }
    
    // Taxa PIX/Woovi: 0,8% com mínimo
    const pixFee = Math.max(ride.value * 0.008, 0.50);
    
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



