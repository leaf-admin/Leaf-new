'use strict';
const { createHash } = require('node:crypto');
const { resolveRideRevenue, resolveRideOperationalFee, resolveRideDriverNetAmount, isRideRevenuePendingFinalSnapshot } = require('./dashboard-ride-monitoring-service');
const hash = value => createHash('sha256').update(value).digest('hex');
const TIME_ZONE = 'America/Sao_Paulo';
const SHARDS = 16;
const COMPLETED = new Set(['COMPLETE', 'COMPLETED', 'PAID', 'completed']);
const CANCELLED = new Set(['CANCELLED', 'CANCELED', 'cancelled', 'canceled']);

function timestamp(value) {
  if (value?.toDate) return value.toDate().getTime();
  if (value && typeof value === 'object' && Number.isFinite(value._seconds)) return value._seconds * 1000;
  if (typeof value === 'number') return value > 10000000000 ? value : value * 1000;
  return value ? new Date(value).getTime() : NaN;
}

function dayKey(value) {
  const date = new Date(timestamp(value));
  if (!Number.isFinite(date.getTime())) throw new Error('Projection requires canonical timestamp');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function contribution(sourcePath, data) {
  const collection = sourcePath.split('/')[0];
  const namespace = collection.startsWith('sandbox_') ? 'sandbox' : 'operational';
  if (data.financialNamespace && data.financialNamespace !== namespace) throw new Error('Projection namespace conflict');
  const contextId = namespace === 'sandbox' ? data.financialContextId || data.financialContext?.contextId : null;
  if (namespace === 'sandbox' && !contextId) throw new Error('Sandbox projection requires sealed context');
  const scope = namespace === 'operational' ? namespace : `sandbox-${hash(String(contextId))}`;
  const kind = collection.replace(/^sandbox_/, '') === 'payment_distributions' ? 'distribution'
    : collection.replace(/^sandbox_/, '') === 'audit_logs' ? 'audit' : 'ride';
  const metrics = {};
  let driver = null;
  if (kind === 'ride') {
    const complete = COMPLETED.has(data.status);
    const reconciled = complete && !isRideRevenuePendingFinalSnapshot(data);
    Object.assign(metrics, { requests: 1, completed: Number(complete), reconciled: Number(reconciled),
      accepted: Number(Boolean(data.driverId)), cancelledAccepted: Number(CANCELLED.has(data.status) && Boolean(data.driverId)),
      revenueUnits: complete ? Math.round(resolveRideRevenue(data) * 1000000) : 0,
      feeUnits: complete ? Math.round(resolveRideOperationalFee(data) * 1000000) : 0 });
    const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { return null; } };
    const first = (...values) => values.map(timestamp).find(Number.isFinite);
    const request = first(data.createdAt, data.tripdate, data.timestamp, data.activatedAt);
    const accepted = first(data.acceptedAt, data.driverAcceptedAt, data.matchedAt);
    const arrived = first(data.driverArrivedAt, data.arrivedAt, data.pickupArrivedAt);
    const paid = first(data.paymentConfirmedAt, data.paymentApprovedAt, data.confirmedAt,
      parse(data.paymentData)?.confirmedAt, parse(data.payment)?.confirmedAt);
    for (const [label, start, end] of [['wait', request, accepted], ['pickup', accepted, arrived], ['paidPickup', paid, arrived]]) {
      metrics[`${label}Count`] = Number(Number.isFinite(start) && Number.isFinite(end) && end >= start);
      metrics[`${label}Ms`] = metrics[`${label}Count`] ? end - start : 0;
    }
    if (complete && typeof data.driverId === 'string' && data.driverId) {
      driver = { id: data.driverId, completedTrips: 1, pendingFinancialTrips: Number(!reconciled),
        driverNetMinor: reconciled ? Math.round(resolveRideDriverNetAmount(data) * 100) : 0 };
    }
  } else if (kind === 'distribution') {
    const retained = Number.parseFloat(data.retainedFees?.operationalFee) / 100;
    const calculated = Number.parseFloat(data.calculation?.operationalFee) / 100;
    Object.assign(metrics, { distributions: 1, feeUnits: Math.round(((Number.isFinite(retained) && retained) || (Number.isFinite(calculated) ? calculated : 0)) * 1000000) });
  } else {
    Object.assign(metrics, { logs: 1, successes: Number(Boolean(data.success)) });
    for (const field of ['severity', 'action', 'resource']) {
      const value = String(data[field]);
      if (value.length > 256) throw new Error('Audit dimension exceeds projection budget');
      metrics[`${field}:${Buffer.from(value).toString('base64url')}`] = 1;
    }
  }
  if (!Object.values(metrics).every(Number.isSafeInteger)) throw new Error('Projection numeric budget exceeded');
  const day = dayKey(kind === 'audit' ? data.timestamp : data.createdAt);
  return { schema: 1, kind, namespace, scope, day, shard: Number.parseInt(hash(sourcePath).slice(0, 2), 16) % SHARDS, metrics, driver };
}

function bucketId(vector) { return `${vector.scope}_${vector.kind}_${vector.day}_${vector.shard}`; }
function mergeMetrics(base = {}, delta = {}, sign = 1) {
  const result = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    result[key] = (result[key] || 0) + sign * value;
    if (!Number.isSafeInteger(result[key]) || result[key] < 0) throw new Error('Projection parity violation');
    if (result[key] === 0) delete result[key];
  }
  if (Object.keys(result).length > 512 || Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) throw new Error('Projection dimension budget exceeded');
  return result;
}

function calendarWindow(period = 'today', startDate, endDate) {
  const today = dayKey(new Date());
  const dateDay = value => {
    let day;
    try { day = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : dayKey(value); }
    catch (_) { throw Object.assign(new Error('Data inválida'), { statusCode: 400 }); }
    if (!Number.isFinite(Date.parse(`${day}T12:00:00Z`)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) {
      throw Object.assign(new Error('Data inválida'), { statusCode: 400 });
    }
    return day;
  };
  let first = today; let last = today;
  if (period === 'custom') {
    if (!startDate || !endDate) throw Object.assign(new Error('Informe início e fim'), { statusCode: 400 });
    first = dateDay(startDate); last = dateDay(endDate);
  } else if (period === 'month') first = `${today.slice(0, 7)}-01`;
  else if (['week', '7d', '30d'].includes(period)) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (period === '30d' ? 30 : 7));
    first = date.toISOString().slice(0, 10);
  } else if (period !== 'today') throw Object.assign(new Error('Período inválido'), { statusCode: 400 });
  // Reporting uses complete São Paulo calendar days. Resolve the UTC offset
  // through Intl rather than inheriting the host timezone or assuming UTC-3.
  const midnight = day => {
    const target = Date.parse(`${day}T00:00:00Z`);
    let guess = target;
    for (let i = 0; i < 4; i++) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(guess).map(part => [part.type, part.value]));
      const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
      if (local === target) return new Date(guess);
      guess += target - local;
    }
    throw Object.assign(new Error('Limite de dia indisponível para esta data'), { statusCode: 400 });
  };
  const next = new Date(`${last}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const start = midnight(first); const end = new Date(midnight(next.toISOString().slice(0, 10)).getTime() - 1);
  if (!Number.isFinite(start.getTime()) || start > end || Date.parse(`${last}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`) > 30 * 86400000) throw Object.assign(new Error('Use até31 dias'), { statusCode: 400 });
  return { start, end };
}

module.exports = { contribution, bucketId, mergeMetrics, hash, timestamp, dayKey, calendarWindow, TIME_ZONE, SHARDS };
