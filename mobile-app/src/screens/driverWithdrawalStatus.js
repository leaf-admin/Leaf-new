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

function isSameLocalDay(iso, now) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

// Saques pedidos hoje que não falharam: cada um já pagou (ou vai pagar) a taxa.
export function countWithdrawalsToday(withdrawals = [], now = new Date()) {
  return (Array.isArray(withdrawals) ? withdrawals : []).filter(
    (item) => item?.status !== 'failed' && isSameLocalDay(item?.requestedAt, now),
  ).length;
}

/**
 * Aviso da taxa no momento do saque. A taxa é fixa por saque, então
 * um saque por dia sai mais barato; quem faz mais de um precisa ver isso antes.
 * `fee` é a taxa que vale para o valor digitado (0 quando o valor é isento).
 */
export function buildWithdrawalFeeNotice({ fee = 0, withdrawalsToday = 0 } = {}) {
  const feeLabel = formatBRL(Math.round(Number(fee) * 100));
  if (!(Number(fee) > 0)) {
    return {
      tone: 'neutral',
      title: 'Taxa de saque',
      body: 'Cada saque tem taxa fixa de R$ 1,00. Fazer um saque por dia evita pagar a taxa mais de uma vez.',
    };
  }
  if (withdrawalsToday > 0) {
    return {
      tone: 'warning',
      title: `Taxa de ${feeLabel} neste saque`,
      body:
        withdrawalsToday === 1
          ? `Você já fez 1 saque hoje. A taxa é de ${feeLabel} por saque, então este também paga a taxa.`
          : `Você já fez ${withdrawalsToday} saques hoje. A taxa é de ${feeLabel} por saque, então este também paga a taxa.`,
    };
  }
  return {
    tone: 'neutral',
    title: `Taxa de ${feeLabel} por saque`,
    body: 'Taxa fixa cobrada a cada saque. Fazer um saque por dia evita pagar a taxa mais de uma vez.',
  };
}
