// Sinais curtos no cartão "motorista a caminho" (aprovados no motion lab). Só aparecem
// quando são boa notícia de verdade; nunca são inventados.

export const FAST_MATCH_MAX_SECONDS = 30;
export const QUICK_PICKUP_MAX_MINUTES = 2;

function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

// Segundos entre o início da busca e o aceite (o momento em que o cartão abre).
export function resolveSearchFoundSeconds(searchStartedAt, acceptedAtMs = Date.now()) {
  const start = toTimestamp(searchStartedAt);
  if (start === null || !Number.isFinite(acceptedAtMs)) return null;
  const seconds = Math.round((acceptedAtMs - start) / 1000);
  return seconds >= 0 && seconds < 3600 ? seconds : null;
}

export function resolveDriverFoundChips({ foundSeconds = null, pickupEtaMinutes = null } = {}) {
  const chips = [];
  if (Number.isFinite(foundSeconds) && foundSeconds >= 0 && foundSeconds < FAST_MATCH_MAX_SECONDS) {
    chips.push({ key: 'fast_match', icon: 'flash', label: `Encontrado em ${Math.max(1, foundSeconds)} s` });
  }
  if (Number.isFinite(Number(pickupEtaMinutes)) && Number(pickupEtaMinutes) > 0 && Number(pickupEtaMinutes) < QUICK_PICKUP_MAX_MINUTES) {
    chips.push({ key: 'quick_pickup', icon: 'walk', label: 'Embarque rápido' });
  }
  return chips;
}
