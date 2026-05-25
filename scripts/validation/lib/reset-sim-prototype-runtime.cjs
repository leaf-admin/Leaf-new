#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function md5(value) {
  return crypto.createHash('md5').update(String(value)).digest('hex');
}

function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['driver', 'motorista', 'partner', 'parceiro'].includes(normalized)) {
    return 'driver';
  }
  if (['customer', 'passenger', 'rider', 'cliente'].includes(normalized)) {
    return 'customer';
  }
  return '';
}

function resolveStorageDir(udid, appId) {
  const containerPath = execFileSync(
    'xcrun',
    ['simctl', 'get_app_container', udid, appId, 'data'],
    { encoding: 'utf8' },
  ).trim();

  return path.join(
    containerPath,
    'Library',
    'Application Support',
    appId,
    'RCTAsyncLocalStorage_V1',
  );
}

function readJsonIfExists(filePath, fallbackValue = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallbackValue;
  }
}

function writeStorageValue(storageDir, manifest, key, value) {
  const filePath = path.join(storageDir, md5(key));
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  fs.writeFileSync(filePath, `${serialized}\n`);
  manifest[key] = serialized;
}

function buildDriverHomeSnapshot(uid) {
  return {
    activeRole: 'driver',
    isSocketConnected: false,
    isSocketAuthenticated: false,
    bookingStatus: 'idle',
    activeBookingId: null,
    activeBooking: null,
    searchingElapsedSeconds: 0,
    selectedDestination: null,
    tripDistanceKm: null,
    tripDurationMin: null,
    tripArrivalText: '',
    boardingDeadlineAt: null,
    boardingRemainingSec: 0,
    selectedFare: null,
    selectedVehicle: '',
    paymentMethod: 'pix',
    driverInfo: null,
    currentCoordinate: null,
    driverCoordinate: null,
    driverTripMeta: {
      leg: null,
      initialMeters: null,
      initialEtaMinutes: null,
      pickupAddress: '',
      destinationAddress: '',
      pickupCoordinate: null,
      destinationCoordinate: null,
      fare: 0,
      fareLabel: '',
    },
    driverOnline: false,
    driverOnlinePending: false,
    driverOnlineMutationSource: '',
    driverOffers: [],
    driverActiveRide: null,
    activeChatId: null,
    activeChatBookingId: null,
    chatMessages: [],
    tripHistory: [],
    lastReceipt: null,
    paymentState: {
      status: 'idle',
      paymentId: null,
      amount: 0,
      method: 'pix',
      error: '',
      refundStatus: null,
      refundAmount: 0,
      cancellationFee: 0,
      refundId: null,
      chargeId: null,
    },
    rideExtension: { status: 'idle' },
    driverExtensionRequest: { status: 'idle' },
    operationalContinuation: { status: 'idle' },
    lastError: '',
    socketError: '',
    documentAnalysisState: {
      byType: {},
      lastSyncedAt: null,
    },
    driverActivationRemote: null,
    profileUid: uid,
    profileName: 'Motorista',
  };
}

function buildPassengerHomeSnapshot(uid) {
  return {
    activeRole: 'customer',
    isSocketConnected: false,
    isSocketAuthenticated: false,
    bookingStatus: 'idle',
    activeBookingId: null,
    activeBooking: null,
    searchingElapsedSeconds: 0,
    selectedDestination: null,
    tripDistanceKm: null,
    tripDurationMin: null,
    tripArrivalText: '',
    boardingDeadlineAt: null,
    boardingRemainingSec: 0,
    selectedFare: null,
    selectedVehicle: '',
    paymentMethod: 'pix',
    driverInfo: null,
    currentCoordinate: null,
    driverCoordinate: null,
    driverTripMeta: {
      leg: null,
      initialMeters: null,
      initialEtaMinutes: null,
      pickupAddress: '',
      destinationAddress: '',
      pickupCoordinate: null,
      destinationCoordinate: null,
      fare: 0,
      fareLabel: '',
    },
    driverOnline: false,
    driverOnlinePending: false,
    driverOnlineMutationSource: '',
    driverOffers: [],
    driverActiveRide: null,
    activeChatId: null,
    activeChatBookingId: null,
    chatMessages: [],
    tripHistory: [],
    lastReceipt: null,
    paymentState: {
      status: 'idle',
      paymentId: null,
      amount: 0,
      method: 'pix',
      error: '',
      refundStatus: null,
      refundAmount: 0,
      cancellationFee: 0,
      refundId: null,
      chargeId: null,
    },
    rideExtension: { status: 'idle' },
    driverExtensionRequest: { status: 'idle' },
    operationalContinuation: { status: 'idle' },
    lastError: '',
    socketError: '',
    documentAnalysisState: {
      byType: {},
      lastSyncedAt: null,
    },
    driverActivationRemote: null,
    profileUid: uid,
    profileName: 'Leaf Passageiro Teste',
  };
}

function main() {
  const udid = readArg('--udid');
  const appId = readArg('--app-id');
  const role = normalizeRole(readArg('--role'));
  const explicitUid = readArg('--uid');

  if (!udid || !appId || !role) {
    console.error(
      'usage: reset-sim-prototype-runtime.cjs --udid <udid> --app-id <appId> --role <driver|customer> [--uid <uid>]',
    );
    process.exit(1);
  }

  const storageDir = resolveStorageDir(udid, appId);
  fs.mkdirSync(storageDir, { recursive: true });

  const manifestPath = path.join(storageDir, 'manifest.json');
  const manifest = readJsonIfExists(manifestPath, {}) || {};
  const authUid = String(explicitUid || manifest['@auth_uid'] || '').trim();
  if (!authUid) {
    console.error('missing_auth_uid');
    process.exit(1);
  }

  const runtimeKey = `@prototype_runtime_session_${authUid}`;
  const qaSeedKey = `@prototype_runtime_qa_seed_${authUid}`;
  const runtimeFilePath = path.join(storageDir, md5(runtimeKey));
  const qaSeedFilePath = path.join(storageDir, md5(qaSeedKey));

  fs.rmSync(runtimeFilePath, { force: true });
  fs.rmSync(qaSeedFilePath, { force: true });
  delete manifest[qaSeedKey];

  const runtimeSnapshot =
    role === 'driver'
      ? buildDriverHomeSnapshot(authUid)
      : buildPassengerHomeSnapshot(authUid);
  writeStorageValue(storageDir, manifest, runtimeKey, runtimeSnapshot);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}

main();
