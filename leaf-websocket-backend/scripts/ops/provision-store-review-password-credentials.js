#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const firebaseConfig = require('../../firebase-config');

const PASSWORD_COLLECTION = 'auth_password_credentials';
const BCRYPT_ROUNDS = Number.parseInt(process.env.AUTH_PASSWORD_BCRYPT_ROUNDS || '12', 10);
const DEFAULT_REVIEW_PASSWORD = process.env.REVIEW_COMMON_PASSWORD || 'teste123';

const REVIEW_ACCOUNTS = [
  {
    label: 'passenger',
    phone: process.env.REVIEW_PASSENGER_PHONE || '+5521102938475',
    userType: 'customer',
    password: process.env.REVIEW_PASSENGER_PASSWORD || DEFAULT_REVIEW_PASSWORD
  },
  {
    label: 'driver',
    phone: process.env.REVIEW_DRIVER_PHONE || '+5521123456789',
    userType: 'driver',
    password: process.env.REVIEW_DRIVER_PASSWORD || DEFAULT_REVIEW_PASSWORD
  }
];

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return digits.slice(2);
  }
  return digits;
}

function normalizeUserType(rawValue, fallback = 'customer') {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (normalized === 'driver') return 'driver';
  if (normalized === 'customer' || normalized === 'passenger') return 'customer';
  return String(fallback || 'customer').toLowerCase() === 'driver' ? 'driver' : 'customer';
}

function hashPhone(phoneDigits) {
  const pepper = process.env.AUTH_PASSWORD_PHONE_HASH_PEPPER || process.env.JWT_SECRET || 'leaf-phone-hash';
  return crypto.createHmac('sha256', pepper).update(String(phoneDigits || '')).digest('hex');
}

function buildPhoneLookupCandidates(phoneDigits, originalPhone) {
  const digits = String(phoneDigits || '');
  if (!digits) return [];

  const candidates = new Set();
  if (digits.startsWith('55')) {
    candidates.add(`+${digits}`);
    const localDigits = digits.slice(2);
    if (localDigits) {
      candidates.add(`+${localDigits}`);
    }
  } else {
    candidates.add(`+55${digits}`);
    candidates.add(`+${digits}`);
  }

  const rawPhone = String(originalPhone || '').trim();
  if (rawPhone.startsWith('+')) {
    candidates.add(rawPhone);
  }

  return Array.from(candidates);
}

async function resolveAuthUserByPhone(phoneDigits, originalPhone) {
  const candidates = buildPhoneLookupCandidates(phoneDigits, originalPhone);
  for (const candidate of candidates) {
    try {
      return await admin.auth().getUserByPhoneNumber(candidate);
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        continue;
      }
      throw error;
    }
  }
  return null;
}

function maskPhone(phoneDigits) {
  const digits = String(phoneDigits || '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

async function resolveProfileUserType(uid, fallback) {
  try {
    const profile = await firebaseConfig.getFromRealtimeDB(`users/${uid}`);
    return normalizeUserType(profile?.userType || profile?.usertype || profile?.type, fallback);
  } catch (_error) {
    return normalizeUserType(fallback, 'customer');
  }
}

async function upsertAccountCredential(firestore, account) {
  const phoneDigits = normalizePhone(account.phone);
  if (!phoneDigits) {
    throw new Error(`phone_missing:${account.label}`);
  }

  const phoneHash = hashPhone(phoneDigits);
  const ref = firestore.collection(PASSWORD_COLLECTION).doc(phoneHash);
  const snapshot = await ref.get();
  const existingData = snapshot.exists ? snapshot.data() || {} : {};

  let targetUid = existingData.uid || null;
  if (targetUid) {
    try {
      await admin.auth().getUser(targetUid);
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        targetUid = null;
      } else {
        throw error;
      }
    }
  }

  if (!targetUid) {
    const authUser = await resolveAuthUserByPhone(phoneDigits, account.phone);
    if (!authUser?.uid) {
      throw new Error(`auth_user_not_found:${account.label}`);
    }
    targetUid = authUser.uid;
  }

  const resolvedUserType = await resolveProfileUserType(targetUid, account.userType);
  const passwordHash = await bcrypt.hash(String(account.password), BCRYPT_ROUNDS);

  await ref.set(
    {
      uid: targetUid,
      phoneHash,
      phoneLast4: phoneDigits.slice(-4),
      userType: resolvedUserType,
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(snapshot.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() })
    },
    { merge: true }
  );

  await firebaseConfig.updateRealtimeDB(`users/${targetUid}`, {
    hasPassword: true,
    passwordLastUpdatedAt: new Date().toISOString()
  });

  return {
    label: account.label,
    uid: targetUid,
    phoneMasked: maskPhone(phoneDigits),
    userType: resolvedUserType,
    created: snapshot.exists !== true
  };
}

async function main() {
  const app = firebaseConfig.initializeFirebase();
  if (!app) {
    throw new Error('firebase_init_failed');
  }

  const firestore = firebaseConfig.getFirestore();
  if (!firestore) {
    throw new Error('firestore_unavailable');
  }

  const results = [];
  for (const account of REVIEW_ACCOUNTS) {
    const result = await upsertAccountCredential(firestore, account);
    results.push(result);
  }

  console.log('[review-password] credentials provisioned');
  for (const item of results) {
    console.log(
      `[review-password] ${item.label} uid=${item.uid} phone=${item.phoneMasked} userType=${item.userType} created=${item.created}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[review-password][error]', error?.message || error);
    process.exit(1);
  });
