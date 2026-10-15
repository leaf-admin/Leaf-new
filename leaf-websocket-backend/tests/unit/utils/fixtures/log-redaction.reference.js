const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(?:authorization|api[_-]?(?:key|token)|app[_-]?id[_-]?token|access[_-]?token|refresh[_-]?token|fcm[_-]?token|id[_-]?token|token$|password|private[_-]?key|client[_-]?secret|credential|cookie)/i;

function isSensitiveKey(key) {
  const normalized = String(key || '');
  if (/fingerprint$/i.test(normalized)) return false;
  return SENSITIVE_KEY_PATTERN.test(normalized);
}

function redactSensitiveText(value) {
  return String(value || '')
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

  const sanitized = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    sanitized[childKey] = redactSensitiveValue(childValue, childKey, seen);
  }
  return sanitized;
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
