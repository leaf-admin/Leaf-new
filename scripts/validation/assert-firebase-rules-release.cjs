#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const firebaseDir = path.join(rootDir, 'config/firebase');

function fail(message) {
  console.error(`[firebase-rules-check] ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const firebaseConfig = JSON.parse(read('config/firebase/firebase.json'));
assert(firebaseConfig.firestore?.rules === 'firestore.rules', 'firebase.json deve apontar para firestore.rules.');
assert(firebaseConfig.database?.rules === 'database.rules.json', 'firebase.json deve apontar para database.rules.json.');
assert(firebaseConfig.storage?.rules === 'storage.rules', 'firebase.json deve apontar para storage.rules.');

const firestoreRules = read('config/firebase/firestore.rules');
const storageRules = read('config/firebase/storage.rules');
const databaseRules = JSON.parse(read('config/firebase/database.rules.json'));

assert(
  /match \/adminUsers\/\{userId\} \{[\s\S]*?allow create, update, delete: if false;/.test(firestoreRules),
  'adminUsers deve impedir autoelevação pelo cliente.'
);
assert(
  /match \/vehicles\/\{vehicleId\} \{[\s\S]*?allow read, write: if false;/.test(firestoreRules),
  'vehicles deve permanecer governado pela Leaf API.'
);
assert(
  /match \/driver_withdrawals\/\{withdrawalId\} \{[\s\S]*?allow create, update, delete: if false;/.test(firestoreRules),
  'driver_withdrawals deve impedir mutações diretas.'
);
assert(
  /match \/support_tickets\/\{ticketId\} \{[\s\S]*?allow create, update, delete: if false;/.test(firestoreRules),
  'support_tickets deve impedir mutações diretas.'
);
assert(
  /match \/trip_data\/\{tripId\} \{[\s\S]*?allow read, write: if false;/.test(firestoreRules),
  'trip_data deve permanecer governado pelo backend.'
);
assert(
  /match \/\{document=\*\*\} \{[\s\S]*?allow read, write: if false;/.test(firestoreRules),
  'Firestore deve terminar com deny-by-default.'
);
assert(
  /match \/\{object=\*\*\} \{[\s\S]*?allow read, write: if false;/.test(storageRules),
  'Storage deve negar acesso direto de clientes.'
);
assert(databaseRules.rules?.['.read'] === false, 'RTDB deve negar leitura na raiz.');
assert(databaseRules.rules?.['.write'] === false, 'RTDB deve negar escrita na raiz.');

const canonicalDeploy = read('config/firebase/deploy-rules.sh');
assert(
  canonicalDeploy.includes('--only "firestore:rules,database,storage"'),
  'O release canônico deve publicar Firestore, RTDB e Storage juntos.'
);
assert(
  canonicalDeploy.includes('npm run firebase:rules:check') &&
    canonicalDeploy.includes('npm run test:firebase:rules'),
  'O release canônico deve executar validação estática e emuladores.'
);
assert(
  canonicalDeploy.includes('CONFIRM_FIREBASE_RULES_PRODUCTION_DEPLOY') &&
    canonicalDeploy.includes('FIREBASE_RULES_RELEASE_SHA'),
  'O release canônico deve exigir confirmação e SHA explícitos.'
);
assert(
  canonicalDeploy.includes('CURRENT_BRANCH" = "main"') &&
    canonicalDeploy.includes('refs/remotes/origin/main'),
  'O release canônico deve exigir main limpa e sincronizada.'
);

const shellFiles = fs.readdirSync(firebaseDir)
  .filter((fileName) => fileName.endsWith('.sh'));
for (const fileName of shellFiles) {
  const source = read(`config/firebase/${fileName}`);
  if (fileName === 'deploy-rules.sh') continue;
  assert(!/firebase(?:-tools[^\n]*)?\s+deploy\b/.test(source), `${fileName} não pode publicar regras diretamente.`);
  assert(source.includes('deploy-rules.sh'), `${fileName} deve delegar ao release gate canônico.`);
}

if (!process.exitCode) {
  console.log('[firebase-rules-check] contrato de release e deny-by-default aprovado');
}
