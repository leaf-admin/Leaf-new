// Aviso do adicional noturno para o motorista. A regra é do servidor
// (leaf-websocket-backend/services/pricing/nightSurcharge.js): +15% das 23h às 4h no
// horário de Brasília. Um teste confere que estes números batem com os de lá.

export const NIGHT_SURCHARGE_RATE = 0.15;
export const NIGHT_SURCHARGE_START_HOUR = 23;
export const NIGHT_SURCHARGE_END_HOUR = 4;
// Brasília sem horário de verão desde 2019: UTC-3 fixo.
const SAO_PAULO_OFFSET_HOURS = -3;

function saoPauloHour(date) {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return (utcHours + SAO_PAULO_OFFSET_HOURS + 24) % 24;
}

export function isNightSurchargeActive(date = new Date()) {
  const hour = saoPauloHour(date);
  return hour >= NIGHT_SURCHARGE_START_HOUR || hour < NIGHT_SURCHARGE_END_HOUR;
}

// Próximo momento em que o adicional começa ou termina.
export function nextNightSurchargeTransition(date = new Date()) {
  const active = isNightSurchargeActive(date);
  const targetHour = active ? NIGHT_SURCHARGE_END_HOUR : NIGHT_SURCHARGE_START_HOUR;
  const hour = saoPauloHour(date);
  let hoursAhead = targetHour - hour;
  if (hoursAhead <= 0) hoursAhead += 24;
  // Arredonda ao minuto: a hora fracionária deixava o horário um minuto antes.
  const at = new Date(Math.round((date.getTime() + hoursAhead * 3600 * 1000) / 60000) * 60000);
  return { kind: active ? 'end' : 'start', at };
}

const percentLabel = `${Math.round(NIGHT_SURCHARGE_RATE * 100)}%`;

export function buildNightSurchargeNotice(kind) {
  if (kind === 'start') {
    return {
      type: 'night_surcharge_started',
      title: 'Adicional noturno começou',
      message: `Corridas até as ${NIGHT_SURCHARGE_END_HOUR}h valem +${percentLabel}.`,
    };
  }
  if (kind === 'active') {
    return {
      type: 'night_surcharge_started',
      title: 'Adicional noturno ativo',
      message: `Corridas até as ${NIGHT_SURCHARGE_END_HOUR}h valem +${percentLabel}.`,
    };
  }
  return {
    type: 'night_surcharge_ended',
    title: 'Adicional noturno terminou',
    message: `Volta às ${NIGHT_SURCHARGE_START_HOUR}h.`,
  };
}
