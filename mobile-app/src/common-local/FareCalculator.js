import Logger from '../utils/Logger';
import { GetDistance } from './GeoFunctions';
import { calculateTollFees } from './TollCalculator';


// Função para calcular a tarifa base
function calculateBaseFare(distance, time, rateDetails) {
    Logger.log('[calculateBaseFare] rateDetails:', rateDetails);
    Logger.log('[calculateBaseFare] rateDetails.base_fare:', rateDetails?.base_fare);
    
    const baseFare = parseFloat(rateDetails?.base_fare) || 0;
    const ratePerKm = parseFloat(rateDetails?.rate_per_unit_distance) || 0;
    const ratePerHour = parseFloat(rateDetails?.rate_per_hour) || 0;
    
    const distanceFare = distance * ratePerKm;
    const timeFare = (time / 3600) * ratePerHour; // Converter segundos para horas
    
    return baseFare + distanceFare + timeFare;
}

// Função para calcular a taxa de conveniência
function calculateConvenienceFee(totalFare, rateDetails) {
    const feeType = rateDetails?.convenience_fee_type;
    const feeRate = parseFloat(rateDetails?.convenience_fees) || 0;
    
    if (feeType === 'percentage') {
        return (totalFare * feeRate) / 100;
    } else {
        return feeRate; // flat rate
    }
}

// Função para arredondar para o número de casas decimais especificado
function roundToDecimal(value, decimalPrecision = 2) {
    const precision = Math.pow(10, decimalPrecision);
    return Math.round(value * precision) / precision;
}

export function FareCalculator(
    distance, time, rateDetails, instructionData, decimalPrecision, routePoints, vehicleType = 'car', externalTollFee = null
) {
    Logger.log('Iniciando cálculo de tarifa com os seguintes parâmetros:');
    Logger.log('- Distância:', distance);
    Logger.log('- Tempo:', time);
    Logger.log('- Tipo de veículo:', vehicleType);
    Logger.log('- Pontos da rota:', routePoints ? routePoints.length : 0);

    // Cálculo da tarifa base
    const baseFare = calculateBaseFare(distance, time, rateDetails);
    Logger.log('Tarifa base calculada:', baseFare);

    // Cálculo do pedágio
    let tollFee = 0;
    if (externalTollFee !== null && !isNaN(externalTollFee)) {
        tollFee = externalTollFee;
        Logger.log('Valor do pedágio recebido externamente:', tollFee);
    } else if (routePoints && routePoints.length > 0) {
        tollFee = calculateTollFees(routePoints, vehicleType);
        Logger.log('Valor do pedágio calculado:', tollFee);
    }

    // Soma do pedágio à tarifa base
    const totalFare = baseFare + tollFee;
    Logger.log('Valor total (base + pedágio):', totalFare);

    // Cálculo da taxa de conveniência
    const convenienceFee = calculateConvenienceFee(totalFare, rateDetails);
    Logger.log('Taxa de conveniência:', convenienceFee);

    // Valor final
    const grandTotal = totalFare + convenienceFee;
    Logger.log('Valor final da corrida:', grandTotal);

    return {
        baseFare: roundToDecimal(baseFare, decimalPrecision),
        tollFee: roundToDecimal(tollFee, decimalPrecision),
        totalFare: roundToDecimal(totalFare, decimalPrecision),
        convenienceFee: roundToDecimal(convenienceFee, decimalPrecision),
        grandTotal: roundToDecimal(grandTotal, decimalPrecision)
    };
}
