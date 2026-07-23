import { NativeModules, Platform } from 'react-native';
import Logger from '../utils/Logger';
import featureFlagService from './FeatureFlagService';
import WebSocketManager from './WebSocketManager';

const TERMINAL_STATUSES = new Set([
  'completed',
  'complete',
  'cancelled',
  'canceled',
  'no_drivers',
  'no_drivers_available',
  'rejected',
  'expired',
]);

const STATUS_PROGRESS = {
  searching: 0.12,
  accepted: 0.35,
  arrived: 0.52,
  started: 0.76,
  completed: 1,
  complete: 1,
  cancelled: 1,
  canceled: 1,
};

const normalizeStatus = (status) =>
  String(status || '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

const normalizeRole = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'driver' ? 'driver' : 'passenger';
};

const pickAddress = (location, fallback = '') => {
  if (!location || typeof location !== 'object') {
    return fallback;
  }
  return String(location.address || location.name || location.description || fallback || '').trim();
};

const formatEta = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }
  return `${Math.round(numeric)} min`;
};

const formatDistance = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }
  return `${numeric.toFixed(numeric >= 10 ? 0 : 1).replace('.', ',')} km`;
};

class RideLiveActivityService {
  constructor() {
    this.availabilityPromise = null;
    this.available = null;
    this.activeActivities = new Map();
    this.registeredTokenKeys = new Set();
  }

  async isEnabled() {
    if (Platform.OS !== 'ios') {
      return false;
    }

    const enabled = await featureFlagService.getFlag('PILOT_RIDE_LIVE_ACTIVITIES_REQUIRED', true);
    return enabled === true;
  }

  async isAvailable() {
    if (!(await this.isEnabled())) {
      return false;
    }

    if (!NativeModules?.LeafRideActivity?.isAvailable) {
      this.available = false;
      return false;
    }

    if (!this.availabilityPromise) {
      this.availabilityPromise = NativeModules.LeafRideActivity.isAvailable()
        .then((result) => {
          this.available = result?.available === true;
          return this.available;
        })
        .catch((error) => {
          Logger.warn('⚠️ [RideLiveActivity] ActivityKit indisponível:', error?.message || error);
          this.available = false;
          return false;
        });
    }

    return this.availabilityPromise;
  }

  buildPayload(rideData = {}) {
    const bookingId = String(rideData.bookingId || rideData.rideId || rideData.tripId || '').trim();
    const status = normalizeStatus(rideData.status || rideData.bookingPhase);
    const role = normalizeRole(rideData.userType || rideData.role);
    const activityId = `ride:${role}:${bookingId}`;
    const etaText = rideData.etaText || formatEta(rideData.estimatedTime || rideData.etaMinutes);
    const distanceText = rideData.distanceText || formatDistance(rideData.distance || rideData.distanceKm);
    const fareLabel = String(rideData.fareLabel || rideData.fare || '').trim();
    const destinationAddress = pickAddress(rideData.destination, rideData.destinationAddress || 'destino');
    const pickupAddress = pickAddress(rideData.pickup, rideData.pickupAddress || 'embarque');

    const passengerText = this.buildPassengerText(status, {
      driverName: rideData.driverName,
      etaText,
      destinationAddress,
    });
    const driverText = this.buildDriverText(status, {
      customerName: rideData.customerName || rideData.passengerName,
      etaText,
      pickupAddress,
      destinationAddress,
    });
    const copy = role === 'driver' ? driverText : passengerText;

    return {
      activityId,
      rideId: bookingId,
      bookingId,
      role,
      phase: status || 'accepted',
      title: copy.title,
      subtitle: copy.subtitle,
      body: copy.body,
      etaText,
      distanceText,
      fareLabel,
      progress: STATUS_PROGRESS[status] ?? 0.25,
      updatedAt: new Date().toISOString(),
      staleAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  buildPassengerText(status, { driverName, etaText, destinationAddress }) {
    switch (status) {
      case 'searching':
        return {
          title: 'Buscando motorista',
          subtitle: etaText ? `Estimativa ${etaText}` : '',
          body: 'A corrida começa após a confirmação do motorista.',
        };
      case 'accepted':
        return {
          title: etaText || 'Motorista a caminho',
          subtitle: driverName ? `${driverName} está a caminho` : 'Motorista a caminho',
          body: 'Acompanhe a chegada pelo app.',
        };
      case 'arrived':
        return {
          title: 'Motorista chegou',
          subtitle: driverName || '',
          body: 'Dirija-se ao local de embarque.',
        };
      case 'started':
        return {
          title: `A caminho de ${destinationAddress}`,
          subtitle: etaText ? `Chegada em ${etaText}` : '',
          body: 'Viagem em andamento.',
        };
      default:
        return {
          title: 'Corrida ativa',
          subtitle: etaText || '',
          body: 'Acompanhe a corrida pela Leaf.',
        };
    }
  }

  buildDriverText(status, { customerName, etaText, pickupAddress, destinationAddress }) {
    switch (status) {
      case 'accepted':
        return {
          title: etaText || 'Vá até o embarque',
          subtitle: pickupAddress,
          body: customerName ? `Passageiro: ${customerName}` : 'Passageiro aguardando.',
        };
      case 'arrived':
        return {
          title: 'Aguardando embarque',
          subtitle: customerName || '',
          body: 'Inicie a viagem após o passageiro embarcar.',
        };
      case 'started':
        return {
          title: `A caminho de ${destinationAddress}`,
          subtitle: etaText ? `Chegada em ${etaText}` : '',
          body: 'Viagem em andamento.',
        };
      default:
        return {
          title: 'Corrida ativa',
          subtitle: etaText || '',
          body: 'Acompanhe a corrida pela Leaf.',
        };
    }
  }

  async startOrUpdate(rideData = {}) {
    const bookingId = String(rideData.bookingId || rideData.rideId || rideData.tripId || '').trim();
    const status = normalizeStatus(rideData.status || rideData.bookingPhase);

    try {
      if (!bookingId || !status || !(await this.isAvailable())) {
        return { handled: false };
      }

      if (TERMINAL_STATUSES.has(status)) {
        return this.end({ bookingId, status, ...rideData });
      }

      const payload = this.buildPayload({ ...rideData, bookingId, status });
      const result = await NativeModules.LeafRideActivity.startOrUpdate(payload);

      this.activeActivities.set(payload.bookingId, payload.activityId);
      if (result?.pushToken) {
        await this.registerPushToken(payload, result.pushToken);
      }

      return {
        handled: true,
        success: result?.success === true,
        activityId: payload.activityId,
        surface: 'ios_activitykit',
      };
    } catch (error) {
      Logger.warn('⚠️ [RideLiveActivity] Falha ao iniciar/atualizar, mantendo fallback:', error?.message || error);
      return { handled: false, error: error?.message || String(error) };
    }
  }

  async end(options = {}) {
    const bookingId = String(options.bookingId || options.rideId || options.tripId || '').trim();
    const role = normalizeRole(options.userType || options.role);
    const activityId = options.activityId || this.activeActivities.get(bookingId) || `ride:${role}:${bookingId}`;

    try {
      if (!bookingId || !(await this.isAvailable())) {
        return { handled: false };
      }

      const payload = this.buildPayload({
        ...options,
        bookingId,
        status: normalizeStatus(options.status) || 'completed',
        activityId,
      });

      await NativeModules.LeafRideActivity.end({
        ...payload,
        endedAt: new Date().toISOString(),
      });

      this.activeActivities.delete(bookingId);
      return { handled: true, success: true, activityId };
    } catch (error) {
      Logger.warn('⚠️ [RideLiveActivity] Falha ao encerrar, seguindo limpeza local:', error?.message || error);
      this.activeActivities.delete(bookingId);
      return { handled: false, error: error?.message || String(error) };
    }
  }

  async dismiss(options = {}) {
    return this.end(options);
  }

  async registerPushToken(payload, pushToken) {
    const token = String(pushToken || '').trim();
    const tokenKey = `${payload.activityId}:${token}`;
    if (!token || this.registeredTokenKeys.has(tokenKey)) {
      return;
    }

    try {
      const wsManager = WebSocketManager.getInstance();
      await wsManager.registerRideLiveActivityToken({
        activityId: payload.activityId,
        bookingId: payload.bookingId,
        rideId: payload.rideId,
        role: payload.role,
        platform: 'ios',
        pushToken: token,
      });
      this.registeredTokenKeys.add(tokenKey);
    } catch (error) {
      Logger.warn('⚠️ [RideLiveActivity] Não foi possível registrar pushToken agora:', error?.message || error);
    }
  }
}

const rideLiveActivityService = new RideLiveActivityService();
export default rideLiveActivityService;
