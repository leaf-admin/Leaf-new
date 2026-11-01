// Comemoração do motorista ao fim de uma corrida da promoção. Só existe com o
// snapshot final do backend: qualquer dado incompleto vai direto para o recibo.
const toCents = (value) => {
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
};

function resolveFinalSnapshot(result) {
  return (
    result?.financialSnapshot ||
    result?.fareBreakdown?.financialSnapshot ||
    result?.receipt?.financialSnapshot ||
    result?.receipt?.fareBreakdown?.financialSnapshot ||
    null
  );
}

export function resolveDriverPromoCelebration(result) {
  // Corrida encerrada antes do destino ou em revisão financeira não é comemorada.
  if (
    !result ||
    result.earlyEnd ||
    result.settlement ||
    result.completionType ||
    result.settlementReviewRequired ||
    result.localFallback
  ) {
    return null;
  }

  const snapshot = resolveFinalSnapshot(result);
  if (
    snapshot?.authoritativeSnapshot !== true ||
    snapshot?.financialSnapshotSource !== 'backend_final' ||
    snapshot?.balanced !== true ||
    snapshot?.driverIntroFee?.eligible !== true
  ) {
    return null;
  }

  const paidCents = toCents(snapshot.passengerPaidCents);
  const tollCents = toCents(snapshot.tollFeeCents);
  const netCents = toCents(snapshot.driverNetAmountCents);
  const operationalCents = toCents(snapshot.operationalFeeCents);
  const paymentCents = toCents(snapshot.paymentIntermediationFeeCents);
  if (
    paidCents === null ||
    tollCents === null ||
    netCents === null ||
    operationalCents === null ||
    paymentCents === null
  ) {
    return null;
  }

  // O card mostra uma conta só: pago - taxa = recebido. Outro desconto (como a
  // assinatura) não caberia nela, e o recibo já detalha esse caso.
  const feeCents = operationalCents + paymentCents;
  if (paidCents === 0 || feeCents === 0 || paidCents - feeCents !== netCents) {
    return null;
  }

  return {
    bookingId: result.bookingId || null,
    paidCents,
    tollCents,
    feeCents,
    netCents,
  };
}

const BASE_TIMELINE = Object.freeze({
  labels: ['O passageiro pagou', 'Você recebeu'],
  buttonAtMs: 3700,
  finishAtMs: 6400,
});

const TOLL_TIMELINE = Object.freeze({
  labels: ['Valor da corrida', 'O passageiro pagou', 'Você recebeu'],
  buttonAtMs: 4900,
  finishAtMs: 7600,
});

// Cada passo só diz o que muda naquele instante; o card acumula os passos.
export function buildDriverPromoTimeline({ paidCents, tollCents, feeCents, netCents }) {
  if (tollCents > 0) {
    return {
      ...TOLL_TIMELINE,
      steps: [
        { atMs: 400, valueCents: paidCents - tollCents, labelIndex: 0 },
        { atMs: 1500, showToll: true },
        { atMs: 2100, valueCents: paidCents, labelIndex: 1 },
        { atMs: 3100, showFee: true },
        { atMs: 3700, valueCents: netCents, labelIndex: 2, turned: true },
      ],
    };
  }

  return {
    ...BASE_TIMELINE,
    steps: [
      { atMs: 400, valueCents: paidCents, labelIndex: 0 },
      { atMs: 1800, showFee: true },
      { atMs: 2500, valueCents: netCents, labelIndex: 1, turned: true },
    ],
  };
}

// "33,92" em colunas. A largura é fixa para o número não saltar entre valores,
// e o zero à esquerda fica oculto (R$ 10,00 -> R$ 9,01).
export function buildOdometerColumns(valueCents, widestCents) {
  const format = (cents) => (cents / 100).toFixed(2).replace('.', ',');
  const widest = format(widestCents);
  const text = format(valueCents).padStart(widest.length, ' ');
  return text.split('').map((char, index) => ({
    key: `${widest.length - index}`,
    isComma: char === ',',
    digit: char === ' ' || char === ',' ? 0 : Number(char),
    hidden: char === ' ',
  }));
}
