const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(?:authorization|api[_-]?(?:key|token)|app[_-]?id[_-]?token|access[_-]?token|refresh[_-]?token|fcm[_-]?token|id[_-]?token|token$|password|private[_-]?key|client[_-]?secret|credential|cookie)/i;

// Log redaction runs on every field of every log line, so it was one of the
// largest CPU costs of the gateway under load. The output is unchanged; only
// work that cannot change it is skipped (see the equivalence test).
const sensitiveKeyCache = new Map();

function computeIsSensitiveKey(normalized) {
  if (/fingerprint$/i.test(normalized)) return false;
  return SENSITIVE_KEY_PATTERN.test(normalized);
}

function isSensitiveKey(key) {
  const normalized = String(key || '');
  let result = sensitiveKeyCache.get(normalized);
  if (result === undefined) {
    result = computeIsSensitiveKey(normalized);
    if (sensitiveKeyCache.size < 10000) sensitiveKeyCache.set(normalized, result);
  }
  return result;
}

// Every replacement below needs one of these words in the text; without them
// the text is returned as is.
const SENSITIVE_TEXT_HINT = /authorization|bearer|token|key|password|secret|credential|cookie/i;

function redactSensitiveText(value) {
  const text = String(value || '');
  if (!SENSITIVE_TEXT_HINT.test(text)) return text;
  return text
    .replace(/(Authorization\s*:\s*)(?:Bearer\s+)?[^\s,;]+/gi, `$1${REDACTED_VALUE}`)
    .replace(/(Bearer\s+)[^\s,;]+/gi, `$1${REDACTED_VALUE}`)
    .replace(
      /((?:api[_ -]?(?:key|token)|app[_ -]?id[_ -]?token|access[_ -]?token|refresh[_ -]?token|fcm[_ -]?token|id[_ -]?token|password|private[_ -]?key|client[_ -]?secret|credential|cookie)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      `$1${REDACTED_VALUE}`
    );
}

function redactSensitiveValue(value, key = '', seen = new WeakSet()) {
  if (isSensitiveKey(key)) return REDACTED_VALUE;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, '', seen));
  }

  // Copy only when a child changes; otherwise reuse a shallow copy-free result
  // that is structurally identical to the copy the previous version returned.
  let sanitized = null;
  const entries = Object.entries(value);
  for (let index = 0; index < entries.length; index += 1) {
    const [childKey, childValue] = entries[index];
    const nextValue = redactSensitiveValue(childValue, childKey, seen);
    if (sanitized) {
      sanitized[childKey] = nextValue;
    } else if (nextValue !== childValue) {
      sanitized = {};
      for (let previous = 0; previous < index; previous += 1) {
        sanitized[entries[previous][0]] = entries[previous][1];
      }
      sanitized[childKey] = nextValue;
    }
  }
  if (sanitized) return sanitized;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null
    ? value
    : Object.fromEntries(entries);
}

function redactLogInfoInPlace(info = {}) {
  for (const key of Object.keys(info)) {
    info[key] = redactSensitiveValue(info[key], key);
  }
  return info;
}

module.exports = {
  REDACTED_VALUE,
  isSensitiveKey,
  redactSensitiveText,
  redactSensitiveValue,
  redactLogInfoInPlace
};
