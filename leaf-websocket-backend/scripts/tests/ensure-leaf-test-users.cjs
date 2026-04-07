#!/usr/bin/env node

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', '..', 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) throw new Error('phone_required');
  if (digits.length === 13 && digits.startsWith('55')) return '+' + digits;
  if (digits.length === 11) return '+55' + digits;
  if (digits.length === 10) return '+55' + digits;
  if (digits.startsWith('55')) return '+' + digits;
  return '+' + digits;
}

function titleFromPhone(phone, fallback) {
  const suffix = String(phone || '').replace(/\D/g, '').slice(-4);
  return `${fallback} ${suffix}`;
}

async function ensureAuthUserByPhone(auth, phone, displayName) {
  try {
    const existing = await auth.getUserByPhoneNumber(phone);
    if (displayName && existing.displayName !== displayName) {
      await auth.updateUser(existing.uid, { displayName });
      return auth.getUser(existing.uid);
    }
    return existing;
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    return auth.createUser({
      phoneNumber: phone,
      displayName
    });
  }
}

async function ensurePassengerProfile({ db, firestore, uid, phone, nowIso }) {
  const userRef = db.ref(`users/${uid}`);
  const snap = await userRef.once('value');
  const current = snap.val() || {};

  const firstName = current.firstName || 'Passageiro';
  const lastName = current.lastName || titleFromPhone(phone, 'Teste');
  const name = `${firstName} ${lastName}`.trim();

  await userRef.update({
    uid,
    firstName,
    lastName,
    name,
    mobile: phone,
    phone,
    phoneNumber: phone,
    usertype: 'customer',
    userType: 'customer',
    approved: true,
    isApproved: true,
    status: current.status || 'active',
    onboardingCompleted: true,
    profileComplete: true,
    phoneValidated: true,
    updatedAt: nowIso,
    lastLogin: nowIso
  });

  await firestore.collection('users').doc(uid).set({
    uid,
    mobile: phone,
    phone,
    phoneNumber: phone,
    usertype: 'customer',
    userType: 'customer',
    approved: true,
    status: 'active',
    updatedAt: nowIso
  }, { merge: true });
}

async function ensureDriverProfile({ db, firestore, uid, phone, nowIso }) {
  const userRef = db.ref(`users/${uid}`);
  const userSnap = await userRef.once('value');
  const current = userSnap.val() || {};

  const firstName = current.firstName || 'Motorista';
  const lastName = current.lastName || titleFromPhone(phone, 'Teste');
  const name = `${firstName} ${lastName}`.trim();
  const suffix = String(phone).replace(/\D/g, '').slice(-4);
  const carPlate = (current.carPlate || current.vehicleNumber || current.vehiclePlate || `TES${suffix}`).toUpperCase();
  const carType = current.carType || 'Leaf Plus';
  const vehicleId = current.vehicleId || `test_vehicle_${uid.slice(0, 12)}`;

  await userRef.update({
    uid,
    firstName,
    lastName,
    name,
    mobile: phone,
    phone,
    phoneNumber: phone,
    usertype: 'driver',
    userType: 'driver',
    approved: true,
    isApproved: true,
    status: 'approved',
    driverActiveStatus: true,
    onboardingCompleted: true,
    profileComplete: true,
    phoneValidated: true,
    carType,
    carPlate,
    vehicleNumber: carPlate,
    vehiclePlate: carPlate,
    vehicleId,
    kycBlocked: false,
    kyc_status: 'approved',
    kycReverifyRequired: false,
    updatedAt: nowIso,
    lastLogin: nowIso
  });

  await db.ref(`vehicles/${vehicleId}`).update({
    id: vehicleId,
    ownerId: uid,
    driver: uid,
    plate: carPlate,
    vehicleNumber: carPlate,
    carType,
    status: 'approved',
    approved: true,
    active: true,
    isActive: true,
    updatedAt: nowIso,
    createdAt: current.createdAt || nowIso
  });

  const userVehiclesRef = db.ref(`user_vehicles/${uid}`);
  const userVehiclesSnap = await userVehiclesRef.once('value');
  let userVehicleId = null;

  if (userVehiclesSnap.exists()) {
    userVehiclesSnap.forEach((child) => {
      const data = child.val() || {};
      if (!userVehicleId && (data.vehicleId === vehicleId || data.isActive === true)) {
        userVehicleId = child.key;
      }
    });
  }

  if (!userVehicleId) {
    userVehicleId = `uv_${vehicleId}`;
  }

  await db.ref(`user_vehicles/${uid}/${userVehicleId}`).update({
    id: userVehicleId,
    driverId: uid,
    userId: uid,
    vehicleId,
    plate: carPlate,
    vehicleNumber: carPlate,
    status: 'approved',
    approved: true,
    isActive: true,
    active: true,
    updatedAt: nowIso,
    assignedAt: nowIso
  });

  await db.ref(`vehicle_active_assignment/${vehicleId}`).set({
    userId: uid,
    driverId: uid,
    vehicleId,
    status: 'active',
    updatedAt: nowIso,
    createdAt: nowIso
  });

  await db.ref(`users/${uid}/documents`).update({
    cnh: { status: 'approved', approved: true, updatedAt: nowIso },
    crlv: { status: 'approved', approved: true, updatedAt: nowIso },
    mei: { status: 'approved', approved: true, updatedAt: nowIso }
  });

  await db.ref(`driver_activation/${uid}/status`).update({
    state: 'approved',
    updatedAt: nowIso,
    approved: 3,
    pending: 0,
    failed: 0,
    allApproved: true,
    checklist: {
      cnhEar: true,
      vehicleRegistration: true,
      inssOrMei: true,
      backgroundCheckConsent: true
    }
  });

  await db.ref(`driver_activation/${uid}/documents`).update({
    cnh: { status: 'approved', updatedAt: nowIso },
    crlv: { status: 'approved', updatedAt: nowIso },
    mei: { status: 'approved', updatedAt: nowIso }
  });

  await db.ref(`driver_activation/${uid}/consent/backgroundCheck`).update({
    accepted: true,
    acceptedAt: nowIso,
    updatedAt: nowIso
  });

  await firestore.collection('drivers').doc(uid).set({
    uid,
    usertype: 'driver',
    userType: 'driver',
    approved: true,
    status: 'approved',
    kycBlocked: false,
    kycStatus: 'approved',
    kycReverifyRequired: false,
    updatedAt: nowIso
  }, { merge: true });

  await firestore.collection('users').doc(uid).set({
    uid,
    mobile: phone,
    phone,
    phoneNumber: phone,
    usertype: 'driver',
    userType: 'driver',
    approved: true,
    status: 'approved',
    kycBlocked: false,
    kycStatus: 'approved',
    kycReverifyRequired: false,
    updatedAt: nowIso
  }, { merge: true });

  return { vehicleId, userVehicleId, carPlate, carType };
}

async function main() {
  const passengerPhone = normalizePhone(process.env.TEST_PASSENGER_PHONE || '11999999999');
  const passengerTwoPhone = normalizePhone(process.env.TEST_PASSENGER_TWO_PHONE || '11999999998');
  const passengerThreePhone = normalizePhone(process.env.TEST_PASSENGER_THREE_PHONE || '11999999997');
  const passengerFourPhone = normalizePhone(process.env.TEST_PASSENGER_FOUR_PHONE || '11999999996');
  const driverPhone = normalizePhone(process.env.TEST_DRIVER_PHONE || '11888888888');
  const driverTwoPhone = normalizePhone(process.env.TEST_DRIVER_TWO_PHONE || '11888888889');
  const nowIso = new Date().toISOString();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      databaseURL: 'https://leaf-reactnative-default-rtdb.firebaseio.com'
    });
  }

  const auth = admin.auth();
  const db = admin.database();
  const firestore = admin.firestore();

  const passengerAuth = await ensureAuthUserByPhone(auth, passengerPhone, 'Leaf Passageiro Teste');
  const passengerTwoAuth = await ensureAuthUserByPhone(auth, passengerTwoPhone, 'Leaf Passageiro Teste 2');
  const passengerThreeAuth = await ensureAuthUserByPhone(auth, passengerThreePhone, 'Leaf Passageiro Teste 3');
  const passengerFourAuth = await ensureAuthUserByPhone(auth, passengerFourPhone, 'Leaf Passageiro Teste 4');
  const driverAuth = await ensureAuthUserByPhone(auth, driverPhone, 'Leaf Motorista Teste');
  const driverTwoAuth = await ensureAuthUserByPhone(auth, driverTwoPhone, 'Leaf Motorista Teste 2');

  await ensurePassengerProfile({ db, firestore, uid: passengerAuth.uid, phone: passengerPhone, nowIso });
  await ensurePassengerProfile({ db, firestore, uid: passengerTwoAuth.uid, phone: passengerTwoPhone, nowIso });
  await ensurePassengerProfile({ db, firestore, uid: passengerThreeAuth.uid, phone: passengerThreePhone, nowIso });
  await ensurePassengerProfile({ db, firestore, uid: passengerFourAuth.uid, phone: passengerFourPhone, nowIso });
  const driverDetails = await ensureDriverProfile({ db, firestore, uid: driverAuth.uid, phone: driverPhone, nowIso });
  const driverTwoDetails = await ensureDriverProfile({
    db,
    firestore,
    uid: driverTwoAuth.uid,
    phone: driverTwoPhone,
    nowIso,
  });

  console.log(JSON.stringify({
    ok: true,
    passenger: {
      uid: passengerAuth.uid,
      phone: passengerPhone
    },
    passengerTwo: {
      uid: passengerTwoAuth.uid,
      phone: passengerTwoPhone
    },
    passengerThree: {
      uid: passengerThreeAuth.uid,
      phone: passengerThreePhone
    },
    passengerFour: {
      uid: passengerFourAuth.uid,
      phone: passengerFourPhone
    },
    driver: {
      uid: driverAuth.uid,
      phone: driverPhone,
      ...driverDetails
    },
    driverTwo: {
      uid: driverTwoAuth.uid,
      phone: driverTwoPhone,
      ...driverTwoDetails
    }
  }, null, 2));

  // Close Admin SDK handles so QA preflight can finish instead of hanging.
  await Promise.all(admin.apps.map((app) => app.delete().catch(() => undefined)));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
