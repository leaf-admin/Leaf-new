'use strict';

const {
  buildVehicleOcrUpdates,
  normalizeVehicleOcrPayload
} = require('../utils/vehicle-ocr-data');

const MAX_VEHICLES_PER_PROFILE = 4;

function snapshotValue(snapshot) {
  return snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
}

function normalizeRecordPlate(record = {}) {
  return normalizeVehicleOcrPayload({
    plate:
      record?.plateNormalized ||
      record?.plate ||
      record?.vehiclePlate ||
      record?.vehicleNumber ||
      record?.ocrData?.data?.plateNormalized ||
      record?.ocrData?.data?.plate ||
      ''
  }).plate || '';
}

function deterministicVehicleId(plate) {
  return `vehicle_crlv_${plate}`;
}

function deterministicUserVehicleId(plate) {
  return `crlv_${plate}`;
}

async function readCatalogRecord(db, vehicleId) {
  if (!vehicleId) return null;
  const snapshot = await db.ref(`vehicles/${vehicleId}`).once('value');
  const value = snapshotValue(snapshot);
  return value && typeof value === 'object'
    ? { id: vehicleId, ...value }
    : null;
}

async function findCatalogRecordByPlate(db, plate) {
  const snapshot = await db.ref('vehicles').once('value');
  const records = snapshotValue(snapshot) || {};
  const match = Object.entries(records).find(([, record]) => normalizeRecordPlate(record) === plate);
  return match ? { id: match[0], ...(match[1] || {}) } : null;
}

/**
 * Builds the atomic RTDB patch that materializes an approved CRLV as a
 * canonical vehicle and links it to the driver. The link intentionally starts
 * pending/inactive: document analysis may prove the vehicle identity, but only
 * the operational review flow can approve its category and activate it.
 */
async function buildApprovedCrlvVehicleLinkUpdates({
  db,
  driverId,
  crlvData,
  submissionId,
  extractionSource = null,
  model = null,
  updatedAt = new Date().toISOString()
} = {}) {
  const safeDriverId = String(driverId || '').trim();
  if (!db?.ref || !safeDriverId) {
    throw new Error('CRLV_VEHICLE_LINK_INPUT_INVALID');
  }

  const normalized = normalizeVehicleOcrPayload(crlvData || {});
  if (!normalized.plate || !normalized.model || !normalized.color || !normalized.renavam) {
    throw new Error('CRLV_VEHICLE_IDENTITY_INCOMPLETE');
  }

  const [indexSnapshot, userVehiclesSnapshot] = await Promise.all([
    db.ref(`vehicle_plate_index/${normalized.plate}`).once('value'),
    db.ref(`user_vehicles/${safeDriverId}`).once('value')
  ]);
  const rawIndexedVehicleId = snapshotValue(indexSnapshot);
  const indexedVehicleId = typeof rawIndexedVehicleId === 'string' || typeof rawIndexedVehicleId === 'number'
    ? String(rawIndexedVehicleId).trim()
    : '';
  const userVehicles = snapshotValue(userVehiclesSnapshot) || {};
  const userVehicleEntries = Object.entries(userVehicles).map(([id, record]) => ({
    id,
    ...(record || {})
  }));
  const directPlateLink = userVehicleEntries.find((record) => normalizeRecordPlate(record) === normalized.plate) || null;

  let catalog = null;
  let vehicleId = '';

  if (indexedVehicleId) {
    catalog = await readCatalogRecord(db, indexedVehicleId);
    const indexedPlate = normalizeRecordPlate(catalog || {});
    if (indexedPlate && indexedPlate !== normalized.plate) {
      throw new Error('CRLV_VEHICLE_INDEX_CONFLICT');
    }
    vehicleId = indexedVehicleId;
  } else if (directPlateLink?.vehicleId) {
    vehicleId = String(directPlateLink.vehicleId).trim();
    catalog = await readCatalogRecord(db, vehicleId);
    const linkedCatalogPlate = normalizeRecordPlate(catalog || {});
    if (linkedCatalogPlate && linkedCatalogPlate !== normalized.plate) {
      throw new Error('CRLV_VEHICLE_LINK_CONFLICT');
    }
  } else {
    // Legacy catalogs may predate vehicle_plate_index. Scan only when neither
    // the canonical index nor this driver's existing same-plate link can route
    // the write safely.
    catalog = await findCatalogRecordByPlate(db, normalized.plate);
    vehicleId = String(catalog?.id || deterministicVehicleId(normalized.plate));
  }

  const conflictingDirectLink = directPlateLink?.vehicleId && String(directPlateLink.vehicleId) !== vehicleId;
  if (conflictingDirectLink) {
    throw new Error('CRLV_VEHICLE_LINK_CONFLICT');
  }

  const existingLink = userVehicleEntries.find((record) => String(record.vehicleId || '') === vehicleId) || directPlateLink;
  const existingLinkPlate = normalizeRecordPlate(existingLink || {});
  if (existingLinkPlate && existingLinkPlate !== normalized.plate) {
    throw new Error('CRLV_VEHICLE_LINK_CONFLICT');
  }
  if (!existingLink && userVehicleEntries.length >= MAX_VEHICLES_PER_PROFILE) {
    throw new Error('CRLV_VEHICLE_PROFILE_LIMIT_REACHED');
  }
  const userVehicleId = String(existingLink?.id || deterministicUserVehicleId(normalized.plate));
  const createdCatalog = !catalog;
  const createdLink = !existingLink;
  const auditMetadata = {
    submissionId: String(submissionId || '').trim(),
    extractionSource: String(extractionSource || '').trim(),
    model: String(model || '').trim()
  };
  const { updates } = buildVehicleOcrUpdates({
    vehicleId,
    userId: safeDriverId,
    userVehicleId,
    payload: normalized,
    metadata: auditMetadata,
    nowIso: updatedAt
  });

  updates[`vehicle_plate_index/${normalized.plate}`] = vehicleId;
  updates[`user_vehicles/${safeDriverId}/${userVehicleId}/id`] = userVehicleId;
  updates[`user_vehicles/${safeDriverId}/${userVehicleId}/userId`] = safeDriverId;
  updates[`user_vehicles/${safeDriverId}/${userVehicleId}/vehicleId`] = vehicleId;

  if (createdCatalog) {
    updates[`vehicles/${vehicleId}/id`] = vehicleId;
    updates[`vehicles/${vehicleId}/status`] = 'idle';
    updates[`vehicles/${vehicleId}/createdAt`] = updatedAt;
  }

  if (createdLink) {
    updates[`user_vehicles/${safeDriverId}/${userVehicleId}/status`] = 'pending';
    updates[`user_vehicles/${safeDriverId}/${userVehicleId}/approved`] = false;
    updates[`user_vehicles/${safeDriverId}/${userVehicleId}/isActive`] = false;
    updates[`user_vehicles/${safeDriverId}/${userVehicleId}/createdAt`] = updatedAt;
  }

  return {
    vehicleId,
    userVehicleId,
    createdCatalog,
    createdLink,
    normalized,
    updates
  };
}

async function materializeApprovedCrlvVehicleLink(options = {}) {
  const result = await buildApprovedCrlvVehicleLinkUpdates(options);
  await options.db.ref().update(result.updates);
  return result;
}

module.exports = {
  buildApprovedCrlvVehicleLinkUpdates,
  deterministicUserVehicleId,
  deterministicVehicleId,
  materializeApprovedCrlvVehicleLink
};
