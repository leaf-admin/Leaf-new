'use strict';

// Value conversion for the native Firestore repositories (driver documents,
// users, vehicles, ride annotations, subscriptions). Records keep the shape the
// app and the API have always used:
// - toView/docView: Firestore value -> plain JSON (Timestamps as ISO strings,
//   GeoPoints as { latitude, longitude }, nulls and empty objects dropped).
// - fromView: plain JSON -> Firestore value, keeping an existing Timestamp a
//   Timestamp and encoding arrays inside arrays (which Firestore rejects).
// - normalize/getIn/setIn: null-free record helpers.
// Moved from rtdb-root-router when the RTDB router was deleted; the encoded
// field names (rtdbNestedArray, rtdbValue) stay because stored data uses them.
const { Timestamp } = require('@google-cloud/firestore');

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

const NESTED_ARRAY_FIELD = 'rtdbNestedArray';

// Firestore value -> the JSON shape RTDB consumers expect.
function toView(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp || (typeof value?.toDate === 'function' && typeof value?.toMillis === 'function')) {
    return value.toDate().toISOString();
  }
  if (typeof value?.latitude === 'number' && typeof value?.longitude === 'number' && typeof value?.isEqual === 'function') {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (typeof value?.path === 'string' && value?.firestore) return value.path;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(toView);
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === NESTED_ARRAY_FIELD && Array.isArray(value[NESTED_ARRAY_FIELD])) {
      return value[NESTED_ARRAY_FIELD].map(toView);
    }
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = toView(child);
    return result;
  }
  return value;
}

// RTDB-shaped value -> Firestore value, keeping existing Timestamps as Timestamps.
function fromView(value, current) {
  if (value === null || value === undefined) return null;
  const isTimestamp = current instanceof Timestamp || (typeof current?.toDate === 'function' && typeof current?.toMillis === 'function');
  if (isTimestamp && (typeof value === 'string' || typeof value === 'number')) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date);
  }
  if (Array.isArray(value)) {
    // Firestore rejects arrays inside arrays: an inner array becomes a map
    // { rtdbNestedArray: [...] } and is decoded back by toView.
    return value.map((item, index) => {
      const previous = Array.isArray(current) ? current[index] : undefined;
      return Array.isArray(item)
        ? { [NESTED_ARRAY_FIELD]: fromView(item, previous?.[NESTED_ARRAY_FIELD]) }
        : fromView(item, previous);
    });
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (/^__.*__$/.test(key)) throw fail('NATIVE_RECORD_INVALID_KEY', `Campo reservado no Firestore: ${key}`);
      result[key] = fromView(child, current && typeof current === 'object' ? current[key] : undefined);
    }
    return result;
  }
  return value;
}

const PRIMITIVE_FIELD = 'rtdbValue';
const docView = data => {
  if (!data) return null;
  const keys = Object.keys(data);
  if (keys.length === 1 && keys[0] === PRIMITIVE_FIELD) return toView(data[PRIMITIVE_FIELD]);
  return normalize(toView(data));
};

// RTDB normalization: null/undefined and empty objects do not exist.
function normalize(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const items = value.map(normalize);
    return items.every(item => item === null) ? null : items;
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = normalize(child);
      if (normalized !== null) result[key] = normalized;
    }
    return Object.keys(result).length ? result : null;
  }
  return value;
}

function clone(value) {
  return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function getIn(value, segments) {
  let current = value;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return null;
    current = current[segment];
  }
  return current === undefined ? null : current;
}

function setIn(value, segments, next) {
  if (!segments.length) return normalize(clone(next));
  const [head, ...rest] = segments;
  const base = value && typeof value === 'object' && !Array.isArray(value) ? { ...value }
    : Array.isArray(value) ? Object.assign({}, value) : {};
  base[head] = setIn(base[head] ?? null, rest, next);
  return normalize(base);
}

module.exports = { toView, fromView, docView, normalize, getIn, setIn, clone, NESTED_ARRAY_FIELD, PRIMITIVE_FIELD };
