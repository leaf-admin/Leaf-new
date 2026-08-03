#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ALLOWED_EXACT_KEYS = new Set([
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GCLOUD_PROJECT',
  'NODE_ENV'
]);
const ALLOWED_PREFIXES = Object.freeze([
  'BACKUP_',
  'FIREBASE_',
  'FIRESTORE_BACKUP_',
  'REDIS_'
]);

function isAllowedKey(key) {
  return ALLOWED_EXACT_KEYS.has(key) || ALLOWED_PREFIXES.some(prefix => key.startsWith(prefix));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function buildExportScript(contents, existingEnvironment = process.env) {
  const parsed = dotenv.parse(contents);
  return Object.entries(parsed)
    .filter(([key]) => isAllowedKey(key) && existingEnvironment[key] === undefined)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n');
}

function main() {
  const envPath = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !fs.existsSync(envPath)) {
    throw new Error(`Arquivo .env não encontrado: ${envPath}`);
  }
  process.stdout.write(`${buildExportScript(fs.readFileSync(envPath, 'utf8'))}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_EXACT_KEYS,
  ALLOWED_PREFIXES,
  buildExportScript,
  isAllowedKey,
  shellQuote
};
