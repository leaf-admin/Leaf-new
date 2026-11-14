'use strict';

// Pix Out da Woovi (Payment Request) para o saque do motorista: paga qualquer chave
// Pix de banco. O antigo /transfer só move valor entre contas Woovi.
//
// Idempotência: cada saque usa um correlationID fixo (leaf_withdrawal_<id>). Antes
// de criar, consulta se o pagamento já existe; se existe, nunca cria outro. Assim um
// clique repetido, um reinício no meio do envio ou a recuperação de saque travado
// não pagam em dobro.
//
// Resultado de sendPixOut / lookupPixOut:
//   sent      o Pix saiu (APPROVED ou CONFIRMED na Woovi)
//   failed    a Woovi recusou e nada foi pago (pode tentar de novo)
//   not_found nenhum pagamento com esse correlationID (nada foi pago)
//   unknown   não deu para saber (rede, 5xx, status novo): não tentar de novo sem conferir

const { logStructured } = require('../utils/logger');

const SENT_STATUSES = new Set(['APPROVED', 'CONFIRMED', 'COMPLETED']);
const FAILED_STATUSES = new Set(['FAILED', 'DENIED', 'REJECTED', 'CANCELED', 'CANCELLED', 'EXPIRED', 'REFUSED', 'ERROR']);

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpf(digits) {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const calc = (length) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

/**
 * Tipo da chave Pix para a Woovi (CPF, CNPJ, EMAIL, PHONE, RANDOM) e a chave no
 * formato que o DICT espera. 11 dígitos com CPF válido é CPF; senão, celular.
 */
function normalizePixKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return null;
  if (key.includes('@')) return { type: 'EMAIL', alias: key.toLowerCase() };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return { type: 'RANDOM', alias: key.toLowerCase() };
  }
  const digits = onlyDigits(key);
  if (key.startsWith('+')) return { type: 'PHONE', alias: `+${digits}` };
  if (digits.length === 14 && !/^55\d{12}$/.test(digits)) return { type: 'CNPJ', alias: digits };
  if (digits.length === 11 && isValidCpf(digits)) return { type: 'CPF', alias: digits };
  if (digits.length === 11 || digits.length === 10) return { type: 'PHONE', alias: `+55${digits}` };
  if (digits.length === 13 && digits.startsWith('55')) return { type: 'PHONE', alias: `+${digits}` };
  return null;
}

function classifyStatus(status) {
  const value = String(status || '').trim().toUpperCase();
  if (SENT_STATUSES.has(value)) return 'sent';
  if (FAILED_STATUSES.has(value)) return 'failed';
  if (value === 'CREATED') return 'created';
  return 'unknown';
}

function errorText(error) {
  const data = error?.response?.data;
  if (typeof data === 'string') return data.slice(0, 200);
  if (data?.error) return String(data.error).slice(0, 200);
  return String(error?.message || 'erro desconhecido').slice(0, 200);
}

function isClientError(error) {
  const status = Number(error?.response?.status);
  return status >= 400 && status < 500;
}

function createPixOutClient(api, { logger = logStructured } = {}) {
  if (!api || typeof api.get !== 'function' || typeof api.post !== 'function') {
    throw new Error('Cliente HTTP da Woovi indisponível para Pix Out');
  }

  async function lookupPixOut(correlationID) {
    try {
      const response = await api.get(`/payment/${encodeURIComponent(correlationID)}`);
      const payment = response?.data?.payment || null;
      if (!payment) return { outcome: 'not_found' };
      const kind = classifyStatus(payment.status);
      return {
        outcome: kind === 'created' ? 'created' : kind,
        status: String(payment.status || ''),
        endToEndId: response?.data?.transaction?.endToEndId || null,
        value: Number(payment.value || 0)
      };
    } catch (error) {
      if (Number(error?.response?.status) === 404) return { outcome: 'not_found' };
      return { outcome: 'unknown', error: errorText(error) };
    }
  }

  async function approve(correlationID) {
    try {
      const response = await api.post('/payment/approve', { correlationID });
      const payment = response?.data?.payment || {};
      const kind = classifyStatus(payment.status || 'APPROVED');
      return {
        outcome: kind === 'created' ? 'unknown' : kind,
        status: String(payment.status || 'APPROVED'),
        endToEndId: response?.data?.transaction?.endToEndId || null
      };
    } catch (error) {
      // Depois de um erro na aprovação o estado é incerto: confere antes de qualquer coisa.
      const after = await lookupPixOut(correlationID);
      if (after.outcome !== 'created') return after;
      return { outcome: isClientError(error) ? 'failed' : 'unknown', error: errorText(error) };
    }
  }

  /**
   * Envia (ou retoma) o Pix Out de um saque. Nunca cria um segundo pagamento para o
   * mesmo correlationID.
   */
  async function sendPixOut({ value, pixKey, correlationID, comment = '' }) {
    const amount = Math.round(Number(value || 0));
    if (!correlationID || !(amount > 0)) return { outcome: 'failed', error: 'Dados do Pix Out inválidos' };
    const destination = normalizePixKey(pixKey);
    if (!destination) return { outcome: 'failed', error: 'Chave Pix do motorista inválida' };

    const existing = await lookupPixOut(correlationID);
    if (existing.outcome === 'unknown') return existing;
    if (existing.outcome === 'created') return approve(correlationID);
    if (existing.outcome !== 'not_found') {
      if (existing.value && existing.value !== amount) {
        return { outcome: 'unknown', error: `Pagamento existente com valor diferente (${existing.value})` };
      }
      return existing;
    }

    try {
      const response = await api.post('/payment', {
        type: 'PIX_KEY',
        value: amount,
        destinationAlias: destination.alias,
        destinationAliasType: destination.type,
        correlationID,
        comment: String(comment || '').slice(0, 140),
        autoApprove: true
      });
      const payment = response?.data?.payment || {};
      const kind = classifyStatus(payment.status);
      if (kind === 'created') return approve(correlationID);
      logger('info', 'Pix Out enviado', { service: 'woovi-pix-out', correlationID, status: payment.status || null });
      return {
        outcome: kind,
        status: String(payment.status || ''),
        endToEndId: response?.data?.transaction?.endToEndId || null
      };
    } catch (error) {
      // Erro na criação: só é seguro dizer "nada foi pago" depois de conferir.
      const after = await lookupPixOut(correlationID);
      if (after.outcome === 'created') return approve(correlationID);
      if (after.outcome !== 'not_found') return after;
      return { outcome: isClientError(error) ? 'failed' : 'unknown', error: errorText(error) };
    }
  }

  return { sendPixOut, lookupPixOut };
}

module.exports = {
  createPixOutClient,
  normalizePixKey,
  classifyStatus,
  isValidCpf
};
