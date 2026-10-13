const fs = require('fs');
const path = require('path');

let loaded = false;

const DEFAULT_ENV_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local'
];

function stripQuotes(value) {
  if (!value) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed = {};
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const idx = normalized.indexOf('=');
    if (idx <= 0) {
      continue;
    }

    const key = normalized.slice(0, idx).trim();
    const value = stripQuotes(normalized.slice(idx + 1).trim());

    if (key) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function loadConfigEnv(projectRoot = path.resolve(__dirname, '..')) {
  if (loaded) {
    return;
  }

  const explicitEnvFile = String(process.env.LEAF_ENV_FILE || '').trim();
  const buildProfile = String(process.env.EAS_BUILD_PROFILE || process.env.LEAF_BUILD_PROFILE || '').trim();
  const easPath = path.join(projectRoot, 'eas.json');
  if (!explicitEnvFile && buildProfile && fs.existsSync(easPath)) {
    const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
    const profile = eas.build?.[buildProfile];
    if (!profile) throw new Error('Selected EAS build profile does not exist.');
    for (const [key, value] of Object.entries(profile.env || {})) {
      if (!process.env[key]) process.env[key] = String(value);
    }
  }
  const fileNames = explicitEnvFile ? [explicitEnvFile] : DEFAULT_ENV_FILES;

  for (const fileName of fileNames) {
    const filePath = path.isAbsolute(fileName)
      ? fileName
      : path.resolve(projectRoot, fileName);
    if (explicitEnvFile && !fs.existsSync(filePath)) {
      throw new Error('LEAF_ENV_FILE points to a missing file.');
    }
    const envValues = parseEnvFile(filePath);

    for (const [key, value] of Object.entries(envValues)) {
      if (explicitEnvFile || !process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  if (!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY && process.env.GOOGLE_MAPS_API_KEY) {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  }
  if (!process.env.GOOGLE_MAPS_API_KEY && process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) {
    process.env.GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  }

  loaded = true;
}

module.exports = {
  loadConfigEnv
};
