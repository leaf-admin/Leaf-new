// simulation-real-params.js

function calculateDriverShare(tripCost, tollFee = 0, decimalPrecision = 2) {
    let grandTotal = parseFloat(tripCost) || 0;
    let pTollFee = parseFloat(tollFee) || 0;
    let rawFare = grandTotal - pTollFee; // Faturamento sem pedágios

    // Taxa Operacional em Tiers
    let opFee = 0;
    if (rawFare <= 10.00) opFee = 0.79;
    else if (rawFare <= 25.00) opFee = 0.99;
    else opFee = 1.49;

    // Taxa Woovi sobre toda a transação
    let wooviFee = grandTotal * 0.0008; // 0.08%
    if (wooviFee < 0.50) wooviFee = 0.50;

    const driverShare = grandTotal - opFee - wooviFee;

    return {
        tripCost: grandTotal.toFixed(decimalPrecision),
        tollFee: pTollFee.toFixed(decimalPrecision),
        rawFare: rawFare.toFixed(decimalPrecision),
        opFee: opFee.toFixed(decimalPrecision),
        wooviFee: wooviFee.toFixed(decimalPrecision),
        driverShare: driverShare.toFixed(decimalPrecision)
    };
}

console.log("=== SIMULAÇÃO 1: Corrida de R$ 17.00 (Sem Pedágio) ===");
const sim1 = calculateDriverShare(17.00, 0);
console.log(`Valor Pago p/ Passageiro: R$ ${sim1.tripCost}`);
console.log(`- Taxa Operacional (Tier 10-25): R$ ${sim1.opFee}`);
console.log(`- Taxa Woovi (Mínimo): R$ ${sim1.wooviFee}`);
console.log(`Líquido do Motorista: R$ ${sim1.driverShare}`);

console.log("\n=== SIMULAÇÃO 2: Corrida com Pedágio (R$ 30,00 Tarifa + R$ 8.95 Pedágio) = R$ 38.95 ===");
const sim2 = calculateDriverShare(38.95, 8.95);
console.log(`Valor Pago p/ Passageiro: R$ ${sim2.tripCost}`);
console.log(`- Taxa Operacional Aplicada sobre Tarifa Limpa de R$ ${sim2.rawFare} (Tier >25): R$ ${sim2.opFee}`);
console.log(`- Taxa Woovi Aplicada sobre Tarifa Total de R$ ${sim2.tripCost} (0.08%): R$ ${sim2.wooviFee}`);
console.log(`Líquido do Motorista: R$ ${sim2.driverShare}`);

