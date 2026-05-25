#!/usr/bin/env node

const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function deepGet(obj, pathStr) {
  if (!pathStr) return obj;
  const keys = pathStr.split('/').filter(Boolean);
  let current = obj;
  for (const k of keys) {
    if (current == null) return undefined;
    current = current[k];
  }
  return current;
}

function deepSet(obj, pathStr, value) {
  const keys = pathStr.split('/').filter(Boolean);
  let current = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    if (!current[k] || typeof current[k] !== 'object') {
      current[k] = {};
    }
    current = current[k];
  }
  current[keys[keys.length - 1]] = value;
}

function deepMerge(target, src) {
  if (!src || typeof src !== 'object') return target;
  Object.keys(src).forEach((key) => {
    const srcVal = src[key];
    if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], srcVal);
    } else {
      target[key] = srcVal;
    }
  });
  return target;
}

class FakeSnapshot {
  constructor(value) {
    this._value = value;
  }
  val() {
    return this._value;
  }
  exists() {
    return this._value !== null && this._value !== undefined;
  }
}

class FakeRef {
  constructor(root, pathStr) {
    this.root = root;
    this.pathStr = pathStr;
  }

  child(key) {
    return new FakeRef(this.root, `${this.pathStr}/${key}`);
  }

  async once() {
    return new FakeSnapshot(deepGet(this.root.state, this.pathStr));
  }

  async set(value) {
    deepSet(this.root.state, this.pathStr, value);
  }

  async update(partial) {
    const current = deepGet(this.root.state, this.pathStr) || {};
    const merged = deepMerge({ ...current }, partial);
    deepSet(this.root.state, this.pathStr, merged);
  }

  async transaction(updater) {
    const current = deepGet(this.root.state, this.pathStr);
    const next = updater(current);
    deepSet(this.root.state, this.pathStr, next);
    return { committed: true, snapshot: new FakeSnapshot(next) };
  }
}

class FakeRealtimeDB {
  constructor(state) {
    this.state = state;
  }

  ref(pathStr = '') {
    return new FakeRef(this, pathStr);
  }
}

class FakeDoc {
  constructor(store, pathStr) {
    this.store = store;
    this.pathStr = pathStr;
  }

  collection(name) {
    return {
      doc: (id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`) =>
        new FakeDoc(this.store, `${this.pathStr}/${name}/${id}`),
    };
  }

  async set(payload, opts = {}) {
    const current = deepGet(this.store, this.pathStr) || {};
    const next = opts.merge ? deepMerge({ ...current }, payload) : payload;
    deepSet(this.store, this.pathStr, next);
  }
}

class FakeFirestore {
  constructor(store) {
    this.store = store;
  }

  collection(name) {
    return {
      doc: (id) => new FakeDoc(this.store, `${name}/${id}`),
    };
  }

  async runTransaction(handler) {
    const tx = {
      get: async (docRef) => ({
        exists: deepGet(this.store, docRef.pathStr) !== undefined,
        data: () => deepGet(this.store, docRef.pathStr) || {},
      }),
      set: (docRef, payload, opts = {}) => {
        const current = deepGet(this.store, docRef.pathStr) || {};
        const next = opts.merge ? deepMerge({ ...current }, payload) : payload;
        deepSet(this.store, docRef.pathStr, next);
      },
    };
    return handler(tx);
  }
}

async function run() {
  const fakeState = {
    users: {
      driver_grace: { usertype: 'driver', approved: true, planType: 'plus' },
      driver_block: { usertype: 'driver', approved: true, planType: 'plus' },
      driver_recover: { usertype: 'driver', approved: true, planType: 'plus' },
    },
    subscriptions: {
      driver_block: {
        status: 'grace_period',
        pendingFeeCents: 1400,
        gracePeriodStartsAt: new Date(Date.now() - (4 * 24 * 60 * 60 * 1000)).toISOString(),
        gracePeriodEndsAt: new Date(Date.now() - (1 * 24 * 60 * 60 * 1000)).toISOString(),
      },
      driver_recover: {
        status: 'blocked',
        pendingFeeCents: 500,
      },
    },
    firestore: {
      driver_balances: {
        driver_grace: { balance: 1.0 },
        driver_block: { balance: 1.0 },
        driver_recover: { balance: 20.0 },
      },
    },
  };

  const fakeRealtime = new FakeRealtimeDB(fakeState);
  const fakeFirestore = new FakeFirestore(fakeState.firestore);

  const firebaseConfig = require(path.join(__dirname, '..', '..', 'firebase-config'));
  firebaseConfig.getRealtimeDB = () => fakeRealtime;
  firebaseConfig.getFirestore = () => fakeFirestore;

  const admin = require('firebase-admin');
  if (!admin.firestore) admin.firestore = {};
  if (!admin.firestore.FieldValue) admin.firestore.FieldValue = {};
  admin.firestore.FieldValue.serverTimestamp = () => new Date().toISOString();

  const service = require(path.join(__dirname, '..', '..', 'services', 'daily-subscription-service'));

  // Cenário 1: cobrança diária acumula pendência para liquidar no saque
  const r1 = await service.processDailyCharge('driver_grace', fakeState.users.driver_grace);
  assert(r1.success === true, 'Cenário 1 deveria processar com sucesso');
  const s1 = fakeState.subscriptions.driver_grace;
  assert(s1.status === 'active', 'Cenário 1 deveria manter assinatura ativa');
  assert((s1.pendingFeeCents || 0) > 0, 'Cenário 1 deveria acumular pendingFeeCents');
  assert(fakeState.users.driver_grace.billing_status === 'overdue', 'Cenário 1 deveria marcar billing_status=overdue');

  // Cenário 2: estado legado grace_period expirado não bloqueia no novo modelo
  const r2 = await service.processDailyCharge('driver_block', fakeState.users.driver_block);
  assert(r2.success === true, 'Cenário 2 deveria processar com sucesso');
  const s2 = fakeState.subscriptions.driver_block;
  assert(s2.status === 'active', 'Cenário 2 deveria voltar para active (sem bloqueio automático)');
  assert(fakeState.users.driver_block.billing_status === 'overdue', 'Cenário 2 deveria manter billing_status=overdue');

  // Cenário 3: status bloqueado legado permanece bloqueado até ação manual/admin
  const r3 = await service.processDailyCharge('driver_recover', fakeState.users.driver_recover);
  assert(r3.success === true, 'Cenário 3 deveria processar com sucesso');
  const s3 = fakeState.subscriptions.driver_recover;
  assert(s3.status === 'blocked', 'Cenário 3 deveria manter status bloqueado');
  assert((s3.pendingFeeCents || 0) > 0, 'Cenário 3 deveria manter/acumular pendingFeeCents');
  assert(fakeState.users.driver_recover.billing_status === 'suspended', 'Cenário 3 deveria manter billing_status=suspended');

  console.log('✅ TESTE OK: assinatura diária com cobrança no saque validada com mock');
  console.log(JSON.stringify({
    scenario1: { status: s1.status, pendingFeeCents: s1.pendingFeeCents, billing: fakeState.users.driver_grace.billing_status },
    scenario2: { status: s2.status, pendingFeeCents: s2.pendingFeeCents, billing: fakeState.users.driver_block.billing_status },
    scenario3: { status: s3.status, pendingFeeCents: s3.pendingFeeCents, billing: fakeState.users.driver_recover.billing_status },
  }, null, 2));
}

run().catch((error) => {
  console.error('❌ TESTE FALHOU:', error.message);
  process.exit(1);
});
