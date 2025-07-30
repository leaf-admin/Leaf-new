import api from '../common-local/api';

// Configurações do Woovi
const WOOVI_CONFIG = {
  baseURL: 'https://api.openpix.com.br',
  appId: 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100',
  apiKey: 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzZhVCs2NnkrUFAwZXJxRG1qTFlDTHFjMWZORXJyOS9Yd0V5aENkYldsMDA9'
};

/**
 * Criar cobrança PIX via Woovi
 * @param {Object} chargeData - Dados da cobrança
 * @param {number} chargeData.value - Valor em centavos
 * @param {string} chargeData.correlationID - ID único da corrida
 * @param {string} chargeData.comment - Comentário da cobrança
 * @param {number} chargeData.expiresIn - Tempo de expiração em segundos
 * @returns {Promise<Object>} Dados da cobrança criada
 */
export const createPixCharge = async (chargeData) => {
  try {
    const response = await api.post('/api/v1/charge', {
      value: chargeData.value,
      correlationID: chargeData.correlationID,
      comment: chargeData.comment,
      expiresIn: chargeData.expiresIn || 3600
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    return response;
  } catch (error) {
    console.error('Erro ao criar cobrança PIX:', error);
    throw new Error('Falha ao gerar pagamento PIX');
  }
};

/**
 * Verificar status de uma cobrança
 * @param {string} chargeId - ID da cobrança
 * @returns {Promise<Object>} Status da cobrança
 */
export const checkPaymentStatus = async (chargeId) => {
  try {
    const response = await api.get(`/api/v1/charge/${chargeId}`, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    return response;
  } catch (error) {
    console.error('Erro ao verificar status do pagamento:', error);
    throw new Error('Falha ao verificar status do pagamento');
  }
};

/**
 * Listar cobranças do usuário
 * @param {Object} filters - Filtros opcionais
 * @returns {Promise<Object>} Lista de cobranças
 */
export const listCharges = async (filters = {}) => {
  try {
    const queryParams = new URLSearchParams(filters);
    const response = await api.get(`/api/v1/charge?${queryParams}`, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    return response;
  } catch (error) {
    console.error('Erro ao listar cobranças:', error);
    throw new Error('Falha ao listar cobranças');
  }
};

/**
 * Criar reembolso para uma cobrança
 * @param {string} chargeId - ID da cobrança
 * @param {number} amount - Valor do reembolso em centavos
 * @param {string} reason - Motivo do reembolso
 * @returns {Promise<Object>} Dados do reembolso
 */
export const createRefund = async (chargeId, amount, reason) => {
  try {
    const response = await api.post(`/api/v1/charge/${chargeId}/refund`, {
      amount,
      reason
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    return response;
  } catch (error) {
    console.error('Erro ao criar reembolso:', error);
    throw new Error('Falha ao processar reembolso');
  }
};

/**
 * Calcular taxa de cancelamento baseada no status da corrida
 * @param {Object} tripData - Dados da corrida
 * @returns {Object} Taxa e valor de reembolso
 */
export const calculateCancellationFee = (tripData) => {
  const { status, createdAt, value } = tripData;
  const now = new Date();
  const tripStart = new Date(createdAt);
  const timeElapsed = (now - tripStart) / (1000 * 60); // minutos

  let feePercentage = 0;
  let refundPercentage = 100;

  switch (status) {
    case 'PENDING_PAYMENT':
      feePercentage = 0;
      refundPercentage = 100;
      break;
    
    case 'PAYMENT_CONFIRMED':
      feePercentage = 5;
      refundPercentage = 95;
      break;
    
    case 'DRIVER_SEARCH':
      feePercentage = 5;
      refundPercentage = 95;
      break;
    
    case 'DRIVER_ACCEPTED':
      feePercentage = 10;
      refundPercentage = 90;
      break;
    
    case 'TRIP_STARTED':
      if (timeElapsed <= 5) {
        feePercentage = 25;
        refundPercentage = 75;
      } else {
        feePercentage = 50;
        refundPercentage = 50;
      }
      break;
    
    case 'TRIP_COMPLETED':
      feePercentage = 100;
      refundPercentage = 0;
      break;
    
    default:
      feePercentage = 0;
      refundPercentage = 100;
  }

  const feeAmount = Math.round((value * feePercentage) / 100);
  const refundAmount = Math.round((value * refundPercentage) / 100);

  return {
    feePercentage,
    refundPercentage,
    feeAmount,
    refundAmount,
    originalValue: value
  };
};

/**
 * Processar cancelamento de corrida
 * @param {string} tripId - ID da corrida
 * @param {string} reason - Motivo do cancelamento
 * @returns {Promise<Object>} Resultado do cancelamento
 */
export const cancelTrip = async (tripId, reason) => {
  try {
    // Buscar dados da corrida
    const tripResponse = await api.get(`/trips/${tripId}`);
    const tripData = tripResponse.data;

    // Calcular taxa de cancelamento
    const cancellationFee = calculateCancellationFee(tripData);

    // Se há reembolso, processar via Woovi
    if (cancellationFee.refundAmount > 0) {
      await createRefund(
        tripData.chargeId,
        cancellationFee.refundAmount,
        `Cancelamento: ${reason}`
      );
    }

    // Atualizar status da corrida
    await api.put(`/trips/${tripId}`, {
      status: 'CANCELLED',
      cancelledAt: new Date().toISOString(),
      cancellationReason: reason,
      refundAmount: cancellationFee.refundAmount,
      cancellationFee: cancellationFee.feeAmount
    });

    return {
      success: true,
      refundAmount: cancellationFee.refundAmount,
      fee: cancellationFee.feeAmount,
      reason
    };
  } catch (error) {
    console.error('Erro ao cancelar corrida:', error);
    throw new Error('Falha ao processar cancelamento');
  }
};

/**
 * Verificar se o pagamento foi confirmado
 * @param {string} chargeId - ID da cobrança
 * @returns {Promise<boolean>} True se confirmado
 */
export const isPaymentConfirmed = async (chargeId) => {
  try {
    const status = await checkPaymentStatus(chargeId);
    return status.data.charge.status === 'CONFIRMED';
  } catch (error) {
    console.error('Erro ao verificar confirmação:', error);
    return false;
  }
};

/**
 * Obter dados de uma cobrança específica
 * @param {string} chargeId - ID da cobrança
 * @returns {Promise<Object>} Dados da cobrança
 */
export const getChargeDetails = async (chargeId) => {
  try {
    const response = await api.get(`/api/v1/charge/${chargeId}`, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  } catch (error) {
    console.error('Erro ao obter detalhes da cobrança:', error);
    throw new Error('Falha ao obter detalhes da cobrança');
  }
};

export default {
  createPixCharge,
  checkPaymentStatus,
  listCharges,
  createRefund,
  calculateCancellationFee,
  cancelTrip,
  isPaymentConfirmed,
  getChargeDetails
}; 