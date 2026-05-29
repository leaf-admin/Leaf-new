#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const admin = require('firebase-admin');
const dotenv = require('dotenv');

const CnhFaceBiometricService = require('../../services/cnh-face-biometric-service');

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.production.sandbox') });

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/kyc/generate-cnh-face-embedding.cjs --driver-id <uid> [--dry-run]',
    '  node scripts/kyc/generate-cnh-face-embedding.cjs --storage-path <path> [--driver-id <uid>] --dry-run',
    '',
    'Required env:',
    '  BIOMETRIC_FACE_SERVICE_URL',
    '  BIOMETRIC_FACE_SERVICE_API_KEY',
    '  FIREBASE_SERVICE_ACCOUNT_JSON or local firebase admin JSON'
  ].join('\n');
}

function mask(value) {
  const safe = String(value || '');
  if (safe.length <= 10) return safe;
  return `${safe.slice(0, 6)}...${safe.slice(-4)}`;
}

function withoutEmbedding(payload = {}) {
  const { embedding, ...rest } = payload;
  return rest;
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function initializeFirebase() {
  if (admin.apps.length) return admin.app();

  const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://leaf-reactnative-default-rtdb.firebaseio.com';
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 'leaf-reactnative.firebasestorage.app';
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (serviceAccountJson) {
    return admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
      databaseURL,
      storageBucket
    });
  }

  const serviceAccountPath = path.join(__dirname, '../../leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error('Firebase service account not found. Set FIREBASE_SERVICE_ACCOUNT_JSON.');
  }

  return admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
    databaseURL,
    storageBucket
  });
}

async function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        return fetchBuffer(response.headers.location).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} while downloading document`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function downloadStoragePath(storagePath) {
  const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || 'leaf-reactnative.firebasestorage.app');
  const [buffer] = await bucket.file(storagePath).download();
  return buffer;
}

async function resolveDriverDocument(driverId) {
  const db = admin.database();
  const [userDocSnap, userSnap, activationDocSnap] = await Promise.all([
    db.ref(`users/${driverId}/documents/cnh`).once('value'),
    db.ref(`users/${driverId}`).once('value'),
    db.ref(`driver_activation/${driverId}/documents/cnh`).once('value')
  ]);
  const userDoc = userDocSnap.val() || {};
  const user = userSnap.val() || {};
  const activationDoc = activationDocSnap.val() || {};
  return userDoc.filePath || activationDoc.filePath
    ? {
      source: userDoc.filePath ? 'users.documents.cnh.filePath' : 'driver_activation.documents.cnh.filePath',
      storagePath: userDoc.filePath || activationDoc.filePath,
      submissionId: userDoc.submissionId || activationDoc.submissionId || null,
      fileName: userDoc.fileName || activationDoc.fileName || null
    }
    : {
      source: userDoc.fileUrl
        ? 'users.documents.cnh.fileUrl'
        : (activationDoc.fileUrl ? 'driver_activation.documents.cnh.fileUrl' : 'users.licenseImage'),
      fileUrl: userDoc.fileUrl || activationDoc.fileUrl || user.licenseImage || null,
      submissionId: userDoc.submissionId || activationDoc.submissionId || null,
      fileName: userDoc.fileName || activationDoc.fileName || null
    };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const driverId = String(args['driver-id'] || '').trim();
  const storagePath = String(args['storage-path'] || '').trim();
  const dryRun = args['dry-run'] === true || String(args['dry-run']).toLowerCase() === 'true';

  if (!driverId && !storagePath) {
    console.error(usage());
    process.exit(2);
  }

  requireEnv('BIOMETRIC_FACE_SERVICE_URL');
  requireEnv('BIOMETRIC_FACE_SERVICE_API_KEY');
  initializeFirebase();

  let resolved = {
    storagePath: storagePath || null,
    source: storagePath ? 'cli.storagePath' : null,
    submissionId: null,
    fileName: null
  };
  if (!resolved.storagePath) {
    resolved = await resolveDriverDocument(driverId);
  }
  if (!resolved.storagePath && !resolved.fileUrl) {
    throw new Error('CNH document not found for driver');
  }

  const buffer = resolved.storagePath
    ? await downloadStoragePath(resolved.storagePath)
    : await fetchBuffer(resolved.fileUrl);

  const service = new CnhFaceBiometricService();
  const startedAt = Date.now();
  const result = await service.generateCnhFaceEmbeddingFromPdf(buffer, {
    filename: resolved.fileName || path.basename(resolved.storagePath || 'cnh')
  });

  const biometricPayload = {
    provider: 'leaf_face_compare_service',
    status: 'generated',
    source: result.source || 'cnh_document',
    embedding: result.embedding,
    dimension: result.dimension || null,
    embeddingNorm: result.embedding_norm || null,
    faceCount: result.face_count || null,
    selectedFace: result.selected_face || null,
    model: result.model || null,
    crop: result.crop || null,
    documentType: 'cnh',
    submissionId: resolved.submissionId || null,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt
  };

  if (driverId && !dryRun) {
    await admin.database().ref().update({
      [`users/${driverId}/biometrics/cnhFace`]: biometricPayload,
      [`driver_activation/${driverId}/biometrics/cnhFace`]: withoutEmbedding(biometricPayload)
    });
  }

  console.log(JSON.stringify({
    success: true,
    driverIdMasked: driverId ? mask(driverId) : null,
    persisted: Boolean(driverId && !dryRun),
    dryRun,
    documentSource: resolved.source,
    storagePathMasked: resolved.storagePath ? resolved.storagePath.replace(driverId, mask(driverId)) : null,
    dimension: biometricPayload.dimension,
    embeddingLength: Array.isArray(biometricPayload.embedding) ? biometricPayload.embedding.length : 0,
    faceCount: biometricPayload.faceCount,
    detectionScore: biometricPayload.selectedFace?.detection_score || null,
    source: biometricPayload.source,
    durationMs: biometricPayload.durationMs
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error.message
  }, null, 2));
  process.exit(1);
});
