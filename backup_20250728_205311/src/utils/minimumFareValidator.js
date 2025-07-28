/**
 * Validador de Tarifa Mínima - Leaf App
 * Valor mínimo definido: R$ 8,50
 */

const MINIMUM_FARE = 8.50; // R$ 8,50

/**
 * Valida se o valor da corrida está acima do mínimo
 * @param {number} fareValue - Valor da corrida
 * @returns {boolean} - true se válido, false se abaixo do mínimo
 */
export const isValidFare = (fareValue) => {
    if (!fareValue || isNaN(fareValue)) {
        return false;
    }
    return parseFloat(fareValue) >= MINIMUM_FARE;
};

/**
 * Obtém o valor mínimo da tarifa
 * @returns {number} - Valor mínimo (R$ 8,50)
 */
export const getMinimumFare = () => {
    return MINIMUM_FARE;
};

/**
 * Valida e retorna mensagem de erro se necessário
 * @param {number} fareValue - Valor da corrida
 * @returns {object} - { isValid: boolean, message: string }
 */
export const validateFareWithMessage = (fareValue) => {
    if (!fareValue || isNaN(fareValue)) {
        return {
            isValid: false,
            message: 'Valor da corrida inválido'
        };
    }

    const value = parseFloat(fareValue);
    
    if (value < MINIMUM_FARE) {
        return {
            isValid: false,
            message: `Valor mínimo da corrida é R$ ${MINIMUM_FARE.toFixed(2)}`
        };
    }

    return {
        isValid: true,
        message: 'Valor válido'
    };
};

/**
 * Ajusta o valor para o mínimo se necessário
 * @param {number} fareValue - Valor da corrida
 * @returns {number} - Valor ajustado (mínimo se necessário)
 */
export const adjustToMinimumFare = (fareValue) => {
    if (!fareValue || isNaN(fareValue)) {
        return MINIMUM_FARE;
    }

    const value = parseFloat(fareValue);
    return value < MINIMUM_FARE ? MINIMUM_FARE : value;
};

/**
 * Obtém o valor final da corrida (ajustado se necessário)
 * @param {number} calculatedFare - Valor calculado
 * @returns {object} - { finalValue: number, wasAdjusted: boolean, originalValue: number }
 */
export const getFinalFareValue = (calculatedFare) => {
    if (!calculatedFare || isNaN(calculatedFare)) {
        return {
            finalValue: MINIMUM_FARE,
            wasAdjusted: true,
            originalValue: 0
        };
    }

    const originalValue = parseFloat(calculatedFare);
    const finalValue = originalValue < MINIMUM_FARE ? MINIMUM_FARE : originalValue;
    const wasAdjusted = originalValue < MINIMUM_FARE;

    return {
        finalValue,
        wasAdjusted,
        originalValue
    };
};

/**
 * Formata o valor mínimo para exibição
 * @param {string} currency - Moeda (padrão: R$)
 * @returns {string} - Valor formatado
 */
export const formatMinimumFare = (currency = 'R$') => {
    return `${currency} ${MINIMUM_FARE.toFixed(2)}`;
};

/**
 * Verifica se o valor está muito próximo do mínimo (para alertas)
 * @param {number} fareValue - Valor da corrida
 * @param {number} threshold - Limite de proximidade (padrão: 1.00)
 * @returns {boolean} - true se está próximo do mínimo
 */
export const isNearMinimumFare = (fareValue, threshold = 1.00) => {
    if (!fareValue || isNaN(fareValue)) {
        return false;
    }

    const value = parseFloat(fareValue);
    return value <= (MINIMUM_FARE + threshold);
};

export default {
    MINIMUM_FARE,
    isValidFare,
    getMinimumFare,
    validateFareWithMessage,
    adjustToMinimumFare,
    formatMinimumFare,
    isNearMinimumFare
}; 