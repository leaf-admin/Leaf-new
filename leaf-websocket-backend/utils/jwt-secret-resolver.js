const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { logger } = require('./logger');

const ephemeralSecretCache = new Map();

function normalizeSecret(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEnvNames(envNames) {
  if (Array.isArray(envNames)) {
    return envNames.map((name) => String(name)).filter(Boolean);
  }

  if (!envNames) {
    return [];
  }

  return [String(envNames)];
}

function getEphemeralSecret(envNames, context) {
  const cacheKey = envNames.join('|');
  if (ephemeralSecretCache.has(cacheKey)) {
    return ephemeralSecretCache.get(cacheKey);
  }

  const fileHash = crypto
    .createHash('sha256')
    .update(`${process.cwd()}|${cacheKey}`)
    .digest('hex')
    .slice(0, 24);
  const fallbackSecretPath = path.join(os.tmpdir(), `leaf-jwt-fallback-${fileHash}.secret`);

  try {
    const fromDisk = normalizeSecret(fs.readFileSync(fallbackSecretPath, 'utf8'));
    if (fromDisk) {
      ephemeralSecretCache.set(cacheKey, fromDisk);
      return fromDisk;
    }
  } catch {}

  const generated = crypto.randomBytes(64).toString('hex');

  try {
    fs.writeFileSync(fallbackSecretPath, generated, { mode: 0o600, flag: 'wx' });
    ephemeralSecretCache.set(cacheKey, generated);
    logger.error(
      `[SECURITY] ${context}: segredo JWT ausente (${envNames.join(', ')}). ` +
      `Gerado fallback local seguro em ${fallbackSecretPath}; configure as variaveis de ambiente imediatamente.`
    );
    return generated;
  } catch {
    try {
      const existing = normalizeSecret(fs.readFileSync(fallbackSecretPath, 'utf8'));
      if (existing) {
        ephemeralSecretCache.set(cacheKey, existing);
        return existing;
      }
    } catch {}
  }

  ephemeralSecretCache.set(cacheKey, generated);
  logger.error(
    `[SECURITY] ${context}: segredo JWT ausente (${envNames.join(', ')}). ` +
    'Usando fallback efemero em memoria; configure as variaveis de ambiente imediatamente.'
  );
  return generated;
}

function resolveJwtSecret(envNames, options = {}) {
  const normalizedEnvNames = normalizeEnvNames(envNames);
  const context = options.context || 'jwt';
  const allowEphemeral = options.allowEphemeral !== false;

  for (const envName of normalizedEnvNames) {
    const value = normalizeSecret(process.env[envName]);
    if (value) {
      return value;
    }
  }

  if (!allowEphemeral) {
    logger.error(
      `[SECURITY] ${context}: segredo JWT ausente (${normalizedEnvNames.join(', ')}).`
    );
    return null;
  }

  return getEphemeralSecret(normalizedEnvNames, context);
}

function resolveJwtSecretList(envNames, options = {}) {
  const normalizedEnvNames = normalizeEnvNames(envNames);
  const secrets = [];

  for (const envName of normalizedEnvNames) {
    const value = normalizeSecret(process.env[envName]);
    if (value && !secrets.includes(value)) {
      secrets.push(value);
    }
  }

  if (secrets.length > 0) {
    return secrets;
  }

  const fallbackSecret = resolveJwtSecret(normalizedEnvNames, options);
  return fallbackSecret ? [fallbackSecret] : [];
}

module.exports = {
  resolveJwtSecret,
  resolveJwtSecretList
};
