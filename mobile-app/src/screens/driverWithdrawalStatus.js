// Como um saque aparece para o motorista. Os estados vêm do servidor
// (services/driver-withdrawal-view.js): o saque fica em conferência até a operação
// aprovar e só então o Pix é enviado.

const TONE_BY_STATUS = {
  in_review: 'pending',
  sending: 'pending',
  paid: 'success',
  failed: 'danger',
};

const FALLBACK_LABEL = {
  in_review: 'Em conferência',
  sending: 'Enviando Pix',
  paid: 'Pix enviado',
  failed: 'Não concluído',
};

function formatBRL(cents) {
  const value = Number(cents) / 100;
  if (!Number.isFinite(value)) return 'R$ 0,00';
  return `R$ ${value.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function formatDay(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

export function describeDriverWithdrawal(withdrawal = {}) {
  const status = TONE_BY_STATUS[withdrawal.status] ? withdrawal.status : 'in_review';
  const details = [formatDay(withdrawal.requestedAt), withdrawal.pixKeyMasked ? `Pix ${withdrawal.pixKeyMasked}` : '']
    .filter(Boolean)
    .join(' · ');
  return {
    id: String(withdrawal.id || ''),
    amountLabel: formatBRL(withdrawal.amountCents),
    details,
    statusLabel: withdrawal.statusLabel || FALLBACK_LABEL[status],
    tone: TONE_BY_STATUS[status],
  };
}

export function describeDriverWithdrawals(withdrawals = [], limit = 5) {
  return (Array.isArray(withdrawals) ? withdrawals : [])
    .slice(0, limit)
    .map(describeDriverWithdrawal)
    .filter((item) => item.id);
}

// Texto do topo quando há saque ainda não pago.
export function summarizeOpenWithdrawals(withdrawals = []) {
  const open = (Array.isArray(withdrawals) ? withdrawals : []).filter(
    (item) => item?.status === 'in_review' || item?.status === 'sending',
  );
  if (open.length === 0) return '';
  const totalCents = open.reduce((sum, item) => sum + (Number(item.amountCents) || 0), 0);
  return open.length === 1
    ? `${formatBRL(totalCents)} em conferência. Você recebe um aviso quando o Pix for enviado.`
    : `${open.length} saques em conferência (${formatBRL(totalCents)}). Você recebe um aviso a cada Pix enviado.`;
}
