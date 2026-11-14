// Como o motorista vê um saque. O saque fica "em conferência" até a operação aprovar
// (regra de produto: aprovação após conferência manual); só então o Pix é enviado.

const DRIVER_WITHDRAWAL_STATUS = Object.freeze({
  IN_REVIEW: 'in_review',
  SENDING: 'sending',
  PAID: 'paid',
  FAILED: 'failed'
});

const STATUS_BY_INTERNAL = Object.freeze({
  pending: DRIVER_WITHDRAWAL_STATUS.IN_REVIEW,
  ledger_pending: DRIVER_WITHDRAWAL_STATUS.IN_REVIEW,
  processing: DRIVER_WITHDRAWAL_STATUS.SENDING,
  processed: DRIVER_WITHDRAWAL_STATUS.PAID,
  processed_ledger_pending: DRIVER_WITHDRAWAL_STATUS.PAID,
  completed: DRIVER_WITHDRAWAL_STATUS.PAID,
  failed: DRIVER_WITHDRAWAL_STATUS.FAILED,
  rejected: DRIVER_WITHDRAWAL_STATUS.FAILED,
  cancelled: DRIVER_WITHDRAWAL_STATUS.FAILED,
  canceled: DRIVER_WITHDRAWAL_STATUS.FAILED,
  refunded: DRIVER_WITHDRAWAL_STATUS.FAILED
});

const STATUS_LABEL = Object.freeze({
  [DRIVER_WITHDRAWAL_STATUS.IN_REVIEW]: 'Em conferência',
  [DRIVER_WITHDRAWAL_STATUS.SENDING]: 'Enviando Pix',
  [DRIVER_WITHDRAWAL_STATUS.PAID]: 'Pix enviado',
  [DRIVER_WITHDRAWAL_STATUS.FAILED]: 'Não concluído'
});

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch (error) {
      return null;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toCents(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

// A chave completa nunca volta para o app: basta o motorista reconhecer qual é.
function maskPixKey(pixKey) {
  const key = String(pixKey || '').trim();
  if (!key) return '';
  const at = key.indexOf('@');
  if (at > 0) {
    const name = key.slice(0, at);
    return `${name.slice(0, 2)}${'•'.repeat(Math.max(3, Math.min(6, name.length - 2)))}${key.slice(at)}`;
  }
  if (key.length <= 5) return '•'.repeat(key.length);
  return `${key.slice(0, 3)}${'•'.repeat(Math.max(3, Math.min(8, key.length - 5)))}${key.slice(-2)}`;
}

function toDriverWithdrawalView(id, data = {}) {
  const status = STATUS_BY_INTERNAL[String(data.status || '').toLowerCase()] || DRIVER_WITHDRAWAL_STATUS.IN_REVIEW;
  return {
    id: String(id || ''),
    amountCents: toCents(data.amountCents),
    feeCents: toCents(data.feeCents),
    totalDebitCents: toCents(data.totalDebitCents),
    status,
    statusLabel: STATUS_LABEL[status],
    pixKeyMasked: maskPixKey(data.pixKey),
    requestedAt: toIso(data.createdAt),
    updatedAt: toIso(data.processedAt || data.updatedAt)
  };
}

// Como a operação vê um saque na fila do painel: valores, tentativas e o último erro,
// com a chave Pix mascarada (a conferência é pelo motorista e pelo valor).
function toPendingWithdrawalAdminView(id, data = {}) {
  return {
    id: String(id || ''),
    driverId: String(data.driverId || ''),
    amountCents: toCents(data.amountCents),
    feeCents: toCents(data.feeCents),
    subscriptionSettlementCents: toCents(data.subscriptionSettlementCents),
    totalDebitCents: toCents(data.totalDebitCents),
    status: String(data.status || ''),
    ledgerStatus: String(data.ledgerStatus || ''),
    pixKeyMasked: maskPixKey(data.pixKey),
    attempts: toCents(data.attempts),
    lastError: data.lastError ? String(data.lastError).slice(0, 200) : null,
    createdAt: toIso(data.createdAt),
    lastAttemptAt: toIso(data.lastAttemptAt),
    processingStartedAt: toIso(data.processingStartedAt),
    pixOutUncertain: data.pixOutUncertain === true
  };
}

function sortDriverWithdrawals(views = []) {
  return [...views].sort((a, b) => {
    const aMs = a.requestedAt ? Date.parse(a.requestedAt) : 0;
    const bMs = b.requestedAt ? Date.parse(b.requestedAt) : 0;
    return bMs - aMs;
  });
}

module.exports = {
  DRIVER_WITHDRAWAL_STATUS,
  maskPixKey,
  sortDriverWithdrawals,
  toDriverWithdrawalView,
  toPendingWithdrawalAdminView
};
