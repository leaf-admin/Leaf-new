'use strict';

// Link público de acompanhamento da viagem.
//
// O passageiro gera um link com token aleatório (não o id da corrida) e manda para quem quiser,
// pelo próprio WhatsApp. Quem abre vê só o necessário para reconhecer o carro e acompanhar:
// primeiro nome do motorista, carro, placa, situação, destino e a última posição do carro.
// Nunca o embarque (pode ser a casa do passageiro), telefone, preço ou ids.
//
// O link vale no máximo 6 h. Depois que a corrida termina, mostra só "viagem encerrada".

const crypto = require('crypto');

const SHARE_TTL_SECONDS = 6 * 3600;
const LOCATION_MAX_AGE_MS = 2 * 60 * 1000;
const DEFAULT_BASE_URL = 'https://leaf.app.br/viagem';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

const shareKey = (token) => `trip_share:${token}`;
const bookingShareKey = (bookingId) => `trip_share_booking:${bookingId}`;

const STATUS_VIEW = Object.freeze({
  REQUESTED: 'searching',
  PENDING: 'searching',
  SEARCHING: 'searching',
  SEARCHING_REPLACEMENT: 'searching',
  ACCEPTED: 'driver_on_the_way',
  DRIVER_ACCEPTED: 'driver_on_the_way',
  ARRIVED: 'driver_arrived',
  DRIVER_ARRIVED: 'driver_arrived',
  STARTED: 'in_progress',
  IN_PROGRESS: 'in_progress',
  OPERATIONAL_INTERRUPTED: 'in_progress',
  COMPLETED: 'completed',
  CANCELED: 'cancelled',
  CANCELLED: 'cancelled',
  REJECTED: 'cancelled',
  EXPIRED: 'cancelled'
});

const ENDED_VIEWS = new Set(['completed', 'cancelled']);
const LIVE_LOCATION_VIEWS = new Set(['driver_on_the_way', 'driver_arrived', 'in_progress']);

function baseUrl(env = process.env) {
  return String(env.PUBLIC_TRIP_SHARE_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function parseJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function firstName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first ? first.slice(0, 40) : null;
}

function resolveStatusView(booking = {}) {
  const status = String(booking.status || '').trim().toUpperCase();
  return STATUS_VIEW[status] || 'searching';
}

/**
 * Cria (ou reaproveita) o link da corrida. Só o passageiro da corrida, e só antes de ela acabar.
 */
async function createShareLink(redis, { bookingId, customerId, now = Date.now(), env = process.env } = {}) {
  const normalizedBookingId = String(bookingId || '').trim();
  const normalizedCustomerId = String(customerId || '').trim();
  if (!redis || !normalizedBookingId || !normalizedCustomerId) return { ok: false, code: 'INVALID_REQUEST' };

  const booking = (await redis.hgetall(`booking:${normalizedBookingId}`)) || {};
  if (!booking.customerId || String(booking.customerId) !== normalizedCustomerId) {
    return { ok: false, code: 'BOOKING_NOT_FOUND' };
  }
  if (ENDED_VIEWS.has(resolveStatusView(booking))) {
    return { ok: false, code: 'BOOKING_ENDED' };
  }

  let token = await redis.get(bookingShareKey(normalizedBookingId));
  if (!token || !(await redis.exists(shareKey(token)))) {
    token = crypto.randomBytes(18).toString('base64url');
    await redis.hset(shareKey(token), {
      bookingId: normalizedBookingId,
      customerId: normalizedCustomerId,
      createdAt: String(now)
    });
    await redis.expire(shareKey(token), SHARE_TTL_SECONDS);
    await redis.set(bookingShareKey(normalizedBookingId), token, 'EX', SHARE_TTL_SECONDS);
  }

  return { ok: true, token, url: `${baseUrl(env)}/${token}` };
}

/** O que a página pública mostra. null quando o link não existe ou expirou. */
async function getPublicView(redis, token, { now = Date.now() } = {}) {
  const normalizedToken = String(token || '').trim();
  if (!redis || !TOKEN_PATTERN.test(normalizedToken)) return null;

  const share = (await redis.hgetall(shareKey(normalizedToken))) || {};
  if (!share.bookingId) return null;

  const booking = (await redis.hgetall(`booking:${share.bookingId}`)) || {};
  const status = resolveStatusView(booking);
  if (ENDED_VIEWS.has(status) || Object.keys(booking).length === 0) {
    return { status: Object.keys(booking).length === 0 ? 'completed' : status, updatedAt: new Date(now).toISOString() };
  }

  const destination = parseJson(booking.destinationLocation);
  const view = {
    status,
    driver: firstName(booking.driverName) ? { firstName: firstName(booking.driverName) } : null,
    vehicle: booking.vehiclePlate || booking.vehicleModel
      ? {
        model: [booking.vehicleMake, booking.vehicleModel].filter(Boolean).join(' ').slice(0, 60) || null,
        color: booking.vehicleColor ? String(booking.vehicleColor).slice(0, 30) : null,
        plate: booking.vehiclePlate ? String(booking.vehiclePlate).slice(0, 10).toUpperCase() : null
      }
      : null,
    destination: destination?.add || destination?.address
      ? { address: String(destination.add || destination.address).slice(0, 160) }
      : null,
    location: null,
    updatedAt: new Date(now).toISOString()
  };

  if (LIVE_LOCATION_VIEWS.has(status) && booking.driverId) {
    const driver = (await redis.hgetall(`driver:${booking.driverId}`)) || {};
    const lat = Number(driver.lat);
    const lng = Number(driver.lng);
    const at = Number(driver.lastUpdate || driver.timestamp);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(at) && now - at <= LOCATION_MAX_AGE_MS) {
      view.location = {
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        at: new Date(at).toISOString()
      };
    }
  }

  return view;
}

module.exports = {
  SHARE_TTL_SECONDS,
  createShareLink,
  getPublicView,
  helpers: { shareKey, bookingShareKey, resolveStatusView, firstName, TOKEN_PATTERN }
};
