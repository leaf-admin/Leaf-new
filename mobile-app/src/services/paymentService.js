import Logger from '../utils/Logger';
import axios from 'axios';
import { getSelfHostedApiUrl } from '../config/ApiConfig';

const API_BASE_URL = getSelfHostedApiUrl('');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
});

Logger.log('🔧 [paymentService] API_BASE_URL configurada:', API_BASE_URL);

function normalizeAmountToCents(valueOrAmount) {
  const n = Number(valueOrAmount);
  if (!Number.isFinite(n)) return 0;
  return n > 999 ? Math.round(n) : Math.round(n * 100);
}

export const createPixCharge = async (chargeData) => {
  try {
    const amountInCents = normalizeAmountToCents(chargeData?.value ?? chargeData?.amount ?? 0);
    const rideId = chargeData?.rideId || `legacy_ride_${Date.now()}`;
    const passengerId = chargeData?.passengerId || 'legacy_passenger';
    const rideDetails = chargeData?.rideDetails || {
      origin: chargeData?.origin || 'Origem',
      destination: chargeData?.destination || 'Destino'
    };

    const response = await api.post('/api/payment/advance', {
      passengerId,
      amount: amountInCents,
      rideId,
      rideDetails,
      passengerName: chargeData?.passengerName || 'Passageiro',
      passengerEmail: chargeData?.passengerEmail || 'passenger@leaf.com'
    });

    const payload = response.data || {};
    return {
      data: {
        charge: {
          id: payload.chargeId,
          status: payload.bypass ? 'IN_HOLDING' : 'PENDING',
          qrCodeImage: payload.qrCode || null,
          paymentLinkUrl: payload.paymentLink || null
        }
      }
    };
  } catch (error) {
    Logger.error('❌ Erro ao criar cobrança PIX:', error?.response?.data || error.message);
    throw new Error(error?.response?.data?.error || error.message || 'Falha ao gerar pagamento PIX');
  }
};

export const checkPaymentStatus = async (chargeId) => {
  try {
    const response = await api.get(`/api/payment/status/${chargeId}`);
    return {
      data: {
        charge: {
          id: chargeId,
          status: response.data?.status || 'PENDING',
          value: response.data?.amount || 0
        }
      }
    };
  } catch (error) {
    Logger.error('❌ Erro ao verificar status do pagamento:', error?.response?.data || error.message);
    throw new Error(error?.response?.data?.error || error.message || 'Falha ao verificar status do pagamento');
  }
};

export const listCharges = async (filters = {}) => {
  try {
    const response = await api.get('/api/woovi/list-charges', { params: filters });
    return response;
  } catch (error) {
    Logger.error('❌ Erro ao listar cobranças:', error?.response?.data || error.message);
    throw new Error(error?.response?.data?.error || error.message || 'Falha ao listar cobranças');
  }
};

export const createRefund = async (chargeId, amount, reason) => {
  try {
    const response = await api.post('/api/payment/refund', {
      chargeId,
      amount,
      reason
    });
    return response;
  } catch (error) {
    Logger.error('❌ Erro ao criar reembolso:', error?.response?.data || error.message);
    throw new Error(error?.response?.data?.error || error.message || 'Falha ao processar reembolso');
  }
};

export const calculateCancellationFee = (tripData) => {
  const { status, createdAt, value } = tripData;
  const now = new Date();
  const tripStart = new Date(createdAt);
  const timeElapsed = (now - tripStart) / (1000 * 60);

  let feePercentage = 0;
  let refundPercentage = 100;

  switch (status) {
    case 'PENDING_PAYMENT':
      feePercentage = 0;
      refundPercentage = 100;
      break;
    case 'PAYMENT_CONFIRMED':
    case 'DRIVER_SEARCH':
      feePercentage = 5;
      refundPercentage = 95;
      break;
    case 'DRIVER_ACCEPTED':
      feePercentage = 10;
      refundPercentage = 90;
      break;
    case 'TRIP_STARTED':
      feePercentage = timeElapsed <= 5 ? 25 : 50;
      refundPercentage = timeElapsed <= 5 ? 75 : 50;
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

export const cancelTrip = async (tripId, reason) => {
  try {
    const tripResponse = await api.get(`/api/trips/${tripId}`);
    const tripData = tripResponse.data;
    const cancellationFee = calculateCancellationFee(tripData);

    if (cancellationFee.refundAmount > 0 && tripData.chargeId) {
      await createRefund(tripData.chargeId, cancellationFee.refundAmount, `Cancelamento: ${reason}`);
    }

    await api.put(`/api/trips/${tripId}`, {
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
    Logger.error('❌ Erro ao cancelar corrida:', error?.response?.data || error.message);
    throw new Error(error?.response?.data?.error || error.message || 'Falha ao processar cancelamento');
  }
};

export const isPaymentConfirmed = async (chargeId) => {
  try {
    const status = await checkPaymentStatus(chargeId);
    const paymentStatus = String(status?.data?.charge?.status || '').toUpperCase();
    return paymentStatus === 'CONFIRMED' || paymentStatus === 'COMPLETED' || paymentStatus === 'IN_HOLDING';
  } catch (error) {
    Logger.error('Erro ao verificar confirmação:', error?.message || error);
    return false;
  }
};

export const getChargeDetails = async (chargeId) => {
  try {
    const response = await api.get(`/api/woovi/check-status/${chargeId}`);
    return response.data;
  } catch (error) {
    Logger.error('❌ Erro ao obter detalhes da cobrança:', error?.response?.data || error.message);
    throw new Error(error?.response?.data?.error || error.message || 'Falha ao obter detalhes da cobrança');
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
