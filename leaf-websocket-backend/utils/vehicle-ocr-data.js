'use strict';

const COLOR_ALIASES = new Map([
  ['AMARELA', 'AMARELO'],
  ['AMARELO', 'AMARELO'],
  ['AZUL', 'AZUL'],
  ['BEGE', 'BEGE'],
  ['BRANCA', 'BRANCO'],
  ['BRANCO', 'BRANCO'],
  ['CINZA', 'CINZA'],
  ['DOURADA', 'DOURADO'],
  ['DOURADO', 'DOURADO'],
  ['GRENA', 'GRENÁ'],
  ['GRENÁ', 'GRENÁ'],
  ['LARANJA', 'LARANJA'],
  ['MARROM', 'MARROM'],
  ['PRATA', 'PRATA'],
  ['PRETA', 'PRETO'],
  ['PRETO', 'PRETO'],
  ['ROSA', 'ROSA'],
  ['ROXA', 'ROXO'],
  ['ROXO', 'ROXO'],
  ['VERDE', 'VERDE'],
  ['VERMELHA', 'VERMELHO'],
  ['VERMELHO', 'VERMELHO'],
  ['VINHO', 'VINHO']
]);

const SENSITIVE_OCR_FIELDS = new Set([
  'auditImage',
  'auditImageBase64',
  'auditImageUri',
  'image',
  'imageBase64',
  'pdfBase64',
  'rawPdf',
  'rawText',
  'textoCompleto'
]);

function removeDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

function cleanUpperText(value) {
  return cleanText(value).toUpperCase();
}

function normalizeColor(value) {
  const raw = cleanUpperText(value);
  if (!raw) return '';

  const comparable = removeDiacritics(raw).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!comparable) return '';

  if (COLOR_ALIASES.has(comparable)) {
    return COLOR_ALIASES.get(comparable);
  }

  for (const [alias, canonical] of COLOR_ALIASES.entries()) {
    const normalizedAlias = removeDiacritics(alias);
    if (comparable === normalizedAlias || comparable.includes(normalizedAlias)) {
      return canonical;
    }
  }

  return raw;
}

function normalizePlate(value) {
  return cleanUpperText(value).replace(/[^A-Z0-9]/g, '');
}

function normalizeYear(value) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : '';
}

function firstText(...values) {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function sanitizeVehicleOcrData(input = {}) {
  const output = {};

  Object.entries(input || {}).forEach(([key, value]) => {
    if (SENSITIVE_OCR_FIELDS.has(key)) return;
    if (value === undefined || value === null) return;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const cleaned = cleanText(value);
      if (cleaned) output[key] = cleaned;
    }
  });

  return output;
}

function normalizeVehicleOcrPayload(input = {}) {
  const plate = normalizePlate(
    firstText(input.plate, input.placa, input.vehiclePlate, input.carPlate, input.licensePlate)
  );
  const color = normalizeColor(
    firstText(input.color, input.cor, input.vehicleColor, input.carColor, input.vehicle_color)
  );
  const make = firstText(input.make, input.brand, input.marca, input.fabricante, input.vehicleMake);
  const model = firstText(input.model, input.modelo, input.vehicleModel);
  const year = normalizeYear(firstText(input.year, input.ano, input.anoModelo, input.anoFabricacao));
  const renavam = cleanUpperText(firstText(input.renavam, input.RENAVAM)).replace(/\D/g, '');
  const chassis = cleanUpperText(firstText(input.chassis, input.chassi, input.vin, input.VIN)).replace(/[^A-Z0-9]/g, '');

  return {
    ...sanitizeVehicleOcrData(input),
    ...(plate ? { plate, plateNormalized: plate } : {}),
    ...(color ? { color, vehicleColor: color, carColor: color, cor: color } : {}),
    ...(make ? { make, brand: make } : {}),
    ...(model ? { model } : {}),
    ...(year ? { year } : {}),
    ...(renavam ? { renavam } : {}),
    ...(chassis ? { chassis, chassi: chassis, vin: chassis } : {})
  };
}

function buildVehicleOcrUpdates({
  vehicleId,
  userId,
  userVehicleId,
  payload,
  metadata = {},
  nowIso = new Date().toISOString()
} = {}) {
  if (!vehicleId || !userId || !userVehicleId) {
    throw new Error('vehicleId, userId e userVehicleId são obrigatórios');
  }

  const normalized = normalizeVehicleOcrPayload(payload);
  const audit = {
    source: 'crlv_pdf_ocr',
    updatedAt: nowIso,
    metadata: sanitizeVehicleOcrData(metadata),
    data: normalized
  };

  const vehiclePatch = {
    updatedAt: nowIso,
    ocrData: audit
  };

  const userVehiclePatch = {
    updatedAt: nowIso,
    ocrData: audit
  };

  [
    'plate',
    'plateNormalized',
    'color',
    'vehicleColor',
    'carColor',
    'make',
    'brand',
    'model',
    'year',
    'renavam',
    'chassis',
    'chassi',
    'vin'
  ].forEach((field) => {
    if (normalized[field]) {
      vehiclePatch[field] = normalized[field];
      userVehiclePatch[field] = normalized[field];
    }
  });

  const updates = {};
  Object.entries(vehiclePatch).forEach(([field, value]) => {
    updates[`vehicles/${vehicleId}/${field}`] = value;
  });
  Object.entries(userVehiclePatch).forEach(([field, value]) => {
    updates[`user_vehicles/${userId}/${userVehicleId}/${field}`] = value;
  });

  return {
    normalized,
    updates
  };
}

module.exports = {
  buildVehicleOcrUpdates,
  normalizeColor,
  normalizePlate,
  normalizeVehicleOcrPayload,
  sanitizeVehicleOcrData
};
