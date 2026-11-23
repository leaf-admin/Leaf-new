'use strict';

// Seguro APP por corrida (IZA): cadastro do motorista e um período por corrida.
//
// Regras da IZA (mensagem de homologação de 2026-11-23 e documentação):
// - Ordem: pessoa → contrato → período. 1 corrida = 1 período, em horário de Brasília.
// - O início aceita até 10 min de atraso. Sem encerramento, o período fecha sozinho
//   em 2 h; corrida mais longa abre um novo período logo depois do encerramento.
// - Cancelamento só nos 2 primeiros minutos; depois disso encerra (e é cobrado).
// - Falha não pode travar o motorista: nada aqui bloqueia a corrida.
// - Nova tentativa com intervalo e sem duplicar período. Como a IZA aceita dois
//   períodos com o mesmo início, antes de abrir de novo consultamos a lista.
// - Guardar o ID do período junto com o da corrida; logs de erro por 30 dias.
//
// Onde roda: eventos ride.started/completed/canceled no listener-worker e um ciclo
// por minuto (líder único via lock no Redis) que repete o que falhou, encerra
// corridas que terminaram sem evento, troca o período das corridas acima de 2 h e
// manda 1 ponto de GPS por minuto.
//
// Estado no Redis (iza:*). O registro do período também vai para o Firestore
// (insurance_periods/{bookingId}) para a conciliação com a IZA.

const { logStructured } = require('../../utils/logger');
const { IZA_TIMEZONE, readIzaConfig, isIzaConfigured, toIzaLocalDateTime } = require('./iza-client');

const KEYS = Object.freeze({
  record: (bookingId) => `iza:period:${bookingId}`,
  active: 'iza:periods:active',
  insurePending: 'iza:insure:pending',
  insured: (driverId) => `iza:insured:${driverId}`,
  stats: (day) => `iza:stats:${day}`,
  errors: (day) => `iza:errors:${day}`,
  lock: (bookingId) => `iza:lock:${bookingId}`,
  sweepLock: 'iza:sweep:lock',
  deferred: 'iza:deferred'
});

const RECORD_TTL_SECONDS = 7 * 24 * 3600;
const INSURED_CACHE_TTL_SECONDS = 30 * 24 * 3600;
const STATS_TTL_SECONDS = 40 * 24 * 3600;
const ERRORS_TTL_SECONDS = 35 * 24 * 3600;
const ERRORS_MAX = 5000;
const LOCK_TTL_SECONDS = 45;
const LOCK_WAIT_MS = 15000;
const OPEN_TOLERANCE_MS = 10 * 60 * 1000; // a IZA aceita até 10 min de atraso no início
const CANCEL_WINDOW_MS = 110 * 1000; // 2 min da IZA, com folga para o relógio
const ROTATE_AFTER_MS = 115 * 60 * 1000; // troca antes do fechamento automático de 2 h
const GEO_INTERVAL_MS = 60 * 1000;
const GEO_MAX_AGE_MS = 3 * 60 * 1000;
const RETRY_BACKOFF_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
const INSURE_MAX_ATTEMPTS = 12;
const CLOSE_MAX_AGE_MS = 48 * 3600 * 1000;
const SWEEP_BATCH = 200;
const TERMINAL_BOOKING_STATES = new Set([
  'COMPLETE',
  'COMPLETED',
  'COMPLETED_AFTER_REASSIGNMENT',
  'TRIP_COMPLETED',
  'EARLY_ENDED_BY_RIDER',
  'EARLY_ENDED_REVIEW',
  'INTERRUPTED_OPERATIONAL_ENDED',
  'CANCELED',
  'CANCELLED',
  'TRIP_CANCELED',
  'TRIP_CANCELLED',
  'REJECTED'
]);
const CANCELED_BOOKING_STATES = new Set(['CANCELED', 'CANCELLED', 'TRIP_CANCELED', 'TRIP_CANCELLED', 'REJECTED']);
// Erros definitivos no cadastro: não adianta repetir sem corrigir o dado.
const PERMANENT_INSURE_CODES = new Set([
  'IZA_DRIVER_DATA_MISSING',
  'IZA_INVALID_CPF',
  'IZA_UNSUPPORTED_AGE',
  'IZA_NAME_INVALID'
]);

function backoffMs(attempts) {
  return RETRY_BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MS.length - 1)];
}

function maskDoc(doc) {
  const digits = String(doc || '');
  return digits.length >= 4 ? `***${digits.slice(-4)}` : null;
}

function brtDay(date) {
  return toIzaLocalDateTime(date).slice(0, 10);
}

function toMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '' && /^\d+$/.test(String(value).trim())) {
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function createIzaInsuranceService({
  client,
  redis,
  getFirestore = () => require('../../firebase-config').getFirestore?.() || null,
  loadIdentity = (firestore, driverId) => require('./iza-driver-identity').loadDriverIzaIdentity(firestore, driverId),
  userStore = require('../user-store'),
  config = readIzaConfig(),
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const enabled = () => config.enabled === true && isIzaConfigured(config);

  async function bump(field, by = 1) {
    try {
      const key = KEYS.stats(brtDay(now()));
      await redis.hincrby(key, field, by);
      await redis.expire(key, STATS_TTL_SECONDS);
    } catch (_) {
      // métrica não pode derrubar o fluxo
    }
  }

  // Guarda URL, payload e resposta de erros inesperados (a IZA pede 30 dias).
  async function recordError(error, context = {}) {
    const entry = {
      at: now().toISOString(),
      method: error?.method || null,
      path: error?.path || null,
      status: error?.status || null,
      code: error?.code || null,
      detail: String(error?.message || error).slice(0, 500),
      response: error?.body && typeof error.body === 'object' ? error.body : (error?.body ? String(error.body).slice(0, 500) : null),
      ...context
    };
    try {
      const key = KEYS.errors(brtDay(now()));
      await redis.lpush(key, JSON.stringify(entry));
      await redis.ltrim(key, 0, ERRORS_MAX - 1);
      await redis.expire(key, ERRORS_TTL_SECONDS);
    } catch (_) {
      // sem Redis, fica só o log estruturado
    }
    await bump('errors');
    await bump(`error:${entry.code || entry.status || 'unknown'}`);
    logStructured('warn', 'Erro na integração do seguro (IZA)', {
      service: 'iza-insurance',
      code: entry.code,
      status: entry.status,
      path: entry.path,
      bookingId: context.bookingId || null,
      driverId: context.driverId || null,
      doc: maskDoc(context.doc),
      error: entry.detail
    });
  }

  async function withLock(key, fn, { waitMs = LOCK_WAIT_MS } = {}) {
    const token = `${process.pid}:${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + waitMs;
    for (;;) {
      const acquired = await redis.set(key, token, 'EX', LOCK_TTL_SECONDS, 'NX');
      if (acquired) break;
      if (Date.now() >= deadline) return { locked: false };
      await sleep(250);
    }
    try {
      return { locked: true, value: await fn() };
    } finally {
      try {
        const current = await redis.get(key);
        if (current === token) await redis.del(key);
      } catch (_) {
        // o TTL libera
      }
    }
  }

  async function loadRecord(bookingId) {
    const raw = await redis.get(KEYS.record(bookingId));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  async function persistToFirestore(record) {
    try {
      const firestore = getFirestore();
      if (!firestore?.collection) return;
      const segments = [...(record.closedSegments || []), ...(record.segment ? [record.segment] : [])]
        .filter((segment) => segment.periodId || segment.failedCode)
        .map((segment) => ({
          seq: segment.seq,
          driverId: segment.driverId,
          periodId: segment.periodId || null,
          startedAt: segment.startedLocal,
          finishedAt: segment.finishedLocal || null,
          status: segment.status || 'open',
          failedCode: segment.failedCode || null
        }));
      await firestore.collection('insurance_periods').doc(record.bookingId).set({
        bookingId: record.bookingId,
        provider: 'iza',
        environment: config.environment,
        state: record.state,
        end: record.end || null,
        segments,
        updatedAt: now().toISOString()
      }, { merge: true });
    } catch (error) {
      logStructured('warn', 'Falha ao gravar período do seguro no Firestore', {
        service: 'iza-insurance',
        bookingId: record.bookingId,
        error: error?.message
      });
    }
  }

  async function saveRecord(record, { firestore = false } = {}) {
    record.updatedAt = now().toISOString();
    await redis.set(KEYS.record(record.bookingId), JSON.stringify(record), 'EX', RECORD_TTL_SECONDS);
    if (record.state === 'done') {
      await redis.zrem(KEYS.active, record.bookingId);
    } else {
      await redis.zadd(KEYS.active, String(nextCheckMs(record)), record.bookingId);
    }
    if (firestore) await persistToFirestore(record);
  }

  function nextCheckMs(record) {
    const nowMs = now().getTime();
    const candidates = [];
    const segment = record.segment;
    if (segment && !segment.periodId) candidates.push(segment.nextAttemptAt ? Date.parse(segment.nextAttemptAt) : nowMs);
    if (segment?.periodId) candidates.push(nowMs + GEO_INTERVAL_MS);
    for (const pending of record.pendingCloses || []) candidates.push(Date.parse(pending.nextAttemptAt) || nowMs);
    if (!candidates.length) candidates.push(nowMs + GEO_INTERVAL_MS);
    return Math.max(nowMs, Math.min(...candidates.filter(Number.isFinite)));
  }

  // ── Cadastro (pessoa + contrato) ─────────────────────────────────────────────
  async function ensureInsured(driverId, { force = false } = {}) {
    if (!force) {
      const cached = await redis.get(KEYS.insured(driverId)).catch(() => null);
      if (cached) return { doc: cached, cached: true };
    }
    const firestore = getFirestore();
    const identity = await loadIdentity(firestore, driverId);
    if (!identity?.ok) {
      const error = new Error(`Dados do motorista incompletos para o seguro: ${(identity?.missing || []).join(', ')}`);
      error.code = 'IZA_DRIVER_DATA_MISSING';
      error.missing = identity?.missing || [];
      throw error;
    }
    const person = await client.createPerson({ doc: identity.doc, name: identity.name, birthedAt: identity.birthDate });
    const contract = await client.createContract({ doc: identity.doc });
    await bump(person.created ? 'persons_registered' : 'persons_existing');
    await bump(contract.created ? 'contracts_created' : 'contracts_existing');
    await redis.set(KEYS.insured(driverId), identity.doc, 'EX', INSURED_CACHE_TTL_SECONDS);
    await redis.zrem(KEYS.insurePending, driverId);
    if (firestore) {
      await userStore.updateUser(firestore, driverId, {
        izaInsurance: {
          status: 'registered',
          environment: config.environment,
          registeredAt: now().toISOString(),
          personId: person.person?.id || null,
          contractId: contract.contractId || null,
          nameSource: identity.nameSource
        }
      }).catch((error) => logStructured('warn', 'Falha ao marcar o motorista como segurado', {
        service: 'iza-insurance',
        driverId,
        error: error?.message
      }));
    }
    logStructured('info', 'Motorista cadastrado no seguro (IZA)', {
      service: 'iza-insurance',
      driverId,
      doc: maskDoc(identity.doc),
      personCreated: person.created,
      contractCreated: contract.created
    });
    return { doc: identity.doc, cached: false };
  }

  async function markInsureFailure(driverId, error) {
    await recordError(error, { driverId, stage: 'register' });
    const firestore = getFirestore();
    const permanent = PERMANENT_INSURE_CODES.has(error?.code);
    if (firestore) {
      await userStore.updateUser(firestore, driverId, {
        izaInsurance: {
          status: permanent ? 'blocked' : 'pending',
          environment: config.environment,
          errorCode: error?.code || null,
          missing: error?.missing || null,
          updatedAt: now().toISOString()
        }
      }).catch(() => null);
    }
    if (permanent) {
      await redis.zrem(KEYS.insurePending, driverId);
      return;
    }
    const attemptsKey = `iza:insure:attempts:${driverId}`;
    const attempts = await redis.incr(attemptsKey);
    await redis.expire(attemptsKey, 7 * 24 * 3600);
    if (attempts > INSURE_MAX_ATTEMPTS) {
      await redis.zrem(KEYS.insurePending, driverId);
      return;
    }
    await redis.zadd(KEYS.insurePending, String(now().getTime() + backoffMs(attempts)), driverId);
  }

  // Na aprovação do cadastro: tenta já; se falhar, o ciclo repete.
  async function registerDriver(driverId) {
    if (!enabled() || !driverId) return { skipped: true };
    try {
      return await ensureInsured(driverId);
    } catch (error) {
      await markInsureFailure(driverId, error);
      return { ok: false, code: error?.code || null };
    }
  }

  // ── Períodos ─────────────────────────────────────────────────────────────────
  function newSegment(record, { driverId, startedAtMs }) {
    const seq = (record.closedSegments || []).length + 1;
    return {
      seq,
      driverId,
      doc: null,
      startedAt: new Date(startedAtMs).toISOString(),
      startedLocal: toIzaLocalDateTime(new Date(startedAtMs)),
      periodId: null,
      openedAt: null,
      attempts: 0,
      nextAttemptAt: null,
      lastGeoAt: null,
      status: 'opening'
    };
  }

  async function findExistingPeriod(doc, startedLocal) {
    const from = toIzaLocalDateTime(new Date(Date.parse(`${startedLocal}-03:00`) - 60 * 1000));
    const rows = await client.listPeriods({ doc, startedAt: from });
    return rows.find((row) => row.startedAt === startedLocal && row.status !== 'canceled') || null;
  }

  async function tryOpen(record, segment) {
    const nowMs = now().getTime();
    const startedMs = Date.parse(segment.startedAt);
    if (nowMs - startedMs > OPEN_TOLERANCE_MS && segment.attempts > 0) {
      segment.status = 'failed';
      segment.failedCode = 'IZA_OPEN_TOLERANCE_LOST';
      await bump('periods_open_failed');
      await recordError({ message: 'Período não abriu dentro dos 10 min aceitos pela IZA', code: 'IZA_OPEN_TOLERANCE_LOST' }, {
        bookingId: record.bookingId,
        driverId: segment.driverId
      });
      return;
    }
    segment.attempts += 1;
    try {
      const insured = await ensureInsured(segment.driverId);
      segment.doc = insured.doc;
      // Só numa nova tentativa: a IZA não barra período duplicado.
      if (segment.attempts > 1) {
        const existing = await findExistingPeriod(segment.doc, segment.startedLocal);
        if (existing) {
          segment.periodId = existing.id;
          segment.openedAt = now().toISOString();
          segment.status = 'open';
          await bump('periods_opened');
          return;
        }
      }
      let opened;
      try {
        opened = await client.openPeriod({ doc: segment.doc, startedAt: segment.startedLocal, timezone: IZA_TIMEZONE });
      } catch (error) {
        // Cadastro em cache mas sumiu do lado da IZA: cadastra de novo e tenta já.
        if (error?.code !== 'IZA_PERSON_NOT_REGISTERED') throw error;
        await redis.del(KEYS.insured(segment.driverId));
        segment.doc = (await ensureInsured(segment.driverId, { force: true })).doc;
        opened = await client.openPeriod({ doc: segment.doc, startedAt: segment.startedLocal, timezone: IZA_TIMEZONE });
      }
      segment.periodId = opened.periodId;
      segment.openedAt = now().toISOString();
      segment.status = 'open';
      await bump('periods_opened');
      logStructured('info', 'Período do seguro aberto (IZA)', {
        service: 'iza-insurance',
        bookingId: record.bookingId,
        driverId: segment.driverId,
        seq: segment.seq,
        periodId: segment.periodId
      });
    } catch (error) {
      await recordError(error, { bookingId: record.bookingId, driverId: segment.driverId, doc: segment.doc, stage: 'open' });
      const retryable = error?.retryable === true || error?.code === 'IZA_PERIOD_OVERLAP';
      const withinTolerance = now().getTime() - startedMs + backoffMs(segment.attempts) <= OPEN_TOLERANCE_MS;
      if (retryable && withinTolerance) {
        segment.nextAttemptAt = new Date(now().getTime() + Math.min(backoffMs(segment.attempts), 2 * 60 * 1000)).toISOString();
        return;
      }
      segment.status = 'failed';
      segment.failedCode = error?.code || 'IZA_PERIOD_OPEN_FAILED';
      await bump('periods_open_failed');
      if (error?.code === 'IZA_DRIVER_DATA_MISSING' || PERMANENT_INSURE_CODES.has(error?.code)) {
        await markInsureFailure(segment.driverId, error);
      }
    }
  }

  // Encerra ou cancela um período aberto. Falha temporária vai para pendingCloses.
  async function finishSegment(record, segment, { atMs, cancel = false }) {
    const nowMs = now().getTime();
    const openedMs = Date.parse(segment.openedAt || segment.startedAt);
    if (cancel && nowMs - openedMs <= CANCEL_WINDOW_MS) {
      try {
        const result = await client.cancelPeriod({ periodId: segment.periodId });
        if (result.canceled) {
          segment.status = 'canceled';
          segment.finishedLocal = null;
          await bump('periods_canceled');
          return true;
        }
      } catch (error) {
        await recordError(error, { bookingId: record.bookingId, driverId: segment.driverId, stage: 'cancel' });
        if (error?.code === 'IZA_PERIOD_NOT_FOUND') {
          segment.status = 'lost';
          return true;
        }
      }
      // Fora da janela (ou falhou): encerra, e o período é cobrado.
    }
    const finishMs = Math.max(atMs, Date.parse(segment.startedAt) + 1000);
    segment.finishedLocal = toIzaLocalDateTime(new Date(Math.min(finishMs, nowMs)));
    segment.status = 'closing';
    return attemptClose(record, { periodId: segment.periodId, finishedLocal: segment.finishedLocal, driverId: segment.driverId, attempts: 0 }, segment);
  }

  async function attemptClose(record, pending, segment = null) {
    pending.attempts = (pending.attempts || 0) + 1;
    try {
      const result = await client.closePeriod({ periodId: pending.periodId, finishedAt: pending.finishedLocal });
      if (segment) segment.status = result.alreadyFinal ? 'finished_by_iza' : 'finished';
      await bump(result.alreadyFinal ? 'periods_already_final' : 'periods_closed');
      return true;
    } catch (error) {
      await recordError(error, { bookingId: record.bookingId, driverId: pending.driverId, stage: 'close' });
      if (error?.code === 'IZA_PERIOD_NOT_FOUND') {
        if (segment) segment.status = 'lost';
        return true;
      }
      if (error?.code === 'IZA_FINISH_BEFORE_START') {
        if (segment) segment.status = 'finished_by_iza';
        return true;
      }
      const tooOld = now().getTime() - (Date.parse(`${pending.finishedLocal}-03:00`) || 0) > CLOSE_MAX_AGE_MS;
      if (tooOld) {
        if (segment) segment.status = 'close_failed';
        await bump('periods_close_failed');
        return true;
      }
      pending.nextAttemptAt = new Date(now().getTime() + backoffMs(pending.attempts)).toISOString();
      record.pendingCloses = [...(record.pendingCloses || []).filter((item) => item.periodId !== pending.periodId), pending];
      if (segment) segment.status = 'closing';
      return false;
    }
  }

  function archiveSegment(record) {
    if (!record.segment) return;
    record.closedSegments = [...(record.closedSegments || []), record.segment];
    record.segment = null;
  }

  async function readBooking(bookingId) {
    try {
      const booking = await redis.hgetall(`booking:${bookingId}`);
      return booking && Object.keys(booking).length ? booking : null;
    } catch (_) {
      return null;
    }
  }

  async function sendGeo(record) {
    const segment = record.segment;
    if (!segment?.periodId || !segment.doc) return;
    const nowMs = now().getTime();
    if (segment.lastGeoAt && nowMs - Date.parse(segment.lastGeoAt) < GEO_INTERVAL_MS - 5000) return;
    try {
      const driver = await redis.hgetall(`driver:${segment.driverId}`);
      const lat = Number(driver?.lat);
      const lng = Number(driver?.lng);
      const seenMs = toMs(driver?.lastUpdate || driver?.timestamp) || toMs(driver?.lastSeen);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;
      if (!seenMs || nowMs - seenMs > GEO_MAX_AGE_MS) return;
      await client.sendGeolocation({ doc: segment.doc, datetime: toIzaLocalDateTime(new Date(Math.min(seenMs, nowMs))), lat, lng });
      segment.lastGeoAt = new Date(nowMs).toISOString();
      await bump('geolocation_sent');
    } catch (error) {
      segment.lastGeoAt = new Date(nowMs).toISOString();
      await bump('geolocation_failed');
      if (error?.status && error.status < 500) await recordError(error, { bookingId: record.bookingId, driverId: segment.driverId, stage: 'geolocation' });
    }
  }

  // Avança o registro de uma corrida. Retorna true se algo mudou no Firestore.
  async function advance(record) {
    let changed = false;
    const nowMs = now().getTime();

    for (const pending of [...(record.pendingCloses || [])]) {
      if (Date.parse(pending.nextAttemptAt) > nowMs) continue;
      const done = await attemptClose(record, pending);
      if (done) {
        record.pendingCloses = (record.pendingCloses || []).filter((item) => item.periodId !== pending.periodId);
        const segment = (record.closedSegments || []).find((item) => item.periodId === pending.periodId);
        if (segment && segment.status === 'closing') segment.status = 'finished';
        changed = true;
      }
    }

    let segment = record.segment;
    if (segment && !segment.periodId && segment.status === 'opening') {
      if (record.end?.kind === 'canceled') {
        // Cancelada antes de abrir: nenhum período.
        segment.status = 'skipped';
        archiveSegment(record);
        changed = true;
      } else if (!segment.nextAttemptAt || Date.parse(segment.nextAttemptAt) <= nowMs) {
        await tryOpen(record, segment);
        changed = true;
      }
    }
    segment = record.segment;
    if (segment && segment.status === 'failed') {
      archiveSegment(record);
      changed = true;
    }

    segment = record.segment;
    if (segment?.periodId && segment.status === 'open') {
      if (!record.end) {
        const booking = await readBooking(record.bookingId);
        const status = String(booking?.status || '').toUpperCase();
        if (!booking || TERMINAL_BOOKING_STATES.has(status)) {
          const endedMs = toMs(booking?.completedAt) || toMs(booking?.endedAt) || toMs(booking?.cancelledAt) || toMs(booking?.canceledAt) || nowMs;
          record.end = { kind: CANCELED_BOOKING_STATES.has(status) ? 'canceled' : 'completed', at: new Date(endedMs).toISOString(), inferred: true };
        }
      }
      if (record.end) {
        await finishSegment(record, segment, { atMs: Date.parse(record.end.at), cancel: record.end.kind === 'canceled' });
        archiveSegment(record);
        changed = true;
      } else if (nowMs - Date.parse(segment.startedAt) >= ROTATE_AFTER_MS) {
        // Corrida acima de 2 h: encerra este período e abre o próximo em seguida.
        await finishSegment(record, segment, { atMs: nowMs });
        const driverId = segment.driverId;
        archiveSegment(record);
        record.segment = newSegment(record, { driverId, startedAtMs: nowMs + 1000 });
        await bump('periods_rotated');
        await tryOpen(record, record.segment);
        changed = true;
      } else {
        await sendGeo(record);
      }
    }

    if (record.segment) {
      record.state = record.segment.periodId ? 'open' : 'opening';
      return changed;
    }
    if (!record.end) {
      // Sem período ativo (a abertura falhou): fecha o registro quando a corrida acabar.
      const booking = await readBooking(record.bookingId);
      const status = String(booking?.status || '').toUpperCase();
      if (!booking || TERMINAL_BOOKING_STATES.has(status)) {
        record.end = { kind: CANCELED_BOOKING_STATES.has(status) ? 'canceled' : 'completed', at: new Date(nowMs).toISOString(), inferred: true };
        changed = true;
      }
    }
    if (record.end && !(record.pendingCloses || []).length && record.state !== 'done') {
      record.state = 'done';
      changed = true;
    }
    return changed;
  }

  async function processBooking(bookingId, mutate = null, { waitMs = LOCK_WAIT_MS } = {}) {
    const outcome = await withLock(KEYS.lock(bookingId), async () => {
      const record = (await loadRecord(bookingId)) || null;
      const next = mutate ? await mutate(record) : record;
      if (!next) return null;
      const changed = await advance(next);
      await saveRecord(next, { firestore: changed || Boolean(mutate) });
      return next;
    }, { waitMs });
    return outcome;
  }

  function isSandboxBooking(booking) {
    if (!booking) return false;
    return String(booking.testUserSandbox || '').toLowerCase() === 'true'
      || String(booking.paymentProviderEnvironment || booking.providerEnvironment || '').toLowerCase() === 'sandbox';
  }

  async function deferEvent(event) {
    await redis.rpush(KEYS.deferred, JSON.stringify(event));
    await redis.expire(KEYS.deferred, 24 * 3600);
  }

  // Corrida começou (ou o motorista substituto iniciou o trecho dele).
  async function handleRideStarted({ bookingId, driverId, startedAt = null } = {}) {
    if (!enabled() || !bookingId || !driverId) return { skipped: true };
    const booking = await readBooking(bookingId);
    // Em produção, corrida de teste/sandbox não gera período cobrado.
    if (config.environment === 'prod' && isSandboxBooking(booking)) return { skipped: true, reason: 'sandbox' };
    const startedAtMs = toMs(startedAt) || toMs(booking?.startedAt) || now().getTime();

    const outcome = await processBooking(bookingId, async (record) => {
      const current = record || {
        bookingId,
        state: 'opening',
        segment: null,
        closedSegments: [],
        pendingCloses: [],
        end: null,
        createdAt: now().toISOString()
      };
      // Evento repetido do mesmo motorista: o trecho dele já existe (aberto, ou já
      // tentado e arquivado enquanto a corrida segue).
      if (current.segment?.driverId === driverId) return current;
      if (!current.segment && !current.end && current.closedSegments?.some((segment) => segment.driverId === driverId)) {
        return current;
      }
      if (current.segment) {
        // Troca de motorista no meio da corrida: encerra o período do anterior.
        const previous = current.segment;
        if (previous.periodId && previous.status === 'open') {
          await finishSegment(current, previous, { atMs: Math.max(startedAtMs - 1000, Date.parse(previous.startedAt) + 1000) });
        } else if (!previous.periodId) {
          previous.status = 'skipped';
        }
        archiveSegment(current);
      }
      current.end = null;
      current.segment = newSegment(current, { driverId, startedAtMs });
      current.state = 'opening';
      return current;
    });
    if (!outcome.locked) {
      await deferEvent({ type: 'started', bookingId, driverId, startedAt: new Date(startedAtMs).toISOString() });
      return { deferred: true };
    }
    return { ok: true };
  }

  async function handleRideEnded({ bookingId, kind = 'completed', endedAt = null } = {}) {
    if (!enabled() || !bookingId) return { skipped: true };
    const endedAtMs = toMs(endedAt) || now().getTime();
    const exists = await redis.exists(KEYS.record(bookingId));
    if (!exists) return { skipped: true, reason: 'no_period' };
    const outcome = await processBooking(bookingId, async (record) => {
      if (!record || record.state === 'done') return null;
      if (!record.end) record.end = { kind, at: new Date(endedAtMs).toISOString(), inferred: false };
      return record;
    });
    if (!outcome.locked) {
      await deferEvent({ type: 'ended', bookingId, kind, endedAt: new Date(endedAtMs).toISOString() });
      return { deferred: true };
    }
    return { ok: true };
  }

  // Ciclo de 1 min (um líder por vez).
  async function sweep() {
    if (!enabled()) return { skipped: true };
    const lock = await redis.set(KEYS.sweepLock, String(process.pid), 'EX', 55, 'NX');
    if (!lock) return { skipped: true, reason: 'not_leader' };
    const summary = { deferred: 0, bookings: 0, insured: 0 };
    try {
      for (let i = 0; i < 100; i += 1) {
        const raw = await redis.lpop(KEYS.deferred);
        if (!raw) break;
        let event = null;
        try {
          event = JSON.parse(raw);
        } catch (_) {
          continue;
        }
        summary.deferred += 1;
        const result = event.type === 'started'
          ? await handleRideStarted(event)
          : await handleRideEnded(event);
        if (result?.deferred) break; // ainda ocupado; tenta no próximo ciclo
      }

      const due = await redis.zrangebyscore(KEYS.active, '-inf', String(now().getTime()), 'LIMIT', 0, SWEEP_BATCH);
      for (const bookingId of due) {
        summary.bookings += 1;
        const exists = await redis.exists(KEYS.record(bookingId));
        if (!exists) {
          await redis.zrem(KEYS.active, bookingId);
          continue;
        }
        await processBooking(bookingId, null, { waitMs: 0 }).catch((error) => logStructured('warn', 'Falha no ciclo do seguro', {
          service: 'iza-insurance',
          bookingId,
          error: error?.message
        }));
      }

      const pendingDrivers = await redis.zrangebyscore(KEYS.insurePending, '-inf', String(now().getTime()), 'LIMIT', 0, 20);
      for (const driverId of pendingDrivers) {
        summary.insured += 1;
        await registerDriver(driverId);
      }
    } catch (error) {
      logStructured('warn', 'Falha no ciclo do seguro', { service: 'iza-insurance', error: error?.message });
    }
    // O lock do ciclo expira sozinho: evita dois líderes no mesmo minuto.
    return summary;
  }

  async function readDailyStats(day) {
    const [stats, errors] = await Promise.all([
      redis.hgetall(KEYS.stats(day)),
      redis.lrange(KEYS.errors(day), 0, 199)
    ]);
    return {
      day,
      stats: stats || {},
      errors: (errors || []).map((raw) => {
        try {
          return JSON.parse(raw);
        } catch (_) {
          return { raw };
        }
      })
    };
  }

  return {
    KEYS,
    enabled,
    ensureInsured,
    registerDriver,
    handleRideStarted,
    handleRideEnded,
    sweep,
    readDailyStats,
    loadRecord,
    // exposto para teste
    _advance: advance
  };
}

let defaultService = null;
function getDefaultIzaInsuranceService() {
  if (!defaultService) {
    const { createIzaClient } = require('./iza-client');
    const redisPool = require('../../utils/redis-pool');
    defaultService = createIzaInsuranceService({
      client: createIzaClient(),
      redis: redisPool.getConnection()
    });
  }
  return defaultService;
}

module.exports = {
  CANCEL_WINDOW_MS,
  KEYS,
  OPEN_TOLERANCE_MS,
  ROTATE_AFTER_MS,
  createIzaInsuranceService,
  getDefaultIzaInsuranceService
};
