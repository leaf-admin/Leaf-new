export const CURRENT_SURFACE_STATUS = Object.freeze({
  CURRENT: 'current',
  DISABLED: 'disabled',
  OUT_OF_PILOT: 'out_of_pilot',
});

const CURRENT_SURFACE_STATUS_COPY = Object.freeze({
  [CURRENT_SURFACE_STATUS.DISABLED]: 'Em breve',
  [CURRENT_SURFACE_STATUS.OUT_OF_PILOT]: 'Fora do piloto',
});

export function normalizeCurrentSurfaceStatus(status) {
  return Object.values(CURRENT_SURFACE_STATUS).includes(status)
    ? status
    : CURRENT_SURFACE_STATUS.CURRENT;
}

export function isCurrentSurfaceUnavailable(status) {
  return normalizeCurrentSurfaceStatus(status) !== CURRENT_SURFACE_STATUS.CURRENT;
}

export function getCurrentSurfaceStatusCopy(status) {
  return CURRENT_SURFACE_STATUS_COPY[normalizeCurrentSurfaceStatus(status)] || '';
}
