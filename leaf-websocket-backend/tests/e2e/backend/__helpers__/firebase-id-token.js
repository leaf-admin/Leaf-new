const fs = require('fs');
const path = require('path');
const axios = require('axios');
const admin = require('firebase-admin');

const tokenCache = new Map();
const CACHE_TTL_MS = 50 * 60 * 1000; // idToken do Firebase costuma expirar em ~60min

function getProjectRoot() {
  return path.join(__dirname, '../../../..');
}

function readEnvValueFromFile(filePath, key) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)\\s*$`, 'm'));
    if (!match?.[1]) return '';
    return String(match[1]).trim().replace(/^['"]|['"]$/g, '');
  } catch (_error) {
    return '';
  }
}

function readFirebaseApiKeyFromGoogleServices(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return (
      parsed?.client?.[0]?.api_key?.[0]?.current_key ||
      parsed?.client?.find((entry) => entry?.api_key?.[0]?.current_key)?.api_key?.[0]?.current_key ||
      ''
    );
  } catch (_error) {
    return '';
  }
}

function readFirebaseApiKeyFromPlist(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/<key>API_KEY<\/key>\s*<string>([^<]+)<\/string>/);
    return String(match?.[1] || '').trim();
  } catch (_error) {
    return '';
  }
}

function resolveFirebaseApiKey() {
  const root = getProjectRoot();
  const candidates = [
    () => process.env.FIREBASE_API_KEY,
    () => process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    () => readFirebaseApiKeyFromGoogleServices(path.join(root, '../mobile-app/google-services.json')),
    () => readFirebaseApiKeyFromGoogleServices(path.join(root, '../mobile-app/android/app/google-services.json')),
    () => readFirebaseApiKeyFromPlist(path.join(root, '../mobile-app/GoogleService-Info.plist')),
    () => readFirebaseApiKeyFromPlist(path.join(root, '../mobile-app/ios/Leaf/GoogleService-Info.plist')),
    () => readEnvValueFromFile(path.join(root, '.env'), 'FIREBASE_API_KEY'),
    () => readEnvValueFromFile(path.join(root, '.env'), 'EXPO_PUBLIC_FIREBASE_API_KEY'),
    () => readEnvValueFromFile(path.join(root, '../mobile-app/.env.production'), 'FIREBASE_API_KEY'),
    () => readEnvValueFromFile(path.join(root, '../mobile-app/.env.production'), 'EXPO_PUBLIC_FIREBASE_API_KEY'),
    () => readEnvValueFromFile(path.join(root, '../mobile-app/apk/.env.production'), 'FIREBASE_API_KEY'),
    () => readEnvValueFromFile(path.join(root, '../mobile-app/apk/.env.production'), 'EXPO_PUBLIC_FIREBASE_API_KEY'),
    () => readFirebaseApiKeyFromGoogleServices(path.join(root, '../mobile-app/google-services.example.json'))
  ];

  for (const pick of candidates) {
    const value = String(pick() || '').trim();
    if (/^YOUR_|_HERE$/i.test(value) || /YOUR_FIREBASE_API_KEY/i.test(value)) {
      continue;
    }
    if (value) return value;
  }
  return '';
}

function getServiceAccountPath() {
  return path.join(getProjectRoot(), 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
}

function ensureFirebaseAdmin() {
  if (admin.apps.length) return admin.auth();

  const credentialPath = getServiceAccountPath();
  if (!fs.existsSync(credentialPath)) {
    throw new Error(`Service account não encontrado em ${credentialPath}`);
  }

  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ||
    'https://leaf-reactnative-default-rtdb.firebaseio.com';

  admin.initializeApp({
    credential: admin.credential.cert(require(credentialPath)),
    databaseURL
  });
  return admin.auth();
}

async function exchangeCustomTokenForIdToken(customToken, apiKey) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
  const response = await axios.post(
    url,
    {
      token: customToken,
      returnSecureToken: true
    },
    { timeout: 20000 }
  );

  const idToken = String(response?.data?.idToken || '').trim();
  if (!idToken) {
    throw new Error('Firebase não retornou idToken no signInWithCustomToken');
  }
  return idToken;
}

async function getIdTokenForUid(uid) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) throw new Error('UID obrigatório para gerar token E2E');

  const cached = tokenCache.get(normalizedUid);
  if (cached && (Date.now() - cached.createdAt) < CACHE_TTL_MS) {
    return cached.idToken;
  }

  const apiKey = resolveFirebaseApiKey();
  if (!apiKey) {
    throw new Error('FIREBASE_API_KEY não encontrado para gerar token E2E');
  }

  const auth = ensureFirebaseAdmin();
  const customToken = await auth.createCustomToken(normalizedUid);
  const idToken = await exchangeCustomTokenForIdToken(customToken, apiKey);

  tokenCache.set(normalizedUid, { idToken, createdAt: Date.now() });
  return idToken;
}

module.exports = {
  getIdTokenForUid
};
