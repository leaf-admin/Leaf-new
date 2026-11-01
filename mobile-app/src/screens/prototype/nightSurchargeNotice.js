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

const NIGHT_SURCHARGE_NOTICE_STORAGE_KEY = 'leaf.driver.night_surcharge_announced';
// Id fixo: agendar de novo substitui o anterior em vez de acumular outro aviso.
export const NIGHT_SURCHARGE_NOTIFICATION_ID = 'leaf-night-surcharge-next';

function isNightSurchargeNotificationType(type) {
  return String(type || '').startsWith('night_surcharge_');
}

export function isNightSurchargeNotification(content) {
  return isNightSurchargeNotificationType(content?.data?.type);
}

// Cada noite vai das 23h às 22h59 do dia seguinte, na data em que começou. "start" e
// "active" dividem a vaga: quem viu que começou não precisa do lembrete.
export function nightSurchargeNoticeSlot(kind, date = new Date()) {
  const nightStartMs =
    date.getTime() + (SAO_PAULO_OFFSET_HOURS - NIGHT_SURCHARGE_START_HOUR) * 3600 * 1000;
  const night = new Date(nightStartMs).toISOString().slice(0, 10);
  return `${night}:${kind === 'end' ? 'end' : 'start'}`;
}

const claimedSlots = new Set();

// Cada aviso sai uma vez por noite, mesmo ficando online de novo ou reabrindo o app.
// Sem armazenamento, a memória ainda segura as repetições desta abertura.
export async function claimNightSurchargeNotice(kind, storage, date = new Date()) {
  const slot = nightSurchargeNoticeSlot(kind, date);
  if (claimedSlots.has(slot)) return false;
  claimedSlots.add(slot);
  try {
    const saved = JSON.parse((await storage.getItem(NIGHT_SURCHARGE_NOTICE_STORAGE_KEY)) || '[]');
    if (saved.includes(slot)) return false;
    await storage.setItem(NIGHT_SURCHARGE_NOTICE_STORAGE_KEY, JSON.stringify([...saved, slot].slice(-2)));
  } catch (_error) {
    // segue só com a memória
  }
  return true;
}

export function buildNightSurchargeSchedule(next) {
  const notice = buildNightSurchargeNotice(next.kind);
  return {
    identifier: NIGHT_SURCHARGE_NOTIFICATION_ID,
    content: { title: notice.title, body: notice.message, data: { type: notice.type } },
    trigger: { type: 'date', date: next.at },
  };
}

// Versões anteriores agendavam com id aleatório e deixavam avisos para trás quando o app
// era fechado; todos disparavam juntos às 23h ou às 4h.
export async function cancelOrphanNightSurchargeNotifications(Notifications) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(
        (item) =>
          item?.identifier !== NIGHT_SURCHARGE_NOTIFICATION_ID &&
          isNightSurchargeNotification(item?.content),
      )
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}
