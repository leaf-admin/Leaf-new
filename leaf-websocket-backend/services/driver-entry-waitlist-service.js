const { logStructured } = require('../utils/logger');

// Dependências pesadas (Firestore, Redis, FCM) carregadas sob demanda: este módulo é lido pela
// aprovação automática, que não pode puxar conexões na inicialização.
const JOINED_EVENT = 'joined';

// Entrada controlada de motoristas: com DRIVER_ENTRY_WAITLIST_GATE ligado, o motorista que
// completa o cadastro (estado canônico ACTIVE) vai para a fila da cidade em vez de ser aprovado
// na hora. Quem libera é um admin pela página de lista de espera do painel. Desligado, a
// aprovação automática segue como antes.
const DEFAULT_CITY_LABEL = 'Rio de Janeiro';
const DEFAULT_STATE_CODE = 'RJ';
const WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS = Number.parseInt(
  process.env.WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS || '300',
  10
);
const ENTRY_READY_STATUS = 'waitlisted';

function isDriverEntryWaitlistGateEnabled(env = process.env) {
  return ['true', '1', 'yes', 'on'].includes(String(env.DRIVER_ENTRY_WAITLIST_GATE || '').trim().toLowerCase());
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeStateCode(value) {
  return String(value || '').trim().toUpperCase();
}

function buildCity(city, citySlug, stateCode, stateData) {
  return {
    cityKey: city.key || citySlug,
    stateCode,
    cityLabel: city.label || city.name || citySlug,
    cityActive: city.active !== false,
    stateEnabled: stateData?.enabled !== false,
    waitlistEnabled: city.waitlistEnabled !== false,
    maxActiveDrivers: Number(city.maxActiveDrivers || WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS)
  };
}

function resolveCityConfigFromActivation(config, cityValue, fallbackStateCode) {
  const citySlug = slugify(cityValue);
  const safeStateCode = normalizeStateCode(fallbackStateCode) || DEFAULT_STATE_CODE;

  if (!citySlug) {
    return {
      cityKey: '',
      stateCode: safeStateCode,
      cityLabel: '',
      cityActive: true,
      stateEnabled: true,
      waitlistEnabled: true,
      maxActiveDrivers: WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS
    };
  }

  const states = (config && config.states && typeof config.states === 'object') ? config.states : {};

  if (states[safeStateCode]?.cities?.[citySlug]) {
    return buildCity(states[safeStateCode].cities[citySlug], citySlug, safeStateCode, states[safeStateCode]);
  }

  for (const [stateCode, stateData] of Object.entries(states)) {
    const city = stateData?.cities?.[citySlug];
    if (city) return buildCity(city, citySlug, normalizeStateCode(stateCode), stateData);
  }

  return {
    cityKey: citySlug,
    stateCode: safeStateCode,
    cityLabel: cityValue || citySlug,
    cityActive: true,
    stateEnabled: true,
    waitlistEnabled: true,
    maxActiveDrivers: WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS
  };
}

function isEntryReady(user = {}) {
  return String(user?.autoApproval?.status || '').toLowerCase() === ENTRY_READY_STATUS;
}

function createDriverEntryWaitlistService({
  getFirestore,
  serverTimestamp,
  loadCityConfig = () => require('./city-activation-state-service').getConfig(),
  getNotifier = () => require('./waitlist-notification-service'),
  now = () => new Date().toISOString()
} = {}) {
  // Idempotente: se o motorista já tem entrada pendente, devolve a mesma posição.
  async function enqueueReadyDriver({ driverId, user = {} }) {
    const firestore = getFirestore();
    const existing = await firestore.collection('waitList')
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .get();

    if (!existing.empty) {
      const entry = existing.docs[0].data() || {};
      return {
        queued: true,
        created: false,
        position: Number(entry.position || 0) || null,
        cityKey: entry.cityKey || null,
        cityLabel: entry.cityLabel || null
      };
    }

    const cityConfig = await loadCityConfig();
    const city = resolveCityConfigFromActivation(
      cityConfig,
      user.waitListCityKey || user.city || user.citySlug || DEFAULT_CITY_LABEL,
      user.waitListStateCode || user.state || DEFAULT_STATE_CODE
    );

    const pending = await firestore.collection('waitList')
      .where('status', '==', 'pending')
      .where('cityKey', '==', city.cityKey)
      .get();
    const position = pending.docs.reduce((max, doc) => Math.max(max, Number(doc.data()?.position || 0)), 0) + 1;
    const cityLabel = city.cityLabel || DEFAULT_CITY_LABEL;

    await firestore.collection('waitList').add({
      driverId,
      position,
      status: 'pending',
      joinedAt: serverTimestamp(),
      priority: 'normal',
      priorityWeight: 1,
      notes: '',
      adminId: null,
      source: 'registration_complete',
      cityKey: city.cityKey,
      cityLabel,
      stateCode: city.stateCode
    });

    await firestore.collection('users').doc(driverId).set({
      waitListStatus: 'pending',
      waitListPosition: position,
      waitListJoinedAt: serverTimestamp(),
      waitListCityKey: city.cityKey,
      waitListCityLabel: cityLabel,
      waitListStateCode: city.stateCode,
      waitListPriority: 'normal',
      waitListPriorityWeight: 1
    }, { merge: true });

    try {
      await getNotifier().dispatch(driverId, JOINED_EVENT, {
        status: 'pending',
        position,
        cityKey: city.cityKey,
        cityLabel,
        registrationComplete: true
      });
    } catch (error) {
      logStructured('warn', 'Falha ao avisar motorista que entrou na fila', {
        service: 'driver-entry-waitlist', driverId, error: error?.message || String(error)
      });
    }

    logStructured('info', 'Motorista com cadastro completo entrou na fila', {
      service: 'driver-entry-waitlist', driverId, cityKey: city.cityKey, position, at: now()
    });
    return { queued: true, created: true, position, cityKey: city.cityKey, cityLabel };
  }

  return { enqueueReadyDriver };
}

let defaultService = null;
function getDefaultDriverEntryWaitlistService() {
  if (!defaultService) {
    const admin = require('firebase-admin');
    const firebaseConfig = require('../firebase-config');
    defaultService = createDriverEntryWaitlistService({
      getFirestore: () => firebaseConfig.getFirestore(),
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
    });
  }
  return defaultService;
}

module.exports = {
  ENTRY_READY_STATUS,
  WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS,
  createDriverEntryWaitlistService,
  getDefaultDriverEntryWaitlistService,
  isDriverEntryWaitlistGateEnabled,
  isEntryReady,
  normalizeStateCode,
  resolveCityConfigFromActivation,
  slugify
};
