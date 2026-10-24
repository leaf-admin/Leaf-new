import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { AppState, Platform } from 'react-native';
import Logger from '../utils/Logger';
import PersistentRideNotificationService from './PersistentRideNotificationService';
import { cancelRideArrivalAlert, displayRideArrivalAlert } from './LeafOngoingRideNotification';
import { PICKUP_ARRIVAL_METERS as PICKUP_TOLERANCE_METERS } from './LeafNativeNavigationEngine';

const STORAGE_KEY = 'prototype_driver_trip_assistant_v1';
const ACTIVE_STATUSES = new Set(['accepted', 'arrived', 'started']);
const FALLBACK_SPEED_KM_PER_MIN = 0.45;
// Distância do destino em que o motorista é avisado para encerrar a corrida. A mesma
// do encerramento sem a pergunta "Encerrar antes do destino?" (driverEarlyEndConfirm).
// O fim da rota de um shopping ou de um aeroporto fica a centenas de metros do ponto
// do lugar.
const DESTINATION_ALERT_METERS = 500;
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

// "R. das Pastorinhas, 4 - Jacarepaguá, Rio de Janeiro - RJ, 22723-260, Brasil" ocupa a
// notificação inteira; rua, número e bairro bastam.
function shortenAddress(address) {
  const parts = String(address || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  // "Rua X, 4 - Bairro": o número vem depois da primeira vírgula.
  const base = parts.length > 1 && /^\d/.test(parts[1]) ? `${parts[0]}, ${parts[1]}` : parts[0];
  return base.split(' - ').slice(0, 2).join(' - ');
}

// Linha curta ao lado do nome do app: "4 min · 1 km".
function buildEtaDistanceLabel(etaMinutes, remainingMeters) {
  const parts = [];
  if (Number.isFinite(Number(etaMinutes)) && Number(etaMinutes) > 0) {
    parts.push(`${Math.round(Number(etaMinutes))} min`);
  }
  if (Number.isFinite(Number(remainingMeters)) && Number(remainingMeters) >= 0) {
    parts.push(formatDistance(Number(remainingMeters)));
  }
  return parts.join(' · ');
}

// "Ana Paula Souza" vira "Ana"; o nome genérico não entra no título.
function firstName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return /^passageir[oa]$/i.test(first) ? '' : first;
}

// Hora prevista de chegada, no relógio do aparelho: "14:32".
function formatArrivalClock(etaMinutes, now) {
  if (!Number.isFinite(Number(etaMinutes)) || Number(etaMinutes) <= 0) return '';
  const at = new Date(now + Math.round(Number(etaMinutes)) * 60000);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

// Base de cada etapa (embarque, viagem), medida no primeiro ponto da etapa. A barra
// compara linha reta com linha reta: em segundo plano só há a distância em linha reta
// até o alvo, e dividi-la pela distância da rota levava a barra a ~55% no começo da
// viagem. A razão rota/linha reta do início estima o que falta pela rua, e o ETA da
// rota no início dá o ritmo.
function resolveLegBaseline({ legChanged, previous, input, straightMeters }) {
  const carried = legChanged ? {} : previous || {};
  const legStraightMeters = Number(carried.legStraightMeters) > 0
    ? Number(carried.legStraightMeters)
    : Number(straightMeters) > 0 ? Number(straightMeters) : null;
  const providedRouteMeters = Number(input?.remainingMeters);
  const legRouteMeters = Number(carried.legRouteMeters) > 0
    ? Number(carried.legRouteMeters)
    : providedRouteMeters > 0 ? providedRouteMeters : null;
  const providedEta = Number(input?.etaMinutes);
  const legEtaMinutes = Number(carried.legEtaMinutes) > 0
    ? Number(carried.legEtaMinutes)
    : providedEta > 0 ? providedEta
      : legChanged && Number(input?.initialEtaMinutes) > 0 ? Number(input.initialEtaMinutes) : null;
  const detour = legRouteMeters && legStraightMeters ? legRouteMeters / legStraightMeters : null;
  return {
    legStraightMeters,
    legRouteMeters,
    legEtaMinutes,
    // Rota de 1x a 3x a linha reta; fora disso a medida do início não serve.
    detourFactor: detour && detour >= 1 && detour <= 3 ? detour : 1
  };
}

function buildTripSession(input = {}, previous = null) {
  const next = {
    ...(previous || {}),
    ...input
  };
  const legChanged =
    !previous ||
    String(previous.bookingId || '') !== String(next.bookingId || '') ||
    String(previous.status || '') !== String(next.status || '');

  const target = resolveTarget(next);
  const currentLocation =
    normalizeCoordinate(next.lastDriverLocation) ||
    normalizeCoordinate(next.currentDriverLocation) ||
    normalizeCoordinate(previous?.lastDriverLocation) ||
    normalizeCoordinate(previous?.currentDriverLocation);
  const straightMeters = target?.coordinate && currentLocation
    ? calculateDistanceMeters(currentLocation, target.coordinate)
    : null;
  const baseline = resolveLegBaseline({ legChanged, previous, input, next, straightMeters });

  const providedRemainingMeters = Number(next.remainingMeters);
  const remainingMeters = Number.isFinite(providedRemainingMeters)
    ? Math.max(0, providedRemainingMeters)
    : Number.isFinite(straightMeters)
      ? Math.round(straightMeters * baseline.detourFactor)
      : null;
  const initialMeters = legChanged
    ? (Number(input?.initialMeters) > 0 ? Number(input.initialMeters) : remainingMeters)
    : Number.isFinite(Number(next.initialMeters)) && Number(next.initialMeters) > 0
      ? Number(next.initialMeters)
      : remainingMeters;
  const etaSource = legChanged ? input || {} : next;
  const initialEtaMinutes =
    Number(etaSource.initialEtaMinutes) > 0
      ? Number(etaSource.initialEtaMinutes)
      : Number(etaSource.etaMinutes) > 0
        ? Number(etaSource.etaMinutes)
        : null;
  const straightRatio = Number.isFinite(straightMeters) && baseline.legStraightMeters
    ? clamp(straightMeters / baseline.legStraightMeters, 0, 1)
    : null;
  const providedEtaMinutes = Number(next.etaMinutes);
  const etaMinutes = Number.isFinite(providedEtaMinutes) && providedEtaMinutes >= 0
    ? Math.max(0, Math.round(providedEtaMinutes))
    : straightRatio !== null && baseline.legEtaMinutes
      ? (straightMeters > 0 ? Math.max(1, Math.round(baseline.legEtaMinutes * straightRatio)) : 0)
      : computeEtaMinutes({
          remainingMeters,
          initialMeters,
          initialEtaMinutes
        });
  const progressRatio = straightRatio !== null
    ? 1 - straightRatio
    : Number.isFinite(initialMeters) && initialMeters > 0 && Number.isFinite(remainingMeters)
      ? clamp(1 - remainingMeters / initialMeters, 0, 1)
      : 0;

  return {
    ...next,
    lastDriverLocation: currentLocation,
    initialMeters,
    initialEtaMinutes,
    remainingMeters,
    etaMinutes,
    legStraightMeters: baseline.legStraightMeters,
    legRouteMeters: baseline.legRouteMeters,
    legEtaMinutes: baseline.legEtaMinutes,
    progressRatio,
    pickupToleranceReached:
      next.status === 'accepted' && Number.isFinite(straightMeters)
        ? straightMeters <= PICKUP_TOLERANCE_METERS
        : false,
    updatedAt: new Date().toISOString()
  };
}

const NAVIGATE_ACTION = { identifier: 'open_navigation', buttonTitle: 'Navegar' };

function buildNotificationDescriptor(session, { now = Date.now() } = {}) {
  const target = resolveTarget(session);
  const remainingMeters = Number(session?.remainingMeters);
  const initialMeters = Number(session?.initialMeters);
  const progressRatio = Number.isFinite(Number(session?.progressRatio))
    ? clamp(Number(session.progressRatio), 0, 1)
    : Number.isFinite(initialMeters) && initialMeters > 0 && Number.isFinite(remainingMeters)
      ? clamp(1 - remainingMeters / initialMeters, 0, 1)
      : 0;
  const progressBar = buildProgressText(progressRatio);
  const etaMinutes = Number(session?.etaMinutes || 0);
  const fareLabel = String(session?.fareLabel || formatCurrency(session?.fare || 0)).trim();

  const passenger = firstName(session?.passengerName);
  const arrivalClock = formatArrivalClock(etaMinutes, now);

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
              buttonTitle: 'Cheguei ao embarque'
            }
          ]
        : [NAVIGATE_ACTION],
      ongoing: {
        title: readyToArrive
          ? 'Você chegou ao embarque'
          : (passenger ? `Buscar ${passenger}` : 'A caminho do embarque'),
        subtitle: readyToArrive
          ? 'Avise o passageiro'
          : [buildEtaDistanceLabel(etaMinutes, remainingMeters), arrivalClock && `até ${arrivalClock}`]
            .filter(Boolean)
            .join(' · '),
        body: `Embarque: ${shortenAddress(target?.address) || 'Local de embarque'}`,
        progress: readyToArrive ? 1 : progressRatio,
        countdownSeconds: !readyToArrive && etaMinutes > 0 ? etaMinutes * 60 : 0
      }
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
          buttonTitle: 'Iniciar corrida'
        }
      ],
      ongoing: {
        title: passenger ? `Aguardando ${passenger}` : 'Aguardando passageiro',
        subtitle: 'Tempo de embarque',
        body: `Embarque: ${shortenAddress(target?.address) || 'Local de embarque'}`,
        progress: null,
        countdownSeconds: Number(session?.boardingRemainingSec) > 0 ? Number(session.boardingRemainingSec) : 0
      }
    };
  }

  if (session?.status === 'started') {
    return {
      title: 'Viagem em andamento',
      body: `ETA ${etaMinutes || '—'} min • ${formatDistance(remainingMeters)} restantes\n${progressBar} ${Math.round(progressRatio * 100)}%\nDestino: ${target?.address || 'Destino'} • ${fareLabel}`,
      categoryId: 'DRIVER_TRIP_ACTIVE',
      androidActions: [
        NAVIGATE_ACTION,
        {
          identifier: 'end_trip',
          buttonTitle: 'Encerrar'
        }
      ],
      ongoing: {
        title: arrivalClock ? `Chegada às ${arrivalClock}` : 'Em viagem',
        subtitle: buildEtaDistanceLabel(etaMinutes, remainingMeters),
        body: `Destino: ${shortenAddress(target?.address) || 'Destino'} · ${fareLabel}`,
        progress: progressRatio,
        countdownSeconds: etaMinutes > 0 ? etaMinutes * 60 : 0
      }
    };
  }

  return {
    title: 'Corrida ativa',
    body: target?.address || 'Acompanhe a viagem.',
    categoryId: null,
    androidActions: [],
    ongoing: {
      title: 'Corrida ativa',
      body: target?.address || 'Acompanhe a viagem.',
      progress: null,
      countdownSeconds: 0
    }
  };
}

// Os dois momentos em que o motorista, com o mapa em tela cheia, precisa voltar ao
// Leaf: chegou ao embarque e está chegando ao destino. Um aviso por corrida e fase.
function resolveArrivalAlert(session) {
  const bookingId = String(session?.bookingId || '').trim();
  if (!bookingId) return null;
  const passenger = firstName(session?.passengerName);
  if (session?.status === 'accepted' && session?.pickupToleranceReached) {
    return {
      key: `${bookingId}:pickup`,
      title: 'Você chegou ao embarque',
      body: passenger ? `Avise ${passenger} que você chegou.` : 'Avise o passageiro que você chegou.',
      actions: [{ identifier: 'arrived_at_pickup', buttonTitle: 'Cheguei ao embarque' }],
    };
  }
  const remainingMeters = Number(session?.remainingMeters);
  if (session?.status === 'started' && Number.isFinite(remainingMeters) && remainingMeters <= DESTINATION_ALERT_METERS) {
    const destination = shortenAddress(session?.destinationAddress) || 'destino';
    return {
      key: `${bookingId}:destination`,
      title: 'Chegando ao destino',
      body: `${destination} · encerre a corrida no Leaf`,
      actions: [{ identifier: 'end_trip', buttonTitle: 'Encerrar corrida' }],
    };
  }
  return null;
}

class PrototypeDriverTripAssistantService {
  constructor() {
    this.lastTrackingSessionKey = '';
    this.onlinePresenceKey = null;
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

  // The background location task only forwards a fix when it knows which ride
  // is active. Nothing told it any more (the code that did belongs to a screen
  // that is no longer used), so every fix taken with the app in the background
  // was dropped: on a device the server received no position for a minute while
  // the driver had another app in front.
  async syncBackgroundTripContext(session) {
    try {
      const locationBufferService = require('./LocationBufferService').default;
      await locationBufferService.setActiveTripContext({
        bookingId: session.bookingId,
        tripId: session.bookingId,
        driverId: session.driverId || null,
        tripStatus: session.status,
      });
    } catch (error) {
      Logger.warn('⚠️ [PrototypeDriverTripAssistant] Falha ao registrar corrida ativa para o tracking:', error?.message || error);
    }
  }

  async clearBackgroundTripContext() {
    try {
      const locationBufferService = require('./LocationBufferService').default;
      await locationBufferService.clearActiveTripContext();
    } catch (error) {
      Logger.warn('⚠️ [PrototypeDriverTripAssistant] Falha ao limpar corrida ativa do tracking:', error?.message || error);
    }
  }

  // Online sem corrida: o serviço de localização fica ativo para o motorista continuar
  // na fila com o app em segundo plano (antes ele só rodava durante a corrida e o
  // servidor marcava o motorista como offline segundos depois de ele sair do app).
  async setOnlinePresence({ online = false, driverId = null } = {}) {
    const nextKey = online && driverId ? String(driverId) : '';
    if (this.onlinePresenceKey === nextKey) {
      return;
    }
    this.onlinePresenceKey = nextKey;

    try {
      const locationBufferService = require('./LocationBufferService').default;
      locationBufferService.setDriverPresenceContext(nextKey ? { driverId: nextKey } : null);
    } catch (error) {
      Logger.warn('⚠️ [PrototypeDriverTripAssistant] Falha ao registrar presença online:', error?.message || error);
    }

    if (nextKey) {
      await this.ensureTrackingActive();
      return;
    }
    if (!this.lastTrackingSessionKey) {
      await this.stopTracking();
    }
  }

  async ensureTrackingActive() {
    try {
      const BackgroundLocationService = require('./BackgroundLocationService').default;
      // Mid-ride: never prompt. Permissions are requested when going online.
      const permissions = await BackgroundLocationService.checkPermissions();
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
    return buildTripSession(input, previous);
  }

  async upsertPersistentNotification(session) {
    if (SHOULD_DISABLE_PERSISTENT_NOTIFICATIONS) {
      return;
    }

    // Uma vez por sessão: chamava o módulo nativo de permissões a cada posição recebida.
    if (!this.notificationPermissionAsked) {
      this.notificationPermissionAsked = true;
      try {
        await PersistentRideNotificationService.requestPermissions();
      } catch (_error) {
        // best effort
      }
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
      ongoing: descriptor.ongoing,
      boardingRemainingSec: session.boardingRemainingSec || 0,
      pickupAddress: session.pickupAddress || '',
      destinationAddress: session.destinationAddress || '',
      pickupToleranceReached: Boolean(session.pickupToleranceReached),
      passengerName: session.passengerName || '',
      bookingPhase: session.status,
      // O balão só oferece "Encerrar" perto do destino (a mesma regra do aviso).
      nearDestination:
        session.status === 'started' &&
        Number.isFinite(Number(session.remainingMeters)) &&
        Number(session.remainingMeters) <= DESTINATION_ALERT_METERS
    };

    if (PersistentRideNotificationService.isNotificationActive()) {
      await PersistentRideNotificationService.updateRideNotification(payload);
    } else {
      await PersistentRideNotificationService.showRideNotification(payload);
    }
    await this.syncArrivalAlert(session);
  }

  async syncArrivalAlert(session) {
    const alert = resolveArrivalAlert(session);
    if (!alert) {
      // A corrida passou da fase do aviso (o motorista já tocou em Cheguei, por
      // exemplo): o aviso sai da tela. Uma vez por aviso.
      const shownKey = String(session.arrivalAlertKey || '');
      const shownPhase = shownKey.split(':').pop();
      const stillInThatPhase =
        (shownPhase === 'pickup' && session.status === 'accepted') ||
        (shownPhase === 'destination' && session.status === 'started');
      if (shownKey && !stillInThatPhase && this.cancelledArrivalAlertKey !== shownKey) {
        this.cancelledArrivalAlertKey = shownKey;
        await cancelRideArrivalAlert();
      }
      return;
    }
    if (session.arrivalAlertKey === alert.key) {
      return;
    }
    // Com o Leaf na tela, o próprio app já mostra o botão: o aviso só cobria o banner.
    // Fica sem marcar, para tocar se o motorista for para o Maps ainda nesta fase.
    if (AppState.currentState === 'active') {
      return;
    }
    const shown = await displayRideArrivalAlert({
      title: alert.title,
      body: alert.body,
      actions: alert.actions,
      data: { bookingId: session.bookingId, status: session.status, type: 'ride_arrival_alert' },
    });
    if (shown) {
      session.arrivalAlertKey = alert.key;
      await this.saveSession(session);
    }
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
      await this.syncBackgroundTripContext(session);
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

    // Distância e ETA saem da posição nova. Herdados da sessão, ficavam parados no
    // último valor do app em primeiro plano enquanto o motorista usava o Waze.
    const session = this.buildSession(
      {
        ...previous,
        remainingMeters: undefined,
        etaMinutes: undefined,
        lastDriverLocation: {
          latitude: Number(location?.lat ?? location?.latitude),
          longitude: Number(location?.lng ?? location?.longitude)
        }
      },
      { ...previous, remainingMeters: undefined, etaMinutes: undefined }
    );

    await this.saveSession(session);
    await this.upsertPersistentNotification(session);
    return session;
  }

  async clearSession() {
    this.lastTrackingSessionKey = '';
    const previous = await this.loadSession();
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      Logger.warn('⚠️ [PrototypeDriverTripAssistant] Falha ao limpar sessão:', error?.message || error);
    }

    await cancelRideArrivalAlert();
    if (!SHOULD_DISABLE_PERSISTENT_NOTIFICATIONS) {
      await PersistentRideNotificationService.dismissRideNotification({
        bookingId: previous?.bookingId,
      });
    }
    await this.clearBackgroundTripContext();
    if (!this.onlinePresenceKey) {
      await this.stopTracking();
    }
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
export {
  buildNotificationDescriptor,
  buildTripSession,
  calculateDistanceMeters,
  DESTINATION_ALERT_METERS,
  PICKUP_TOLERANCE_METERS,
  resolveArrivalAlert,
};
