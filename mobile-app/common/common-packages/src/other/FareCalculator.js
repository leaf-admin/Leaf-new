import { GetDistance } from './GeoFunctions';
import { calculateTollFees } from './TollCalculator';

// Função para calcular a tarifa base
function calculateBaseFare(distance, time, rateDetails) {
    console.log('[calculateBaseFare] rateDetails:', rateDetails);

    const baseFare = parseFloat(rateDetails?.base_fare) || 0;
    const fixedFee = parseFloat(rateDetails?.fixed_fee) || 0;
    const minFare = parseFloat(rateDetails?.min_fare) || 0;
    const ratePerKm = parseFloat(rateDetails?.rate_per_unit_distance) || 0;
    const ratePerHour = parseFloat(rateDetails?.rate_per_hour) || 0;

    const distanceFare = distance * ratePerKm;
    const timeFare = (time / 3600) * ratePerHour; // Converter segundos para horas

    let subTotal = baseFare + distanceFare + timeFare + fixedFee;
    if (subTotal < minFare) subTotal = minFare;
    return subTotal;
}

// Função para calcular a taxa de conveniência (DESATIVADA AQUI - Movida para sharedFunctions.js)
function calculateConvenienceFee(totalFare, rateDetails) {
    return 0; // A taxa Leaf é aplicada sobre o Net Total (OpFee + Woovi) direto no checkout final para o motorista
}

// Função para arredondar para o número de casas decimais especificado
function roundToDecimal(value, decimalPrecision = 2) {
    const precision = Math.pow(10, decimalPrecision);
    return Math.round(value * precision) / precision;
}

export function FareCalculator(
    distance, time, rateDetails, instructionData, decimalPrecision, routePoints, vehicleType = 'car', externalTollFee = null
) {
    console.log('Iniciando cálculo de tarifa com os seguintes parâmetros:');
    console.log('- Distância:', distance);
    console.log('- Tempo:', time);
    console.log('- Tipo de veículo:', vehicleType);
    console.log('- Pontos da rota:', routePoints ? routePoints.length : 0);

    // Cálculo da tarifa base
    const baseFare = calculateBaseFare(distance, time, rateDetails);
    console.log('Tarifa base calculada:', baseFare);

    // Cálculo do pedágio
    let tollFee = 0;
    if (externalTollFee !== null && !isNaN(externalTollFee)) {
        tollFee = externalTollFee;
        console.log('Valor do pedágio recebido externamente:', tollFee);
    } else if (routePoints && routePoints.length > 0) {
        tollFee = calculateTollFees(routePoints, vehicleType);
        console.log('Valor do pedágio calculado:', tollFee);
    }

    // Soma do pedágio à tarifa base
    const totalFare = baseFare + tollFee;
    console.log('Valor total (base + pedágio):', totalFare);

    // Cálculo da taxa de conveniência
    const convenienceFee = calculateConvenienceFee(totalFare, rateDetails);
    console.log('Taxa de conveniência:', convenienceFee);

    // Valor final
    const grandTotal = totalFare + convenienceFee; // convenienceFee now essentially 0
    console.log('Valor final da corrida:', grandTotal);

    return {
        baseFare: roundToDecimal(baseFare, decimalPrecision),
        tollFee: roundToDecimal(tollFee, decimalPrecision),
        totalFare: roundToDecimal(totalFare, decimalPrecision),
        convenienceFee: roundToDecimal(convenienceFee, decimalPrecision),
        grandTotal: roundToDecimal(grandTotal, decimalPrecision)
    };
}
