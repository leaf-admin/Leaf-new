// "Fare above normal" signal shown to the passenger on the quote and to the
// driver on the offer card. The server sends `fare_signal` (quote) and
// `fareSignal` (offer); this also derives it from the older fields so the
// warning works before the server change is live. It warns from 10% above
// normal, on a colour scale.

export const FARE_SIGNAL_THRESHOLD_PERCENT = 10;

const TONES = {
  moderate: { background: '#FEF3C7', border: 'rgba(180,120,10,0.28)', text: '#8A5A17' },
  high: { background: '#FFEDD5', border: 'rgba(194,90,24,0.30)', text: '#9A3412' },
  very_high: { background: '#FEE2E2', border: 'rgba(185,28,28,0.28)', text: '#991B1B' },
};

const REASON_LABELS = {
  demand: 'alta demanda na região',
  traffic: 'trânsito intenso',
  night: 'tarifa noturna',
};

function resolveLevel(percent) {
  if (percent >= 30) return 'very_high';
  if (percent >= 20) return 'high';
  if (percent >= FARE_SIGNAL_THRESHOLD_PERCENT) return 'moderate';
  return 'normal';
}

function joinReasons(labels) {
  if (labels.length <= 1) return labels[0] || '';
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
}

function toPositive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

/**
 * @param {object|null} source the quote's pricingPayload, or an offer's fareSignal
 * @returns {{aboveNormal: boolean, percent: number, level: string, label: string,
 *   reasonText: string, tone: object|null}}
 */
export function resolveFareSignal(source) {
  const raw = source && typeof source === 'object' ? source : {};
  const serverSignal = raw.fare_signal && typeof raw.fare_signal === 'object'
    ? raw.fare_signal
    : raw.percent !== undefined
      ? raw
      : null;

  let percent;
  let reasons;
  if (serverSignal) {
    percent = Math.round(toPositive(serverSignal.percent));
    reasons = Array.isArray(serverSignal.reasons) ? serverSignal.reasons.map(String) : [];
  } else {
    const dynamic = toPositive(raw.dynamic_percentage);
    const night = raw.night_surcharge_applied ? toPositive(raw.night_surcharge_percentage) : 0;
    percent = Math.round(dynamic + night);
    reasons = [];
    if (dynamic > 0) reasons.push('demand');
    if (raw.traffic_adjusted) reasons.push('traffic');
    if (night > 0) reasons.push('night');
  }

  const level = resolveLevel(percent);
  const aboveNormal = level !== 'normal';
  const reasonLabels = aboveNormal
    ? reasons.map((reason) => REASON_LABELS[reason]).filter(Boolean)
    : [];

  return {
    aboveNormal,
    percent,
    level,
    label: aboveNormal ? `Tarifa +${percent}%` : 'Tarifa normal',
    reasonText: reasonLabels.length ? joinReasons(reasonLabels) : '',
    tone: aboveNormal ? TONES[level] : null,
  };
}

export default resolveFareSignal;
