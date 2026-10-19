// Nada que identifique a pessoa sai do aparelho para o Sentry ou o PostHog:
// só o uid do Firebase (pseudônimo) e o papel. Textos passam por esta máscara
// e propriedades de evento só aceitam valores simples e chaves fora da lista.

const PII_PATTERNS = [
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\+55\s?\d{2}\s?9?\d{4}-?\d{4}\b/g, '[PHONE]'],
  [/\(\d{2}\)\s?9?\d{4}-?\d{4}\b/g, '[PHONE]'],
  [/\b(Bearer|token=|idToken=|access_token=)\s*[A-Za-z0-9._-]{12,}/gi, '$1[TOKEN]'],
];

const BLOCKED_PROPERTY_KEYS = /(phone|telefone|cpf|email|e-mail|name|nome|address|endereco|endereço|lat|lng|lon|location|token|password|senha|pix|document|plate|placa)/i;
const MAX_STRING_LENGTH = 200;

export function maskPii(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return PII_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => maskPii(item, seen));
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskPii(item, seen)]));
}

export function scrubSentryEvent(event) {
  if (!event) return event;
  const scrubbed = maskPii(event);
  if (scrubbed.user) {
    scrubbed.user = scrubbed.user.id ? { id: scrubbed.user.id } : undefined;
  }
  if (scrubbed.request) {
    delete scrubbed.request.cookies;
    delete scrubbed.request.headers;
    delete scrubbed.request.data;
  }
  return scrubbed;
}

export function sanitizeProperties(properties = {}) {
  return Object.fromEntries(
    Object.entries(properties || {})
      .filter(([key, value]) => (
        !BLOCKED_PROPERTY_KEYS.test(key)
        && (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      ))
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? maskPii(value).slice(0, MAX_STRING_LENGTH) : value,
      ])
  );
}

// Três toques no mesmo ponto em menos de um segundo: a pessoa está brigando
// com a tela. Vira o mesmo evento "$rageclick" que o PostHog usa na web.
export function createRageTapDetector({ taps = 3, windowMs = 1000, radius = 40 } = {}) {
  let recent = [];
  return function registerTap(x, y, at = Date.now()) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    recent = recent.filter((tap) => (
      at - tap.at <= windowMs && Math.hypot(tap.x - x, tap.y - y) <= radius
    ));
    recent.push({ x, y, at });
    if (recent.length >= taps) {
      recent = [];
      return true;
    }
    return false;
  };
}
