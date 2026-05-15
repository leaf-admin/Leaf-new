import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Logger from '../utils/Logger';
import PersistentRideNotificationService from './PersistentRideNotificationService';

const STORAGE_KEY = 'prototype_driver_trip_assistant_v1';
const ACTIVE_STATUSES = new Set(['accepted', 'arrived', 'started']);
const PICKUP_TOLERANCE_METERS = 20;
const FALLBACK_SPEED_KM_PER_MIN = 0.45;
const SHOULD_DISABLE_PERSISTENT_NOTIFICATIONS =
  Platform.OS === 'ios' && !Device.isDevice;

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeCoordinate(coordinate) {
  if (!coordinate) {
    return null;
  }

  const latitude = Number(coordinate.latitude ?? coordinate.lat);
  const longitude = Number(coordinate.longitude ?? coordinate.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceMeters(origin, destination) {
  const safeOrigin = normalizeCoordinate(origin);
  const safeDestination = normalizeCoordinate(destination);
  if (!safeOrigin || !safeDestination) {
    return null;
  }

  const earthRadiusMeters = 6371000;
  const deltaLat = toRad(safeDestination.latitude - safeOrigin.latitude);
  const deltaLng = toRad(safeDestination.longitude - safeOrigin.longitude);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRad(safeOrigin.latitude)) *
      Math.cos(toRad(safeDestination.latitude)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) {
    return '--';
  }
  if (meters < 1000) {
    const roundedMeters =
      meters <= 0 ? 0 : Math.max(10, Math.round(meters / 10) * 10);
    return `${roundedMeters} m`;
  }
  return `${Math.max(1, Math.round(meters / 1000))} km`;
}

function formatCurrency(value) {
  if (!Number.isFinite(Number(value))) {
    return 'R$ 0,00';
  }
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

function buildProgressText(progressRatio) {
  const normalized = clamp(Number(progressRatio || 0), 0, 1);
  const totalSlots = 10;
  const filledSlots = Math.round(normalized * totalSlots);
  return `${'█'.repeat(filledSlots)}${'░'.repeat(totalSlots - filledSlots)}`;
}

function resolveTarget(session) {
  if (session?.status === 'started') {
    return {
      phase: 'destination',
      coordinate: normalizeCoordinate(session?.destinationCoordinate),
      address: String(session?.destinationAddress || session?.destinationLabel || 'Destino').trim()
    };
  }

  if (session?.status === 'accepted' || session?.status === 'arrived') {
    return {
      phase: 'pickup',
      coordinate: normalizeCoordinate(session?.pickupCoordinate),
      address: String(session?.pickupAddress || 'Local de embarque').trim()
    };
  }

  return null;
}

function computeEtaMinutes({ remainingMeters, initialMeters, initialEtaMinutes }) {
  if (!Number.isFinite(remainingMeters) || remainingMeters <= 0) {
    return 0;
  }

  const baselineMeters = Number(initialMeters || 0);
  const baselineEta = Number(initialEtaMinutes || 0);
  const kmRemaining = remainingMeters / 1000;

  if (baselineMeters > 0 && baselineEta > 0) {
    const paceKmPerMin = (baselineMeters / 1000) / baselineEta;
    if (paceKmPerMin > 0.01) {
      return Math.max(1, Math.round(kmRemaining / paceKmPerMin));
    }
  }

  return Math.max(1, Math.round(kmRemaining / FALLBACK_SPEED_KM_PER_MIN));
}

function buildNotificationDescriptor(session) {
  const target = resolveTarget(session);
  const remainingMeters = Number(session?.remainingMeters);
  const initialMeters = Number(session?.initialMeters);
  const progressRatio =
    Number.isFinite(initialMeters) && initialMeters > 0 && Number.isFinite(remainingMeters)
      ? clamp(1 - remainingMeters / initialMeters, 0, 1)
      : 0;
  const progressBar = buildProgressText(progressRatio);
  const etaMinutes = Number(session?.etaMinutes || 0);
  const fareLabel = String(session?.fareLabel || formatCurrency(session?.fare || 0)).trim();

  if (session?.status === 'accepted') {
    const readyToArrive = Boolean(session?.pickupToleranceReached);
    return {
      title: 'A caminho do embarque',
      body: `ETA ${etaMinutes || '—'} min • ${formatDistance(remainingMeters)} restantes\n${progressBar} ${Math.round(progressRatio * 100)}%\nEmbarque: ${target?.address || 'Local de embarque'}`,
      categoryId: readyToArrive ? 'DRIVER_PICKUP_READY' : null,
      androidActions: readyToArrive
        ? [
            {
              identifier: 'arrived_at_pickup',
              buttonTitle: 'Cheguei'
            }
          ]
        : []
    };
  }

  if (session?.status === 'arrived') {
    const countdownText =
      Number.isFinite(Number(session?.boardingRemainingSec)) && Number(session.boardingRemainingSec) > 0
        ? `${Math.floor(Number(session.boardingRemainingSec) / 60)}:${String(Number(session.boardingRemainingSec) % 60).padStart(2, '0')}`
        : '2:00';
    return {
      title: 'Aguardando embarque',
      body: `Passageiro tem ${countdownText} para embarcar\nEmbarque: ${target?.address || 'Local de embarque'}`,
      categoryId: 'DRIVER_BOARDING',
      androidActions: [
        {
          identifier: 'start_trip',
          buttonTitle: 'Iniciar'
        }
      ]
    };
  }

  if (session?.status === 'started') {
    return {
      title: 'Viagem em andamento',
      body: `ETA ${etaMinutes || '—'} min • ${formatDistance(remainingMeters)} restantes\n${progressBar} ${Math.round(progressRatio * 100)}%\nDestino: ${target?.address || 'Destino'} • ${fareLabel}`,
      categoryId: 'DRIVER_TRIP_ACTIVE',
      androidActions: [
        {
          identifier: 'end_trip',
          buttonTitle: 'Encerrar'
        }
      ]
    };
  }

  return {
    title: 'Corrida ativa',
    body: target?.address || 'Acompanhe a viagem.',
    categoryId: null,
    androidActions: []
  };
}

class PrototypeDriverTripAssistantService {
  constructor() {
    this.lastTrackingSessionKey = '';
  }

  async loadSession() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (error) {
      Logger.warn('⚠️ [PrototypeDriverTripAssistant] Falha ao carregar sessão:', error?.message || error);
      return null;
    }
  }

  async saveSession(session) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (error) {
      Logger.warn('⚠️ [PrototypeDriverTripAssistant] Falha ao salvar sessão:', error?.message || error);
    }
  }

  async ensureTrackingActive() {
    try {
      const BackgroundLocationService = require('./BackgroundLocationService').default;
      const permissions = await BackgroundLocationService.requestPermissions();
      if (permissions?.foreground) {
        await BackgroundLocationService.startBackgroundTracking();
      }
    } catch (error) {
      Logger.warn('⚠️ [PrototypeDriverTripAssistant] Falha ao iniciar tracking:', error?.message || error);
    }
  }

  async stopTracking() {
    try {
      const BackgroundLocationService = require('./BackgroundLocationService').default;
      await BackgroundLocationService.stopBackgroundTracking();
    } catch (error) {
      Logger.warn('⚠️ [PrototypeDriverTripAssistant] Falha ao parar tracking:', error?.message || error);
    }
  }

  buildSession(input = {}, previous = null) {
    const next = {
      ...(previous || {}),
      ...input
    };

    const target = resolveTarget(next);
    const currentLocation =
      normalizeCoordinate(next.lastDriverLocation) ||
      normalizeCoordinate(next.currentDriverLocation) ||
      normalizeCoordinate(previous?.lastDriverLocation) ||
      normalizeCoordinate(previous?.currentDriverLocation);
    const providedRemainingMeters = Number(next.remainingMeters);
    const remainingMeters = Number.isFinite(providedRemainingMeters)
      ? Math.max(0, providedRemainingMeters)
      : target?.coordinate && currentLocation
        ? calculateDistanceMeters(currentLocation, target.coordinate)
        : null;
    const initialMeters =
      Number.isFinite(Number(next.initialMeters)) && Number(next.initialMeters) > 0
        ? Number(next.initialMeters)
        : Number.isFinite(remainingMeters)
          ? remainingMeters
          : null;
    const initialEtaMinutes =
      Number.isFinite(Number(next.initialEtaMinutes)) && Number(next.initialEtaMinutes) > 0
        ? Number(next.initialEtaMinutes)
        : Number.isFinite(Number(next.etaMinutes)) && Number(next.etaMinutes) > 0
          ? Number(next.etaMinutes)
          : null;
    const providedEtaMinutes = Number(next.etaMinutes);
    const etaMinutes = Number.isFinite(providedEtaMinutes) && providedEtaMinutes >= 0
      ? Math.max(0, Math.round(providedEtaMinutes))
      : computeEtaMinutes({
          remainingMeters,
          initialMeters,
          initialEtaMinutes
        });

    return {
      ...next,
      lastDriverLocation: currentLocation,
      initialMeters,
      initialEtaMinutes,
      remainingMeters,
      etaMinutes,
      pickupToleranceReached:
        next.status === 'accepted' && Number.isFinite(remainingMeters)
          ? remainingMeters <= PICKUP_TOLERANCE_METERS
          : false,
      updatedAt: new Date().toISOString()
    };
  }

  async upsertPersistentNotification(session) {
    if (SHOULD_DISABLE_PERSISTENT_NOTIFICATIONS) {
      return;
    }

    try {
      await PersistentRideNotificationService.requestPermissions();
    } catch (_error) {
      // best effort
    }

    const descriptor = buildNotificationDescriptor(session);
    const payload = {
      bookingId: session.bookingId,
      status: session.status,
      userType: 'driver',
      pickup: {
        address: session.pickupAddress || 'Local de embarque'
      },
      destination: {
        address: session.destinationAddress || 'Destino'
      },
      customerName: session.passengerName || 'Passageiro',
      estimatedTime: session.etaMinutes,
      distance: Number.isFinite(session.remainingMeters) ? Number((session.remainingMeters / 1000).toFixed(2)) : null,
      fare: session.fareLabel || formatCurrency(session.fare || 0),
      notificationDataType: 'prototype_driver_trip',
      customTitle: descriptor.title,
      customBody: descriptor.body,
      notificationCategoryId: descriptor.categoryId,
      androidActions: descriptor.androidActions,
      boardingRemainingSec: session.boardingRemainingSec || 0,
      pickupAddress: session.pickupAddress || '',
      destinationAddress: session.destinationAddress || '',
      pickupToleranceReached: Boolean(session.pickupToleranceReached),
      passengerName: session.passengerName || '',
      bookingPhase: session.status
    };

    if (PersistentRideNotificationService.isNotificationActive()) {
      await PersistentRideNotificationService.updateRideNotification(payload);
      return;
    }

    await PersistentRideNotificationService.showRideNotification(payload);
  }

  async syncSession(sessionInput) {
    const previous = await this.loadSession();
    const normalizedStatus = String(sessionInput?.status || previous?.status || '').trim().toLowerCase();

    if (!ACTIVE_STATUSES.has(normalizedStatus) || !sessionInput?.bookingId) {
      await this.clearSession();
      return null;
    }

    const session = this.buildSession(
      {
        ...sessionInput,
        status: normalizedStatus
      },
      previous
    );

    await this.saveSession(session);
    const trackingSessionKey = `${String(session.bookingId || '').trim()}:${String(session.status || '').trim()}`;
    if (trackingSessionKey && this.lastTrackingSessionKey !== trackingSessionKey) {
      this.lastTrackingSessionKey = trackingSessionKey;
      await this.ensureTrackingActive();
    }
    await this.upsertPersistentNotification(session);
    return session;
  }

  async handleBackgroundLocationUpdate(location) {
    const previous = await this.loadSession();
    if (!previous || !ACTIVE_STATUSES.has(String(previous.status || '').trim().toLowerCase())) {
      return null;
    }

    const session = this.buildSession(
      {
        ...previous,
        lastDriverLocation: {
          latitude: Number(location?.lat ?? location?.latitude),
          longitude: Number(location?.lng ?? location?.longitude)
        }
      },
      previous
    );

    await this.saveSession(session);
    await this.upsertPersistentNotification(session);
    return session;
  }

  async clearSession() {
    this.lastTrackingSessionKey = '';
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      Logger.warn('⚠️ [PrototypeDriverTripAssistant] Falha ao limpar sessão:', error?.message || error);
    }

    if (!SHOULD_DISABLE_PERSISTENT_NOTIFICATIONS) {
      await PersistentRideNotificationService.dismissRideNotification();
    }
    await this.stopTracking();
  }

  async getLatestActionContext() {
    const session = await this.loadSession();
    if (!session) {
      return null;
    }

    return {
      ...session,
      target: resolveTarget(session)
    };
  }
}

const prototypeDriverTripAssistantService = new PrototypeDriverTripAssistantService();
export default prototypeDriverTripAssistantService;
export { calculateDistanceMeters, PICKUP_TOLERANCE_METERS };
