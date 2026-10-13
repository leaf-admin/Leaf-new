// Áreas que o motorista evita: regras de tela (os limites reais vêm do servidor).

export const AVOIDED_AREA_SIZES = [
  { ringSize: 0, label: 'Pequena', detail: 'quarteirões', previewRadiusMeters: 500, mapZoom: 14.4 },
  { ringSize: 1, label: 'Média', detail: 'um bairro', previewRadiusMeters: 1300, mapZoom: 13.1 },
  { ringSize: 2, label: 'Grande', detail: 'vários bairros', previewRadiusMeters: 2200, mapZoom: 12.3 },
];

export const DEFAULT_AVOIDED_AREA_LIMITS = { maxCells: 60, maxAreas: 12 };

// Um disco hexagonal de raio r tem 1 + 3r(r + 1) células.
export function cellsForRingSize(ringSize) {
  const ring = Math.min(2, Math.max(0, Math.trunc(Number(ringSize) || 0)));
  return 1 + 3 * ring * (ring + 1);
}

export function resolveAvoidedAreaSize(ringSize) {
  return AVOIDED_AREA_SIZES.find((size) => size.ringSize === Number(ringSize)) || AVOIDED_AREA_SIZES[0];
}

export function countAvoidedCells(areas = []) {
  const cells = new Set();
  let estimated = 0;
  (Array.isArray(areas) ? areas : []).forEach((area) => {
    if (Array.isArray(area?.cells) && area.cells.length) {
      area.cells.forEach((cell) => cells.add(cell));
    } else {
      estimated += cellsForRingSize(area?.ringSize);
    }
  });
  return cells.size + estimated;
}

// Estimativa conservadora: áreas vizinhas dividem células, então o servidor pode aceitar
// um pouco além disto. Ele continua sendo quem decide.
export function canAddAvoidedArea(areas = [], ringSize = 0, limits = DEFAULT_AVOIDED_AREA_LIMITS) {
  const list = Array.isArray(areas) ? areas : [];
  const maxAreas = Number(limits?.maxAreas) || DEFAULT_AVOIDED_AREA_LIMITS.maxAreas;
  const maxCells = Number(limits?.maxCells) || DEFAULT_AVOIDED_AREA_LIMITS.maxCells;
  if (list.length >= maxAreas) {
    return { ok: false, reason: 'MAX_AREAS' };
  }
  if (countAvoidedCells(list) + cellsForRingSize(ringSize) > maxCells) {
    return { ok: false, reason: 'MAX_CELLS' };
  }
  return { ok: true, reason: '' };
}

export function buildAvoidedAreaLabel(reverseGeocodeResult, fallbackIndex = 1) {
  const first = Array.isArray(reverseGeocodeResult) ? reverseGeocodeResult[0] : reverseGeocodeResult;
  const label = [first?.district, first?.subregion, first?.street, first?.city]
    .map((value) => String(value || '').trim())
    .find(Boolean);
  return (label || `Área ${fallbackIndex}`).slice(0, 60);
}

export function describeAvoidedAreaLimit(reason) {
  if (reason === 'MAX_AREAS') {
    return 'Você chegou ao limite de áreas. Remova uma para marcar outra.';
  }
  if (reason === 'MAX_CELLS' || reason === 'AVOIDED_AREAS_LIMIT_EXCEEDED') {
    return 'Suas áreas já cobrem o máximo permitido. Remova uma ou escolha um tamanho menor.';
  }
  return 'Não foi possível salvar agora. Tente novamente.';
}

export function buildAvoidedAreasSummary(areas = []) {
  const total = Array.isArray(areas) ? areas.length : 0;
  if (total === 0) return 'Nenhuma área marcada';
  return total === 1 ? '1 área marcada' : `${total} áreas marcadas`;
}
