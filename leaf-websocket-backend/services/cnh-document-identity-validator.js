const CNH_DOCUMENT_TYPES = new Set(['cnh', 'carteira_nacional_de_habilitacao', 'driver_license']);
const NON_CNH_DOCUMENT_TYPES = new Set(['rg', 'identidade', 'carteira_de_identidade', 'cpf', 'crlv', 'passport', 'passaporte']);

const STRONG_TEXT_MARKERS = Object.freeze([
  'carteira nacional de habilitacao',
  'permissao para dirigir',
  'documento nacional de habilitacao'
]);

const MEDIUM_TEXT_MARKERS = Object.freeze([
  'renach',
  'numero do registro',
  'n registro',
  'registro',
  'categoria',
  'validade',
  'primeira habilitacao',
  '1 habilitacao',
  'acc',
  'ear',
  'observacoes'
]);

const NON_CNH_TEXT_MARKERS = Object.freeze([
  'registro geral',
  'carteira de identidade',
  'identidade civil',
  'instituto de identificacao',
  'secretaria de seguranca publica'
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDocumentType(value) {
  return normalizeText(value).replace(/\s+/g, '_');
}

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function normalizeCategory(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
}

function isValidCnhCategory(value) {
  const category = normalizeCategory(value);
  return Boolean(category) && (
    /^[ABCE]{1,4}D?$/.test(category) ||
    ['ACC', 'AB', 'AC', 'AD', 'AE'].includes(category)
  );
}

function countMarkers(normalizedText, markers) {
  if (!normalizedText) return [];
  return markers.filter(marker => normalizedText.includes(marker));
}

function scoreStructuredData(data = {}) {
  const documentType = normalizeDocumentType(data.documentType || data.tipoDocumento || data.tipo_documento);
  const confidence = Number(data.documentTypeConfidence || data.tipoDocumentoConfidence || data.document_type_confidence || 0);
  const hasCnhNumber = hasValue(data.numeroRegistro) || hasValue(data.cnh);
  const hasCategory = isValidCnhCategory(data.categoria);
  const hasValidity = hasValue(data.validade);
  const hasFirstLicense = hasValue(data.dataPrimeiraHabilitacao);
  const hasEarSignal = data.ear === true || data.ear === false || String(data.ear || '').trim().length > 0;

  let score = 0;
  if (CNH_DOCUMENT_TYPES.has(documentType)) score += 2;
  if (hasCnhNumber) score += 2;
  if (hasCategory) score += 2;
  if (hasValidity) score += 1;
  if (hasFirstLicense) score += 1;
  if (hasEarSignal) score += 1;

  return {
    score,
    documentType: documentType || null,
    documentTypeConfidence: Number.isFinite(confidence) ? confidence : 0,
    hasCnhNumber,
    hasCategory,
    hasValidity,
    hasFirstLicense,
    hasEarSignal
  };
}

function validateCnhDocumentIdentity({ text = '', data = {} } = {}) {
  const normalizedText = normalizeText(text);
  const strongTextMarkers = countMarkers(normalizedText, STRONG_TEXT_MARKERS);
  const mediumTextMarkers = countMarkers(normalizedText, MEDIUM_TEXT_MARKERS);
  const nonCnhTextMarkers = countMarkers(normalizedText, NON_CNH_TEXT_MARKERS);
  const textScore = strongTextMarkers.length * 3 + Math.min(mediumTextMarkers.length, 5);
  const structured = scoreStructuredData(data);
  const declaredNonCnh =
    NON_CNH_DOCUMENT_TYPES.has(structured.documentType) &&
    structured.documentTypeConfidence >= 0.75;

  const hasMinimumCnhStructure =
    structured.hasCategory &&
    (structured.hasCnhNumber || structured.hasValidity || structured.hasFirstLicense);

  const valid =
    !declaredNonCnh &&
    hasMinimumCnhStructure &&
    (
      structured.score >= 5 ||
      CNH_DOCUMENT_TYPES.has(structured.documentType) ||
      textScore >= 3
    );

  const probablyOtherIdentityDocument =
    !valid &&
    (
      declaredNonCnh ||
      nonCnhTextMarkers.length >= 2 && strongTextMarkers.length === 0
    );

  return {
    valid,
    reason: valid
      ? null
      : probablyOtherIdentityDocument
        ? 'Documento enviado parece ser outro documento de identidade, nao uma CNH.'
        : 'Documento enviado nao possui sinais minimos de CNH.',
    score: structured.score + textScore,
    structuredScore: structured.score,
    textScore,
    signals: {
      ...structured,
      strongTextMarkers,
      mediumTextMarkers,
      nonCnhTextMarkers,
      probablyOtherIdentityDocument
    }
  };
}

module.exports = {
  validateCnhDocumentIdentity,
  normalizeText,
  scoreStructuredData
};
