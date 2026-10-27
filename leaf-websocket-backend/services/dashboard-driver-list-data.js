'use strict';
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const error = (code, message, statusCode = 503) => Object.assign(new Error(message), { code, statusCode });
const PROFILE_FIELDS = ['usertype', 'firstName', 'lastName', 'email', 'mobile', 'profile_image', 'createdAt', 'lastLogin',
  'planType', 'free_trial_end', 'free_months_end', 'promotion_free_end', 'billing_status', 'approved', 'suspended',
  'licenseImage', 'kyc_status', 'driverRating', 'driverActiveStatus', 'lastLocationUpdate'];

function boundedValue(snapshot, limit, label) {
  const value = snapshot.val() || {};
  if (Object.keys(value).length > limit || Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) {
    throw error('DASHBOARD_LEGACY_BUDGET', `Consulta de ${label} excede orçamento legado`);
  }
  return value;
}

// The legacy RTDB `cars` root never existed here and RTDB `bookings` never held
// rides (only annotations without a driver), so per-driver car and trip stats
// were always empty; they are no longer read (neither page mode reads cars).
async function readLegacy(firestore) {
  if (!firestore) throw error('DASHBOARD_LEGACY_UNAVAILABLE', 'Listagem temporariamente indisponível');
  const drivers = await require('./user-store').queryUsers(firestore, 'usertype', 'driver', { limit: 201 });
  const users = boundedValue({ val: () => drivers }, 200, 'motoristas');
  return { users, carsByDriver: new Map(), statsByDriver: new Map(), mode: 'legacy-bounded' };
}

function decodeCursor(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error();
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (value.v !== 1 || value.scope !== 'dashboard-drivers-iso-v1' || typeof value.id !== 'string'
      || !value.id || value.id.length > 256 || new Date(value.at).toISOString() !== value.at) throw new Error();
    return value;
  } catch (_) { throw error('DASHBOARD_CURSOR_INVALID', 'Cursor de motoristas inválido', 400); }
}

async function readPage({ firestore: providedFirestore, getFirestore, params, resolveNet }) {
  const wantsCursor = params.pagination === 'cursor' || Boolean(params.cursor);
  const complexFilter = ['status', 'planType', 'approvalStatus', 'search'].some(key => params[key] && params[key] !== 'all');
  if (!wantsCursor || process.env.ENABLE_ADMIN_DRIVER_CURSOR_READS !== 'true' || complexFilter) {
    if (params.cursor) throw error('DASHBOARD_CURSOR_REFRESH', 'Atualize os filtros para continuar', 409);
    // Legacy substring/derived subscription filters remain exact only in their
    // controlled dataset; never scan a large database to emulate them.
    return readLegacy(providedFirestore || getFirestore?.());
  }
  const firestore = providedFirestore || getFirestore?.();
  if (!firestore) throw error('DASHBOARD_CURSOR_UNAVAILABLE', 'Listagem temporariamente indisponível');
  if (Number(params.page || 1) !== 1) throw error('DASHBOARD_CURSOR_REFRESH', 'Use o cursor para continuar', 409);
  const cursor = params.cursor ? decodeCursor(params.cursor) : null;
  const readiness = await firestore.collection('ops_read_models').doc('driver_directory_v1').get()
    .catch(error => { error.statusCode = 503; throw error; });
  const attestation = readiness.exists ? readiness.data() : null;
  if (attestation?.schema !== 1 || attestation?.ready !== true || attestation?.createdAtStorage !== 'iso') {
    throw error('DASHBOARD_DIRECTORY_NOT_READY', 'Cadastro de motoristas aguardando conciliação');
  }
  const limit = Math.min(200, Math.max(1, Number.parseInt(params.limit, 10) || 50));
  let query = firestore.collection('users').where('usertype', '==', 'driver')
    .orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
  if (cursor) query = query.startAfter(cursor.at, cursor.id);
  const snapshot = await query.select(...PROFILE_FIELDS).limit(limit + 1).get()
    .catch(error => { error.statusCode = 503; throw error; });
  const docs = snapshot.docs.slice(0, limit);
  const users = {};
  for (const doc of docs) {
    const raw = doc.data();
    if (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt)) || new Date(raw.createdAt).toISOString() !== raw.createdAt) {
      throw error('DASHBOARD_DIRECTORY_SCHEMA', 'Cadastro de motoristas requer conciliação');
    }
    users[doc.id] = raw;
  }
  if (Buffer.byteLength(JSON.stringify(users)) > 4 * 1024 * 1024) throw error('DASHBOARD_PAGE_BYTES', 'Página excede orçamento');
  const ids = Object.keys(users);
  const statsByDriver = new Map();
  if (ids.length) {
    const refs = ids.map(id => firestore.collection('ops_driver_stats_v1').doc(hash(id)));
    const snapshots = await firestore.getAll(...refs, { fieldMask: ['driverId', 'namespace', 'schema', 'complete', 'source', 'completedTrips', 'driverNetMinor', 'pendingFinancialTrips', 'updatedAt'] });
    if (snapshots.length !== ids.length) throw error('DASHBOARD_STATS_INCOMPLETE', 'Estatísticas indisponíveis');
    snapshots.forEach((doc, i) => {
      const data = doc.exists ? doc.data() : null;
      const valid = data?.schema === 1 && data?.complete === true && data?.namespace === 'operational'
        && data?.driverId === ids[i] && data?.source === 'ride_finalization_v1'
        && Number(data.pendingFinancialTrips || 0) === 0 && Number.isSafeInteger(data.completedTrips) && Number.isSafeInteger(data.driverNetMinor);
      statsByDriver.set(ids[i], { totalTrips: null, completedTrips: valid ? data.completedTrips : null,
        totalEarnings: valid ? data.driverNetMinor / 100 : null, source: valid ? 'aggregate-v1' : 'unavailable' });
    });
  }
  const last = docs[docs.length - 1];
  const hasMore = snapshot.docs.length > limit;
  return { users, carsByDriver: new Map(), statsByDriver, mode: 'firestore-keyset', pagination: {
    page: 1, limit, total: null, totalPages: null, hasMore,
    nextCursor: hasMore ? Buffer.from(JSON.stringify({ v: 1, scope: 'dashboard-drivers-iso-v1', id: last.id, at: users[last.id].createdAt })).toString('base64url') : null
  } };
}

module.exports = { readPage, readLegacy, decodeCursor, boundedValue, PROFILE_FIELDS };
