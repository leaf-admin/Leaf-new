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

// A trilha do cartão mostra o trecho atual (até o embarque ou até o destino). Com a
// distância real do trecho o carro anda de verdade; sem ela vale o ponto fixo da fase.
function resolveLegProgress(status, rideData = {}) {
  const leg = rideData?.ongoing?.progress ?? rideData?.legProgress;
  if ((status === 'accepted' || status === 'started') && leg !== null && leg !== undefined && Number.isFinite(Number(leg))) {
    return Math.min(1, Math.max(0.04, Number(leg)));
  }
  return STATUS_PROGRESS[status] ?? 0.25;
}

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

    const vehicleLine = [rideData.vehicleModel || rideData.vehicle, rideData.vehiclePlate || rideData.plate]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' · ');
    const passengerText = this.buildPassengerText(status, {
      driverName: rideData.driverName,
      vehicleLine,
      pickupAddress,
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
      progress: resolveLegProgress(status, rideData),
      updatedAt: new Date().toISOString(),
      staleAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  // O tempo aparece grande no canto do cartão; o título diz o que está acontecendo.
  buildPassengerText(status, { driverName, vehicleLine, pickupAddress, destinationAddress }) {
    switch (status) {
      case 'searching':
        return {
          title: 'Procurando seu motorista',
          subtitle: '',
          body: 'Avisamos assim que alguém aceitar.',
        };
      case 'accepted':
        return {
          title: driverName ? `${driverName} está a caminho` : 'Motorista a caminho',
          subtitle: vehicleLine,
          body: `Embarque: ${pickupAddress}`,
        };
      case 'arrived':
        return {
          title: 'Seu motorista chegou',
          subtitle: vehicleLine || driverName || '',
          body: `Embarque: ${pickupAddress}`,
        };
      case 'started':
        return {
          title: `A caminho de ${destinationAddress}`,
          subtitle: driverName ? `Com ${driverName}` : '',
          body: '',
        };
      default:
        return {
          title: 'Corrida ativa',
          subtitle: '',
          body: 'Acompanhe a corrida pela Leaf.',
        };
    }
  }

  buildDriverText(status, { customerName, pickupAddress, destinationAddress }) {
    switch (status) {
      case 'accepted':
        return {
          title: 'Vá até o embarque',
          subtitle: customerName ? `Passageiro: ${customerName}` : '',
          body: pickupAddress,
        };
      case 'arrived':
        return {
          title: 'Aguardando embarque',
          subtitle: customerName ? `Passageiro: ${customerName}` : '',
          body: pickupAddress,
        };
      case 'started':
        return {
          title: `A caminho de ${destinationAddress}`,
          subtitle: customerName ? `Com ${customerName}` : '',
          body: '',
        };
      default:
        return {
          title: 'Corrida ativa',
          subtitle: '',
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
