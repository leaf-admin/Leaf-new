const COVERAGE_CODES = new Set([
  'PICKUP_OUTSIDE_REGION',
  'DESTINATION_OUTSIDE_REGION',
  'DESTINATION_OUTSIDE_SERVICE_AREA',
  'ROUTE_OUT_OF_COVERAGE',
  'GEOFENCE_OUTSIDE_REGION',
  'GEOFENCE_OUT_OF_COVERAGE',
]);

const normalizeText = value => String(value || '').trim();

const collectErrorLayers = error => {
  const layers = [];
  let current = error;

  while (current && layers.length < 4 && !layers.includes(current)) {
    layers.push(current);
    current = current?.originalError;
  }

  return layers;
};

const resolveCoverageKind = (code, message) => {
  if (code === 'PICKUP_OUTSIDE_REGION' || /origem.*fora/i.test(message)) {
    return 'pickup';
  }

  if (
    code === 'DESTINATION_OUTSIDE_REGION' ||
    code === 'DESTINATION_OUTSIDE_SERVICE_AREA' ||
    /destino.*fora/i.test(message)
  ) {
    return 'destination';
  }

  if (
    COVERAGE_CODES.has(code) ||
    /geofence|fora da (?:area|área|regiao|região)|out of coverage/i.test(message)
  ) {
    return 'route';
  }

  return '';
};

export function resolveHomeQuoteFailurePresentation(error) {
  const layers = collectErrorLayers(error);
  const payloads = layers
    .map(layer => layer?.response?.data)
    .filter(payload => payload && typeof payload === 'object');
  const code = normalizeText(
    payloads.find(payload => payload?.code)?.code ||
      payloads.find(payload => payload?.error)?.error ||
      layers.find(layer => layer?.code)?.code,
  ).toUpperCase();
  const rawMessage = normalizeText(
    payloads.find(payload => payload?.message)?.message ||
      layers.find(layer => layer?.rawMessage)?.rawMessage ||
      layers.find(layer => layer?.message)?.message ||
      layers.find(layer => typeof layer === 'string'),
  );
  const coverageKind = resolveCoverageKind(code, rawMessage);

  if (coverageKind === 'pickup') {
    return {
      kind: 'coverage',
      message: 'Sua origem está fora da área da Leaf.',
      actionLabel: 'Origem fora da área',
    };
  }

  if (coverageKind === 'destination') {
    return {
      kind: 'coverage',
      message: 'Seu destino está fora da área da Leaf.',
      actionLabel: 'Destino fora da área',
    };
  }

  if (coverageKind === 'route') {
    return {
      kind: 'coverage',
      message: 'Essa rota está fora da área da Leaf.',
      actionLabel: 'Rota fora da área',
    };
  }

  return {
    kind: 'unavailable',
    message: rawMessage || 'Não foi possível calcular a tarifa agora.',
    actionLabel: 'Tarifa indisponível',
  };
}

export default resolveHomeQuoteFailurePresentation;
