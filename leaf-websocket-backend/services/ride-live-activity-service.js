const http2 = require('http2');
const jwt = require('jsonwebtoken');
const { logger, logStructured } = require('../utils/logger');

const TOKEN_TTL_SECONDS = 24 * 60 * 60;
const APNS_TIMEOUT_MS = 10000;
const DEFAULT_BUNDLE_ID = 'br.com.leaf.ride';
const TERMINAL_STATUSES = new Set([
  'completed',
  'complete',
  'cancelled',
  'canceled',
  'no_drivers',
  'no_drivers_available',
  'rejected',
  'expired'
]);

const STATUS_PROGRESS = {
  searching: 0.12,
  accepted: 0.35,
  arrived: 0.52,
  started: 0.76,
  completed: 1,
  complete: 1,
  cancelled: 1,
  canceled: 1
};

const normalizeStatus = (value) =>
  String(value || '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

const normalizeRole = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'driver' ? 'driver' : 'passenger';
};

const formatEta = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return `${Math.round(numeric)} min`;
};

const formatDistance = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return `${numeric.toFixed(numeric >= 10 ? 0 : 1).replace('.', ',')} km`;
};

class RideLiveActivityService {
  constructor(redis = null) {
    this.redis = redis;
    this.jwtCache = null;
  }

  setRedis(redis) {
    this.redis = redis;
  }

  getRedisClient() {
    return this.redis;
  }

  isApnsConfigured() {
    return Boolean(
      process.env.LEAF_APNS_KEY_ID &&
      process.env.LEAF_APNS_TEAM_ID &&
      (process.env.LEAF_APNS_PRIVATE_KEY || process.env.LEAF_APNS_PRIVATE_KEY_PATH)
    );
  }

  async saveToken(userId, userType, tokenData = {}) {
    const redis = this.getRedisClient();
    if (!redis) {
      return { success: false, error: 'Redis indisponível' };
    }

    const pushToken = String(tokenData.pushToken || '').trim();
    const bookingId = String(tokenData.bookingId || tokenData.rideId || '').trim();
    const role = normalizeRole(tokenData.role || userType);
    const activityId = String(tokenData.activityId || `ride:${role}:${bookingId}`).trim();

    if (!pushToken || !bookingId || !activityId) {
      return { success: false, error: 'Token, bookingId e activityId são obrigatórios' };
    }

    const payload = {
      activityId,
      bookingId,
      rideId: String(tokenData.rideId || bookingId),
      userId: String(userId || ''),
      userType: String(userType || role),
      role,
      platform: String(tokenData.platform || 'ios'),
      pushToken,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await redis.hset(`ride_live_activity_tokens:${bookingId}`, activityId, JSON.stringify(payload));
    await redis.sadd(`ride_live_activity_user:${userId}`, activityId);
    if (typeof redis.expire === 'function') {
      await redis.expire(`ride_live_activity_tokens:${bookingId}`, TOKEN_TTL_SECONDS);
      await redis.expire(`ride_live_activity_user:${userId}`, TOKEN_TTL_SECONDS);
    }

    logStructured('info', 'Token Live Activity salvo', {
      service: 'ride-live-activity',
      userId,
      bookingId,
      activityId,
      role
    });

    return { success: true, activityId, bookingId };
  }

  async resolveTokens(userId, rideData = {}) {
    const redis = this.getRedisClient();
    if (!redis) return [];

    const bookingId = String(rideData.bookingId || rideData.rideId || '').trim();
    if (!bookingId) return [];

    const entries = await redis.hgetall(`ride_live_activity_tokens:${bookingId}`);
    return Object.values(entries || {})
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch (_error) {
          return null;
        }
      })
      .filter((entry) => entry && String(entry.userId) === String(userId) && entry.pushToken);
  }

  buildContentState(rideData = {}) {
    const status = normalizeStatus(rideData.status);
    const etaText = rideData.etaText || formatEta(rideData.estimatedTime || rideData.etaMinutes);
    const distanceText = rideData.distanceText || formatDistance(rideData.distance || rideData.distanceKm);
    const fareLabel = String(rideData.fareLabel || rideData.fare || '').trim();
    const role = normalizeRole(rideData.userType || rideData.role);
    const title = this.buildTitle(status, role, etaText);

    return {
      title,
      subtitle: String(rideData.driverName || rideData.customerName || '').trim(),
      body: this.buildBody(status, role, rideData),
      phase: status || 'accepted',
      etaText,
      distanceText,
      fareLabel,
      progress: STATUS_PROGRESS[status] ?? 0.25,
      updatedAt: new Date().toISOString()
    };
  }

  buildTitle(status, role, etaText) {
    if (status === 'arrived') return role === 'driver' ? 'Aguardando embarque' : 'Motorista chegou';
    if (status === 'started') return 'Viagem em andamento';
    if (status === 'accepted') return etaText || (role === 'driver' ? 'Vá até o embarque' : 'Motorista a caminho');
    if (status === 'searching') return 'Buscando motorista';
    return 'Corrida ativa';
  }

  buildBody(status, role, rideData = {}) {
    if (status === 'accepted') {
      return role === 'driver'
        ? `Embarque: ${rideData.pickup?.address || rideData.pickupAddress || 'local de partida'}`
        : 'Acompanhe a chegada pelo app.';
    }
    if (status === 'arrived') {
      return role === 'driver'
        ? 'Inicie a viagem após o passageiro embarcar.'
        : 'Dirija-se ao local de embarque.';
    }
    if (status === 'started') {
      return `A caminho de ${rideData.destination?.address || rideData.destinationAddress || 'destino'}.`;
    }
    return 'Acompanhe a corrida pela Leaf.';
  }

  buildApnsPayload(rideData = {}) {
    const status = normalizeStatus(rideData.status);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const terminal = TERMINAL_STATUSES.has(status);
    const aps = {
      timestamp: nowSeconds,
      event: terminal ? 'end' : 'update',
      'content-state': this.buildContentState(rideData),
      'stale-date': nowSeconds + 10 * 60
    };

    if (terminal) {
      aps['dismissal-date'] = nowSeconds + 60;
    }

    return { aps };
  }

  async sendRideStatusUpdate(userId, rideData = {}) {
    const tokens = await this.resolveTokens(userId, rideData);
    if (tokens.length === 0) {
      return { success: false, skipped: true, reason: 'NO_LIVE_ACTIVITY_TOKEN', count: 0 };
    }

    if (!this.isApnsConfigured()) {
      return { success: false, skipped: true, reason: 'APNS_NOT_CONFIGURED', count: 0 };
    }

    const payload = this.buildApnsPayload(rideData);
    let successCount = 0;
    for (const tokenData of tokens) {
      try {
        await this.sendApnsUpdate(tokenData.pushToken, payload);
        successCount++;
      } catch (error) {
        logger.warn(`⚠️ [RideLiveActivity] Falha APNs activity=${tokenData.activityId}: ${error.message}`);
      }
    }

    return {
      success: successCount > 0,
      count: successCount,
      skipped: false
    };
  }

  getApnsJwt() {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (this.jwtCache && this.jwtCache.expiresAt > nowSeconds + 60) {
      return this.jwtCache.token;
    }

    const privateKey = process.env.LEAF_APNS_PRIVATE_KEY ||
      require('fs').readFileSync(process.env.LEAF_APNS_PRIVATE_KEY_PATH, 'utf8');
    const token = jwt.sign(
      { iss: process.env.LEAF_APNS_TEAM_ID, iat: nowSeconds },
      privateKey.replace(/\\n/g, '\n'),
      {
        algorithm: 'ES256',
        header: {
          alg: 'ES256',
          kid: process.env.LEAF_APNS_KEY_ID
        }
      }
    );

    this.jwtCache = { token, expiresAt: nowSeconds + 45 * 60 };
    return token;
  }

  sendApnsUpdate(pushToken, payload) {
    const environment = String(process.env.LEAF_APNS_ENV || process.env.NODE_ENV || '').toLowerCase();
    const host = environment.includes('prod') ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
    const bundleId = process.env.LEAF_APNS_BUNDLE_ID || DEFAULT_BUNDLE_ID;
    const topic = `${bundleId}.push-type.liveactivity`;

    return new Promise((resolve, reject) => {
      const client = http2.connect(`https://${host}`);
      const body = JSON.stringify(payload);
      let settled = false;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        client.close();
        callback(value);
      };

      const timeout = setTimeout(() => {
        finish(reject, new Error('APNs live activity timeout'));
      }, APNS_TIMEOUT_MS);

      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${pushToken}`,
        authorization: `bearer ${this.getApnsJwt()}`,
        'apns-push-type': 'liveactivity',
        'apns-topic': topic,
        'apns-priority': '10',
        'content-type': 'application/json'
      });

      let responseBody = '';
      let statusCode = 0;

      request.setEncoding('utf8');
      request.on('response', (headers) => {
        statusCode = Number(headers[':status'] || 0);
      });
      request.on('data', (chunk) => {
        responseBody += chunk;
      });
      request.on('end', () => {
        if (statusCode >= 200 && statusCode < 300) {
          finish(resolve, { success: true });
          return;
        }
        finish(reject, new Error(`APNs ${statusCode}: ${responseBody || 'sem corpo'}`));
      });
      request.on('error', (error) => {
        finish(reject, error);
      });
      client.on('error', (error) => {
        finish(reject, error);
      });
      request.end(body);
    });
  }
}

module.exports = RideLiveActivityService;
