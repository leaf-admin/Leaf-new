// Simulate Taquara -> BarraShopping with Leaf Plus and Leaf Elite rules
const distance_km = 15.14;
const time_min = 20;
const time_hours = time_min / 60; // 0.333 horas
const toll_fee = 8.95; // Transolímpica detectada pelo TollUtils

// Leaf Plus Configs
const leafPlus = {
    name: 'Leaf Plus',
    base_fare: 2.79,
    fixed_fee: 1.10,
    rate_per_hour: 15.60,
    rate_per_unit_distance: 1.53,
    min_fare: 8.50,
};

// Leaf Elite Configs
const leafElite = {
    name: 'Leaf Elite',
    base_fare: 4.98,
    fixed_fee: 1.80,
    rate_per_hour: 17.40,
    rate_per_unit_distance: 2.41,
    min_fare: 10.50,
};

function calculateFare(car, distance, timeHours, toll) {
    let base = car.base_fare;
    let fixed = car.fixed_fee;
    let distCost = distance * car.rate_per_unit_distance;
    let timeCost = timeHours * car.rate_per_hour;

    let subTotal = base + fixed + distCost + timeCost;
    if (subTotal < car.min_fare) subTotal = car.min_fare;

    let grandTotal = subTotal + toll;

    // Calcula driver share usando a nova formula abstrata do sharedFunctions.js
    let rawFare = grandTotal - toll;
    let opFee = 0;
    if (rawFare <= 10.00) opFee = 0.79;
    else if (rawFare <= 25.00) opFee = 0.99;
    else opFee = 1.49;

    let wooviFee = grandTotal * 0.0008; // 0.08%
    if (wooviFee < 0.50) wooviFee = 0.50;

    const driverShare = grandTotal - opFee - wooviFee;

    return {
        name: car.name,
        base: base.toFixed(2),
        fixed: fixed.toFixed(2),
        distCost: distCost.toFixed(2),
        timeCost: timeCost.toFixed(2),
        subTotal: subTotal.toFixed(2),
        toll: toll.toFixed(2),
        grandTotal: grandTotal.toFixed(2),
        opFee: opFee.toFixed(2),
        wooviFee: wooviFee.toFixed(2),
        driverShare: driverShare.toFixed(2)
    }
}

console.log("=========================================");
console.log(` SIMULAÇÃO GEOGRÁFICA (Taquara -> BarraShopping)`);
console.log(` Distância: ${distance_km} km | Duração Estimada: ${time_min} min`);
console.log(` Intersecção Geofence Mapeada: Transolímpica (R$ ${toll_fee})`);
console.log("=========================================\n");

const simPlus = calculateFare(leafPlus, distance_km, time_hours, toll_fee);
const simElite = calculateFare(leafElite, distance_km, time_hours, toll_fee);

function printSim(sim) {
    console.log(`🚗 Categoria: ${sim.name}`);
    console.log(`-----------------------------------------`);
    console.log(`[+] Preço Base (Bandeirada): R$ ${sim.base}`);
    console.log(`[+] Custo Fixo da Corrida: R$ ${sim.fixed}`);
    console.log(`[+] Custo por Distância (${distance_km} km): R$ ${sim.distCost}`);
    console.log(`[+] Custo por Tempo Estimado (${time_min} min): R$ ${sim.timeCost}`);
    console.log(`-----------------------------------------`);
    console.log(`🏷️ SUB-TOTAL LÍQUIDO (Sem Pedágio): R$ ${sim.subTotal}`);
    console.log(`🚧 Pedágio Físico a ser cruzado: R$ ${sim.toll}`);
    console.log(`=========================================`);
    console.log(`💳 TOTAL PAGO PELO PASSAGEIRO: R$ ${sim.grandTotal}`);
    console.log(`=========================================`);
    console.log(`==> REPASSE FINANCEIRO AO MOTORISTA <==`);
    console.log(`[-] Cortesia de Pagamento do Pedágio: (Retém o total pago de R$ ${sim.toll})`);
    console.log(`[-] Taxa Operacional do Aplicativo (Leaf): R$ ${sim.opFee}`);
    console.log(`[-] Taxa Financeira de Transação (Woovi): R$ ${sim.wooviFee}`);
    console.log(`=========================================`);
    console.log(`💰 SALDO FINAL DEPOSITADO AO MOTORISTA: R$ ${sim.driverShare}\n`);
}

printSim(simPlus);
printSim(simElite);
