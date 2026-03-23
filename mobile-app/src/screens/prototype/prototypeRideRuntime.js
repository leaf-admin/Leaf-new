import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import * as Location from 'expo-location';
import polyline from '@mapbox/polyline';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../../utils/Logger';
import WebSocketManager from '../../services/WebSocketManager';
import { fetchCoordsfromPlace, fetchPlacesAutocomplete, getDirectionsApi } from '../../common-local/GoogleAPIFunctions';
import { DESTINATION_HISTORY, PROTOTYPE_ORIGIN_COORDINATE } from './robotaxiPrototypeData';
import { clearPrototypeMapRoute, setPrototypeMapRoute } from './prototypeMapRoute';
import {
  completeDriverOnboardingStage,
  computeDriverOnboardingState,
  createInitialDriverOnboardingState,
  updateDriverOnboardingChecklist
} from '../../services/DriverOnboardingService';

const USER_TYPE = 'customer';
const SEARCH_TIMER_INTERVAL_MS = 1000;
const TRIP_HISTORY_LIMIT = 12;
const CHAT_MESSAGE_LIMIT = 80;
const MIN_HEADING_DELTA_DEG = 2;
const NOTIFICATION_LIMIT = 24;
const DRIVER_ACTIVATION_STORAGE_PREFIX = '@prototype_driver_activation_';
const DEFAULT_RUNTIME_NOTIFICATIONS = Object.freeze([
  {
    id: 'notif-welcome',
    title: 'Bem-vinda ao Leaf',
    message: 'Seu protótipo está pronto para solicitar corridas.',
    kind: 'system',
    scope: 'both',
    read: false,
    createdAt: '2026-03-18T08:00:00.000Z'
  },
  {
    id: 'notif-driver-online',
    title: 'Modo motorista disponível',
    message: 'Ative o painel para receber novas ofertas.',
    kind: 'driver',
    scope: 'driver',
    read: false,
    createdAt: '2026-03-18T08:10:00.000Z'
  },
  {
    id: 'notif-passenger-tip',
    title: 'Dica de embarque',
    message: 'Mantenha o telefone por perto para acompanhar a chegada.',
    kind: 'trip',
    scope: 'passenger',
    read: true,
    createdAt: '2026-03-18T08:15:00.000Z'
  }
]);
const DEFAULT_DRIVER_ACTIVATION = createInitialDriverOnboardingState();

const DEFAULT_RUNTIME_STATE = Object.freeze({
  ready: false,
  initializing: false,
  connecting: false,
  isSocketConnected: false,
  isSocketAuthenticated: false,
  socketError: '',
  currentCoordinate: {
    latitude: PROTOTYPE_ORIGIN_COORDINATE.latitude,
    longitude: PROTOTYPE_ORIGIN_COORDINATE.longitude
  },
  currentHeading: 0,
  notifications: DEFAULT_RUNTIME_NOTIFICATIONS,
  currentAddress: '',
  bookingStatus: 'idle',
  searchingElapsedSeconds: 0,
  activeBookingId: null,
  activeBooking: null,
  selectedDestination: null,
  tripDistanceKm: null,
  tripDurationMin: null,
  tripArrivalText: '',
  selectedFare: null,
  selectedVehicle: '',
  paymentMethod: 'pix',
  notificationsEnabled: true,
  trafficLayerEnabled: true,
  voiceGuidanceEnabled: false,
  driverInfo: null,
  driverCoordinate: null,
  driverOnline: false,
  driverActivation: DEFAULT_DRIVER_ACTIVATION,
  driverCanGoOnline: DEFAULT_DRIVER_ACTIVATION.canGoOnline,
  driverOffers: [],
  driverActiveRide: null,
  activeChatId: null,
  activeChatBookingId: null,
  chatMessages: [],
  chatLoading: false,
  chatSending: false,
  chatError: '',
  supportLoading: false,
  supportError: '',
  supportLastTicket: null,
  supportLastIncident: null,
  profileUid: null,
  profileName: '',
  riderProfile: {
    name: 'Ana Dias',
    phone: '+55 11 9 9999-9999',
    email: 'ana.dias@email.com',
    preference: 'Corridas silenciosas'
  },
  paymentState: {
    status: 'idle',
    paymentId: null,
    amount: 0,
    method: 'pix',
    error: ''
  },
  lastError: '',
  tripHistory: [],
  lastReceipt: null
});

let runtimeState = { ...DEFAULT_RUNTIME_STATE };
const runtimeListeners = new Set();
let runtimeBootstrapPromise = null;
let runtimeSearchTimer = null;
let runtimeSocketListenersAttached = false;
let runtimeChatListenersAttached = false;
let runtimeHeadingSubscription = null;
let runtimeHeadingWatcherStarted = false;

function createRuntimeNotification({ title, message, kind = 'system', scope = 'both', read = false }) {
  return {
    id: `notif-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: String(title || 'Atualização'),
    message: String(message || ''),
    kind,
    scope,
    read: Boolean(read),
    createdAt: new Date().toISOString()
  };
}

function appendRuntimeNotification(entry) {
  if (!entry || typeof entry !== 'object') {
    return;
  }

  setRuntimeState(previous => {
    const previousNotifications = Array.isArray(previous.notifications) ? previous.notifications : [];
    return {
      notifications: [entry, ...previousNotifications].slice(0, NOTIFICATION_LIMIT)
    };
  });
}

function markNotificationReadInState(notificationId) {
  if (!notificationId) {
    return;
  }

  setRuntimeState(previous => {
    const previousNotifications = Array.isArray(previous.notifications) ? previous.notifications : [];
    return {
      notifications: previousNotifications.map(item =>
        item.id === notificationId && !item.read
          ? {
              ...item,
              read: true
            }
          : item
      )
    };
  });
}

function markAllNotificationsReadInState() {
  setRuntimeState(previous => {
    const previousNotifications = Array.isArray(previous.notifications) ? previous.notifications : [];
    return {
      notifications: previousNotifications.map(item =>
        item.read
          ? item
          : {
              ...item,
              read: true
            }
      )
    };
  });
}

function resolveDriverActivationStorageKey(uid) {
  const key = String(uid || '').trim();
  return `${DRIVER_ACTIVATION_STORAGE_PREFIX}${key || 'anonymous'}`;
}

function mergeDriverActivation(a, b) {
  const stateA = computeDriverOnboardingState(a || createInitialDriverOnboardingState());
  const stateB = computeDriverOnboardingState(b || createInitialDriverOnboardingState());
  const dateA = new Date(stateA?.updatedAt || 0).getTime();
  const dateB = new Date(stateB?.updatedAt || 0).getTime();
  return dateB > dateA ? stateB : stateA;
}

async function loadPersistedDriverActivation(uid) {
  try {
    const raw = await AsyncStorage.getItem(resolveDriverActivationStorageKey(uid));
    if (!raw) {
      return computeDriverOnboardingState(createInitialDriverOnboardingState());
    }
    return computeDriverOnboardingState(JSON.parse(raw));
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] Falha ao carregar ativação do motorista:', error?.message || error);
    return computeDriverOnboardingState(createInitialDriverOnboardingState());
  }
}

async function persistDriverActivation(uid, activationState) {
  try {
    await AsyncStorage.setItem(
      resolveDriverActivationStorageKey(uid),
      JSON.stringify(computeDriverOnboardingState(activationState))
    );
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] Falha ao salvar ativação do motorista:', error?.message || error);
  }
}

function normalizeHeading(headingValue) {
  const heading = Number(headingValue);
  if (!Number.isFinite(heading)) {
    return null;
  }

  const normalized = heading % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function shouldUpdateHeading(nextHeading, previousHeading) {
  if (!Number.isFinite(nextHeading)) {
    return false;
  }

  if (!Number.isFinite(previousHeading)) {
    return true;
  }

  const delta = Math.abs(nextHeading - previousHeading);
  const circularDelta = Math.min(delta, 360 - delta);
  return circularDelta >= MIN_HEADING_DELTA_DEG;
}

async function startHeadingWatcher() {
  if (runtimeHeadingWatcherStarted) {
    return;
  }

  runtimeHeadingWatcherStarted = true;

  try {
    runtimeHeadingSubscription = await Location.watchHeadingAsync(headingData => {
      const nextHeading = normalizeHeading(headingData?.trueHeading ?? headingData?.magHeading);
      if (!Number.isFinite(nextHeading)) {
        return;
      }

      setRuntimeState(previous => {
        if (!shouldUpdateHeading(nextHeading, previous.currentHeading)) {
          return null;
        }

        return {
          currentHeading: nextHeading
        };
      });
    });
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] Heading em tempo real indisponível:', error?.message || error);
    runtimeHeadingWatcherStarted = false;
    runtimeHeadingSubscription = null;
  }
}

function notifyRuntime() {
  runtimeListeners.forEach(listener => {
    try {
      listener(runtimeState);
    } catch (error) {
      Logger.warn('⚠️ [PrototypeRuntime] Erro ao notificar listener:', error?.message || error);
    }
  });
}

function setRuntimeState(next) {
  const patch = typeof next === 'function' ? next(runtimeState) : next;
  if (!patch || typeof patch !== 'object') {
    return;
  }
  runtimeState = {
    ...runtimeState,
    ...patch
  };
  notifyRuntime();
}

function subscribeRuntime(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  runtimeListeners.add(listener);
  listener(runtimeState);

  return () => {
    runtimeListeners.delete(listener);
  };
}

function parseNameFromDescription(description = '') {
  const clean = String(description || '').trim();
  if (!clean) {
    return 'Destino';
  }

  const separator = clean.indexOf(' - ');
  if (separator > 0) {
    return clean.slice(0, separator).trim();
  }

  const comma = clean.indexOf(',');
  if (comma > 0) {
    return clean.slice(0, comma).trim();
  }

  return clean;
}

function parseAddressFromDescription(description = '') {
  const clean = String(description || '').trim();
  if (!clean) {
    return '';
  }

  const separator = clean.indexOf(' - ');
  if (separator > 0 && separator < clean.length - 3) {
    return clean.slice(separator + 3).trim();
  }

  const comma = clean.indexOf(',');
  if (comma > 0 && comma < clean.length - 2) {
    return clean.slice(comma + 1).trim();
  }

  return clean;
}

function normalizeDestinationItem(item) {
  const coordinate = item?.coordinate || (item?.lat && item?.lng ? { latitude: item.lat, longitude: item.lng } : null);
  const name = item?.name || item?.mainText || parseNameFromDescription(item?.description || item?.address || 'Destino');
  const address = item?.address || item?.secondaryText || parseAddressFromDescription(item?.description || name);

  return {
    id: item?.id || item?.place_id || `${name}-${address}`,
    name,
    address,
    eta: item?.eta || ' -- ',
    place_id: item?.place_id || item?.placeId || null,
    coordinate:
      coordinate && Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude)
        ? {
            latitude: Number(coordinate.latitude),
            longitude: Number(coordinate.longitude)
          }
        : null
  };
}

function formatCurrencyBR(value) {
  if (!Number.isFinite(Number(value))) {
    return 'R$ 0,00';
  }

  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

function sanitizeText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function buildDriverOffer({ bookingId, destination, fare, etaMinutes, pickupAddress, passengerName }) {
  const destinationName = sanitizeText(destination?.name, 'Destino');
  const destinationAddress = sanitizeText(destination?.address, destinationName);
  const nextEta = Number.isFinite(etaMinutes) && etaMinutes > 0 ? Math.max(2, Math.round(etaMinutes)) : 6;
  const payoutValue = Number.isFinite(Number(fare)) ? Number(fare) : 0;

  return {
    id: bookingId || `driver-offer-${Date.now()}`,
    bookingId: bookingId || null,
    passenger: sanitizeText(passengerName, 'Passageiro Leaf'),
    pickup: sanitizeText(pickupAddress, 'Origem atual'),
    dropoff: destinationName,
    dropoffAddress: destinationAddress,
    eta: `${nextEta} min`,
    payout: formatCurrencyBR(payoutValue),
    fare: payoutValue
  };
}

function mergeDriverOffers(previousOffers = [], incomingOffer) {
  if (!incomingOffer) {
    return previousOffers;
  }

  const all = [incomingOffer, ...previousOffers].filter(Boolean);
  const deduped = [];
  const seen = new Set();

  for (const item of all) {
    const key = item.bookingId || item.id;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function normalizeChatMessage(message) {
  const senderId = message?.senderId || message?.userId || message?.fromUserId || '';
  const messageText = sanitizeText(message?.message || message?.text, '');
  const timestampValue = message?.timestamp || message?.createdAt || message?.sentAt || new Date().toISOString();
  const timestampDate = new Date(timestampValue);
  const timestamp = Number.isNaN(timestampDate.getTime()) ? new Date().toISOString() : timestampDate.toISOString();
  const messageId = message?.messageId || message?.id || `msg-${timestamp}-${Math.random().toString(16).slice(2, 9)}`;
  const isYou = runtimeState.profileUid && senderId && senderId === runtimeState.profileUid;

  return {
    id: String(messageId),
    text: messageText,
    senderId: senderId || null,
    author: isYou ? 'you' : 'driver',
    timestamp
  };
}

function mergeChatMessages(existing = [], incoming = []) {
  const map = new Map();

  [...existing, ...incoming].forEach(raw => {
    const item = normalizeChatMessage(raw);
    if (!item.text) {
      return;
    }

    map.set(String(item.id), item);
  });

  return Array.from(map.values())
    .sort((left, right) => {
      const leftTime = new Date(left.timestamp).getTime();
      const rightTime = new Date(right.timestamp).getTime();
      return leftTime - rightTime;
    })
    .slice(-CHAT_MESSAGE_LIMIT);
}

function getOriginCoordinate() {
  return runtimeState.currentCoordinate || {
    latitude: PROTOTYPE_ORIGIN_COORDINATE.latitude,
    longitude: PROTOTYPE_ORIGIN_COORDINATE.longitude
  };
}

function stopSearchingTimer() {
  if (runtimeSearchTimer) {
    clearInterval(runtimeSearchTimer);
    runtimeSearchTimer = null;
  }
}

function startSearchingTimer() {
  stopSearchingTimer();
  setRuntimeState({ searchingElapsedSeconds: 0 });

  runtimeSearchTimer = setInterval(() => {
    setRuntimeState(previous => {
      if (previous.bookingStatus !== 'searching' && previous.bookingStatus !== 'requesting') {
        stopSearchingTimer();
        return previous;
      }

      return {
        searchingElapsedSeconds: (previous.searchingElapsedSeconds || 0) + 1
      };
    });
  }, SEARCH_TIMER_INTERVAL_MS);
}

function pushTripHistoryItem(receipt) {
  if (!receipt) {
    return;
  }

  setRuntimeState(previous => {
    const nextHistory = [receipt, ...(previous.tripHistory || [])].slice(0, TRIP_HISTORY_LIMIT);
    return {
      tripHistory: nextHistory,
      lastReceipt: receipt
    };
  });
}

function decodePolylineToCoordinates(polylinePoints) {
  if (!polylinePoints) {
    return [];
  }

  try {
    const decoded = polyline.decode(polylinePoints);
    if (!Array.isArray(decoded) || decoded.length < 2) {
      return [];
    }

    return decoded.map(([latitude, longitude]) => ({
      latitude,
      longitude
    }));
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] Falha ao decodificar polyline:', error?.message || error);
    return [];
  }
}

async function ensureCurrentLocation() {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      return;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      maximumAge: 10000,
      timeout: 12000
    });

    const latitude = Number(position?.coords?.latitude);
    const longitude = Number(position?.coords?.longitude);
    const currentHeading = normalizeHeading(position?.coords?.heading);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    let currentAddress = '';
    try {
      const reverse = await Location.reverseGeocodeAsync({ latitude, longitude });
      const first = Array.isArray(reverse) && reverse.length > 0 ? reverse[0] : null;
      if (first) {
        currentAddress = [first.name, first.street, first.city].filter(Boolean).join(', ');
      }
    } catch (reverseError) {
      Logger.warn('⚠️ [PrototypeRuntime] Reverse geocode indisponível:', reverseError?.message || reverseError);
    }

    setRuntimeState({
      currentCoordinate: { latitude, longitude },
      ...(Number.isFinite(currentHeading) ? { currentHeading } : {}),
      currentAddress: currentAddress || runtimeState.currentAddress
    });

    await startHeadingWatcher();
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] Não foi possível obter localização atual:', error?.message || error);
  }
}

function attachSocketListeners() {
  if (runtimeSocketListenersAttached) {
    return;
  }

  const socket = WebSocketManager.getInstance();

  const handleConnect = () => {
    setRuntimeState({
      connecting: false,
      isSocketConnected: true,
      socketError: ''
    });
  };

  const handleDisconnect = () => {
    setRuntimeState({
      isSocketConnected: false,
      isSocketAuthenticated: false
    });
  };

  const handleConnectError = error => {
    setRuntimeState({
      connecting: false,
      isSocketConnected: false,
      socketError: error?.message || 'Erro de conexão no socket'
    });
  };

  const handleAuthenticated = () => {
    setRuntimeState({
      connecting: false,
      isSocketAuthenticated: true,
      socketError: ''
    });
  };

  const handleBookingCreated = payload => {
    if (!payload?.success) {
      return;
    }

    const bookingId = payload.bookingId || payload?.data?.bookingId || payload?.booking?.bookingId || null;
    const serverBooking = payload?.booking || payload?.data || null;
    const selectedFare = Number(serverBooking?.estimatedFare || runtimeState.selectedFare || 0);
    const destination = normalizeDestinationItem({
      name:
        runtimeState.selectedDestination?.name ||
        parseNameFromDescription(serverBooking?.destinationLocation?.add || ''),
      address: runtimeState.selectedDestination?.address || serverBooking?.destinationLocation?.add || ''
    });
    const createdOffer = buildDriverOffer({
      bookingId,
      destination,
      fare: selectedFare,
      etaMinutes: runtimeState.tripDurationMin,
      pickupAddress: serverBooking?.pickupLocation?.add || runtimeState.currentAddress,
      passengerName: runtimeState.profileName
    });

    setRuntimeState({
      bookingStatus: 'searching',
      activeBookingId: bookingId,
      activeBooking: serverBooking,
      selectedFare: Number.isFinite(selectedFare) ? selectedFare : runtimeState.selectedFare,
      driverOffers: mergeDriverOffers(runtimeState.driverOffers, createdOffer),
      driverActiveRide: null,
      lastError: '',
      socketError: ''
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: 'Corrida solicitada',
        message: 'Estamos procurando motoristas próximos da sua localização.',
        kind: 'trip',
        scope: 'passenger'
      })
    );
    startSearchingTimer();
  };

  const handleBookingError = payload => {
    const errorMessage = payload?.message || payload?.error || 'Não foi possível criar a corrida';
    stopSearchingTimer();
    setRuntimeState({
      bookingStatus: 'idle',
      activeBookingId: null,
      activeBooking: null,
      driverOffers: [],
      driverActiveRide: null,
      paymentState: {
        status: 'failed',
        paymentId: null,
        amount: 0,
        method: runtimeState.paymentMethod || 'pix',
        error: errorMessage
      },
      lastError: errorMessage
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: 'Falha na solicitação',
        message: errorMessage,
        kind: 'warning',
        scope: 'passenger'
      })
    );
  };

  const handleNoDriversFound = payload => {
    const noDriversMessage = payload?.message || 'Nenhum motorista disponível no momento.';
    stopSearchingTimer();
    setRuntimeState({
      bookingStatus: 'idle',
      driverOffers: [],
      driverActiveRide: null,
      paymentState: {
        status: 'idle',
        paymentId: null,
        amount: 0,
        method: runtimeState.paymentMethod || 'pix',
        error: ''
      },
      lastError: noDriversMessage
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: 'Sem motoristas',
        message: noDriversMessage,
        kind: 'warning',
        scope: 'passenger'
      })
    );
  };

  const handleDriversFound = () => {
    setRuntimeState({
      bookingStatus: 'searching',
      lastError: ''
    });
  };

  const handleRideAccepted = payload => {
    const driver = payload?.driver || {};
    const lat = Number(driver?.location?.lat || payload?.location?.lat);
    const lng = Number(driver?.location?.lng || payload?.location?.lng);
    const coordinate = Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;

    stopSearchingTimer();
    setRuntimeState({
      bookingStatus: 'accepted',
      driverInfo: {
        id: driver?.id || payload?.driverId || null,
        name: driver?.name || payload?.driverName || 'Motorista',
        plate: driver?.vehicle?.plate || payload?.vehicle?.plate || '',
        model: driver?.vehicle?.model || payload?.vehicle?.model || '',
        rating: driver?.rating || payload?.rating || null
      },
      driverOffers: (runtimeState.driverOffers || []).filter(item => (item.bookingId || item.id) !== runtimeState.activeBookingId),
      driverActiveRide:
        runtimeState.driverActiveRide ||
        buildDriverOffer({
          bookingId: runtimeState.activeBookingId,
          destination: runtimeState.selectedDestination,
          fare: runtimeState.selectedFare,
          etaMinutes: runtimeState.tripDurationMin,
          pickupAddress: runtimeState.currentAddress,
          passengerName: runtimeState.profileName
        }),
      driverCoordinate: coordinate || runtimeState.driverCoordinate,
      lastError: ''
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: 'Motorista a caminho',
        message: 'Seu motorista aceitou a corrida e está indo para o embarque.',
        kind: 'trip',
        scope: 'passenger'
      })
    );
  };

  const handleTripStarted = () => {
    setRuntimeState({
      bookingStatus: 'started',
      driverActiveRide: runtimeState.driverActiveRide
        ? {
            ...runtimeState.driverActiveRide,
            status: 'started'
          }
        : runtimeState.driverActiveRide,
      lastError: ''
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: 'Viagem iniciada',
        message: 'Seu trajeto foi iniciado.',
        kind: 'trip',
        scope: 'both'
      })
    );
  };

  const handleDriverLocation = payload => {
    const lat = Number(payload?.location?.lat);
    const lng = Number(payload?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }

    setRuntimeState({
      driverCoordinate: { latitude: lat, longitude: lng }
    });
  };

  const handleTripCompleted = payload => {
    stopSearchingTimer();

    const finalFare = Number(
      payload?.fare ||
        payload?.amount ||
        runtimeState.selectedFare ||
        runtimeState.activeBooking?.estimatedFare ||
        0
    );
    const distance = Number(payload?.distance || runtimeState.tripDistanceKm || 0);
    const durationSeconds = Number(payload?.duration || 0);
    const durationMinutes = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds / 60) : runtimeState.tripDurationMin || 0;

    const receipt = {
      id: payload?.bookingId || runtimeState.activeBookingId || `proto-${Date.now()}`,
      date: new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      route:
        runtimeState.selectedDestination?.name && runtimeState.currentAddress
          ? `${runtimeState.currentAddress} -> ${runtimeState.selectedDestination.name}`
          : runtimeState.selectedDestination?.name || 'Corrida finalizada',
      value: `R$ ${finalFare.toFixed(2)}`,
      fare: finalFare,
      distanceKm: Number.isFinite(distance) ? distance : 0,
      durationMin: Number.isFinite(durationMinutes) ? durationMinutes : 0,
      baseFare: Number((finalFare * 0.55).toFixed(2)),
      variableFare: Number((finalFare * 0.45).toFixed(2))
    };

    setRuntimeState({
      bookingStatus: 'completed',
      activeBooking: null,
      activeBookingId: null,
      driverOffers: [],
      driverActiveRide: null,
      tripDistanceKm: receipt.distanceKm,
      tripDurationMin: receipt.durationMin,
      tripArrivalText: '',
      driverInfo: runtimeState.driverInfo,
      driverCoordinate: null,
      lastError: ''
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: 'Viagem concluída',
        message: 'Confira seu recibo e avalie a experiência.',
        kind: 'trip',
        scope: 'both'
      })
    );

    pushTripHistoryItem(receipt);
  };

  const handleRideCancelled = payload => {
    const cancelMessage = payload?.message || 'Corrida cancelada.';
    stopSearchingTimer();
    setRuntimeState({
      bookingStatus: 'idle',
      activeBooking: null,
      activeBookingId: null,
      driverOffers: [],
      driverActiveRide: null,
      paymentState: {
        status: 'idle',
        paymentId: null,
        amount: 0,
        method: runtimeState.paymentMethod || 'pix',
        error: ''
      },
      driverInfo: null,
      driverCoordinate: null,
      lastError: cancelMessage
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: 'Corrida cancelada',
        message: cancelMessage,
        kind: 'warning',
        scope: 'both'
      })
    );
  };

  const handlePaymentConfirmed = () => {
    setRuntimeState({ lastError: '' });
  };

  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('connect_error', handleConnectError);
  socket.on('authenticated', handleAuthenticated);
  socket.on('bookingCreated', handleBookingCreated);
  socket.on('bookingError', handleBookingError);
  socket.on('driversFound', handleDriversFound);
  socket.on('noDriversFound', handleNoDriversFound);
  socket.on('rideAccepted', handleRideAccepted);
  socket.on('driverAccepted', handleRideAccepted);
  socket.on('tripStarted', handleTripStarted);
  socket.on('driverLocation', handleDriverLocation);
  socket.on('tripCompleted', handleTripCompleted);
  socket.on('rideCancelled', handleRideCancelled);
  socket.on('paymentConfirmed', handlePaymentConfirmed);

  runtimeSocketListenersAttached = true;
}

function attachChatListeners() {
  if (runtimeChatListenersAttached) {
    return;
  }

  const socket = WebSocketManager.getInstance();

  const handleIncomingMessage = payload => {
    const incomingChatId = payload?.chatId || payload?.bookingId || null;
    if (!incomingChatId) {
      return;
    }

    if (!runtimeState.activeChatId && !runtimeState.activeChatBookingId) {
      return;
    }

    if (runtimeState.activeChatId && incomingChatId !== runtimeState.activeChatId && incomingChatId !== runtimeState.activeChatBookingId) {
      return;
    }

    const normalized = normalizeChatMessage(payload);
    if (!normalized.text) {
      return;
    }

    setRuntimeState(previous => ({
      chatMessages: mergeChatMessages(previous.chatMessages, [normalized]),
      chatError: ''
    }));
  };

  socket.on('newMessage', handleIncomingMessage);
  socket.on('messageReceived', handleIncomingMessage);
  runtimeChatListenersAttached = true;
}

async function ensureSocketReady(profile) {
  const userId = profile?.uid;
  if (!userId) {
    setRuntimeState({
      isSocketConnected: false,
      isSocketAuthenticated: false,
      socketError: 'Usuário não autenticado para conectar serviços em tempo real.'
    });
    return false;
  }

  const socket = WebSocketManager.getInstance();

  try {
    setRuntimeState({
      connecting: true,
      socketError: ''
    });

    attachSocketListeners();
    attachChatListeners();

    if (!socket.isConnected()) {
      await socket.connect();
    }

    const status = socket.getConnectionStatus();
    const authenticatedAsCurrentUser =
      Boolean(status?.authenticated) &&
      status?.userId === userId &&
      (status?.userType === USER_TYPE || !status?.userType);

    if (!authenticatedAsCurrentUser) {
      try {
        await socket.authenticateWithAck(userId, USER_TYPE, 12000);
      } catch (error) {
        socket.authenticate(userId, USER_TYPE);
      }
    }

    setRuntimeState({
      connecting: false,
      isSocketConnected: true,
      isSocketAuthenticated: true,
      socketError: ''
    });
    return true;
  } catch (error) {
    setRuntimeState({
      connecting: false,
      isSocketConnected: socket.isConnected(),
      isSocketAuthenticated: false,
      socketError: error?.message || 'Falha ao conectar serviço de corridas.'
    });
    return false;
  }
}

async function bootstrapRuntime(profile) {
  if (runtimeBootstrapPromise) {
    return runtimeBootstrapPromise;
  }

  runtimeBootstrapPromise = (async () => {
    setRuntimeState({ initializing: true });
    await ensureCurrentLocation();
    if (profile?.uid) {
      await ensureSocketReady(profile);
    }
    setRuntimeState({
      initializing: false,
      ready: true
    });
  })();

  try {
    await runtimeBootstrapPromise;
  } finally {
    runtimeBootstrapPromise = null;
  }
}

async function resolveDestinationCoordinate(destination) {
  if (
    destination?.coordinate &&
    Number.isFinite(destination.coordinate.latitude) &&
    Number.isFinite(destination.coordinate.longitude)
  ) {
    return destination;
  }

  if (!destination?.place_id) {
    return destination;
  }

  try {
    const details = await fetchCoordsfromPlace(destination.place_id);
    if (!Number.isFinite(details?.lat) || !Number.isFinite(details?.lng)) {
      return destination;
    }

    return {
      ...destination,
      name: destination.name || details?.name || destination.address || 'Destino',
      address: destination.address || details?.formatted_address || '',
      coordinate: {
        latitude: Number(details.lat),
        longitude: Number(details.lng)
      }
    };
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] Falha ao resolver coordenadas do destino:', error?.message || error);
    return destination;
  }
}

async function previewDestinationOnMap(destination) {
  if (!destination?.coordinate) {
    clearPrototypeMapRoute();
    return;
  }

  const origin = getOriginCoordinate();
  let coordinates = null;

  try {
    const startLoc = `${origin.latitude},${origin.longitude}`;
    const destLoc = `${destination.coordinate.latitude},${destination.coordinate.longitude}`;
    const route = await getDirectionsApi(startLoc, destLoc);
    coordinates = decodePolylineToCoordinates(route?.polylinePoints);

    if (route?.distance_in_km || route?.time_in_secs) {
      const distance = Number(route.distance_in_km || 0);
      const durationMinutes = Number(route.time_in_secs || 0) / 60;
      const etaDate = new Date();
      etaDate.setMinutes(etaDate.getMinutes() + Math.max(1, Math.round(durationMinutes)));

      setRuntimeState({
        tripDistanceKm: Number(distance.toFixed(1)),
        tripDurationMin: Math.max(1, Math.round(durationMinutes)),
        tripArrivalText: etaDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      });
    }
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] Não foi possível calcular rota real, usando fallback curvo.');
  }

  setPrototypeMapRoute({
    origin,
    destination: destination.coordinate,
    destinationLabel: destination.name,
    destinationAddress: destination.address,
    coordinates
  });
}

async function findDestinations(query) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    return DESTINATION_HISTORY.map(item => normalizeDestinationItem(item));
  }

  const location = runtimeState.currentCoordinate
    ? { lat: runtimeState.currentCoordinate.latitude, lng: runtimeState.currentCoordinate.longitude }
    : null;

  const predictions = await fetchPlacesAutocomplete(normalizedQuery, `proto-${Date.now()}`, location);
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return [];
  }

  return predictions.slice(0, 8).map(item => {
    const description = item?.description || '';
    return normalizeDestinationItem({
      id: item?.place_id || description,
      place_id: item?.place_id || null,
      name: item?.structured_formatting?.main_text || parseNameFromDescription(description),
      address: item?.structured_formatting?.secondary_text || parseAddressFromDescription(description),
      description,
      coordinate:
        item?.location && Number.isFinite(item.location?.lat) && Number.isFinite(item.location?.lng)
          ? {
              latitude: Number(item.location.lat),
              longitude: Number(item.location.lng)
            }
          : null
    });
  });
}

async function requestPrototypeRide(profile, payload) {
  const destinationInput = normalizeDestinationItem(payload?.destination || runtimeState.selectedDestination || {});
  const destination = await resolveDestinationCoordinate(destinationInput);

  if (!destination?.coordinate) {
    throw new Error('Destino sem coordenadas válidas.');
  }

  const userId = profile?.uid;
  if (!userId) {
    throw new Error('Usuário não autenticado para solicitar corrida.');
  }

  const socketReady = await ensureSocketReady(profile);
  if (!socketReady) {
    throw new Error(runtimeState.socketError || 'Serviço de corridas indisponível.');
  }

  const origin = getOriginCoordinate();
  const vehicle = payload?.vehicle || runtimeState.selectedVehicle || 'Leaf Plus';
  const fare = Number(payload?.fare ?? runtimeState.selectedFare ?? 0);
  const paymentMethod = payload?.paymentMethod || runtimeState.paymentMethod || 'pix';

  const bookingData = {
    customerId: userId,
    pickupLocation: {
      lat: Number(origin.latitude),
      lng: Number(origin.longitude),
      add: runtimeState.currentAddress || 'Origem atual'
    },
    destinationLocation: {
      lat: Number(destination.coordinate.latitude),
      lng: Number(destination.coordinate.longitude),
      add: destination.address || destination.name || 'Destino'
    },
    estimatedFare: Number.isFinite(fare) ? fare : 0,
    carType: vehicle,
    paymentMethod,
    paymentStatus: 'confirmed'
  };
  const provisionalOffer = buildDriverOffer({
    bookingId: runtimeState.activeBookingId || `pending-${Date.now()}`,
    destination,
    fare,
    etaMinutes: runtimeState.tripDurationMin,
    pickupAddress: runtimeState.currentAddress,
    passengerName: runtimeState.profileName
  });

  setRuntimeState({
    bookingStatus: 'requesting',
    selectedDestination: destination,
    selectedFare: Number.isFinite(fare) ? fare : runtimeState.selectedFare,
    selectedVehicle: vehicle,
    paymentMethod,
    paymentState: {
      status: 'processing',
      paymentId: null,
      amount: Number.isFinite(fare) ? fare : 0,
      method: paymentMethod,
      error: ''
    },
    driverOffers: mergeDriverOffers(runtimeState.driverOffers, provisionalOffer),
    driverActiveRide: null,
    activeChatId: null,
    activeChatBookingId: null,
    chatMessages: [],
    chatError: '',
    lastError: ''
  });
  startSearchingTimer();

  const socket = WebSocketManager.getInstance();
  const response = await socket.createBooking(bookingData);
  const bookingId = response?.bookingId || response?.data?.bookingId || response?.booking?.bookingId || null;
  const paymentId = `proto-pay-${Date.now()}`;

  let paymentError = '';
  if (bookingId && Number.isFinite(fare) && fare > 0) {
    try {
      await socket.confirmPayment(bookingId, paymentMethod, paymentId, fare);
    } catch (error) {
      paymentError = error?.message || 'Pagamento não confirmado em tempo real.';
      Logger.warn('⚠️ [PrototypeRuntime] confirmPayment remoto falhou, seguindo fluxo:', paymentError);
    }
  }

  setRuntimeState({
    bookingStatus: 'searching',
    activeBookingId: bookingId,
    activeBooking: response?.booking || response?.data || null,
    driverOffers: mergeDriverOffers(runtimeState.driverOffers, {
      ...provisionalOffer,
      id: bookingId || provisionalOffer.id,
      bookingId: bookingId || provisionalOffer.bookingId
    }),
    paymentState: {
      status: paymentError ? 'pending' : 'confirmed',
      paymentId: bookingId ? paymentId : null,
      amount: Number.isFinite(fare) ? fare : 0,
      method: paymentMethod,
      error: paymentError
    },
    lastError: ''
  });

  return {
    success: true,
    bookingId,
    raw: response
  };
}

async function cancelPrototypeRide() {
  const bookingId = runtimeState.activeBookingId;
  if (bookingId) {
    try {
      const socket = WebSocketManager.getInstance();
      if (socket.isConnected()) {
        await socket.cancelRide(bookingId, 'Cancelado pelo passageiro no protótipo.');
      }
    } catch (error) {
      Logger.warn('⚠️ [PrototypeRuntime] Falha ao cancelar corrida no backend:', error?.message || error);
    }
  }

  stopSearchingTimer();
    setRuntimeState({
      bookingStatus: 'idle',
      activeBookingId: null,
      activeBooking: null,
      driverOffers: [],
      driverActiveRide: null,
      paymentState: {
        status: 'idle',
        paymentId: null,
        amount: 0,
        method: runtimeState.paymentMethod || 'pix',
        error: ''
      },
      driverInfo: null,
      driverCoordinate: null,
      searchingElapsedSeconds: 0,
    lastError: ''
  });
}

async function startPrototypeTrip() {
  const bookingId = runtimeState.activeBookingId;
  if (!bookingId) {
    setRuntimeState({
      bookingStatus: 'started',
      driverActiveRide: runtimeState.driverActiveRide
        ? {
            ...runtimeState.driverActiveRide,
            status: 'started'
          }
        : runtimeState.driverActiveRide
    });
    return { success: true, localOnly: true };
  }

  try {
    const socket = WebSocketManager.getInstance();
    if (socket.isConnected()) {
      const startLocation = {
        lat: runtimeState.driverCoordinate?.latitude || runtimeState.currentCoordinate.latitude,
        lng: runtimeState.driverCoordinate?.longitude || runtimeState.currentCoordinate.longitude
      };
      await socket.startTrip(bookingId, startLocation);
    }
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] startTrip remoto falhou, mantendo fluxo local:', error?.message || error);
  }

  setRuntimeState({
    bookingStatus: 'started',
    driverActiveRide: runtimeState.driverActiveRide
      ? {
          ...runtimeState.driverActiveRide,
          status: 'started'
        }
      : runtimeState.driverActiveRide
  });
  return { success: true };
}

async function completePrototypeTrip() {
  const bookingId = runtimeState.activeBookingId;
  const fare = Number(runtimeState.selectedFare || runtimeState.activeBooking?.estimatedFare || 0);
  const distanceKm = Number(runtimeState.tripDistanceKm || 0);

  if (bookingId) {
    try {
      const socket = WebSocketManager.getInstance();
      if (socket.isConnected()) {
        await socket.completeTrip(
          bookingId,
          {
            lat: runtimeState.currentCoordinate.latitude,
            lng: runtimeState.currentCoordinate.longitude
          },
          distanceKm,
          fare
        );
      }
    } catch (error) {
      Logger.warn('⚠️ [PrototypeRuntime] completeTrip remoto falhou, finalizando localmente:', error?.message || error);
    }
  }

  const fallbackReceipt = {
    id: bookingId || `local-${Date.now()}`,
    date: new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    route:
      runtimeState.selectedDestination?.name && runtimeState.currentAddress
        ? `${runtimeState.currentAddress} -> ${runtimeState.selectedDestination.name}`
        : runtimeState.selectedDestination?.name || 'Corrida finalizada',
    value: `R$ ${fare.toFixed(2)}`,
    fare,
    distanceKm,
    durationMin: runtimeState.tripDurationMin || 0,
    baseFare: Number((fare * 0.55).toFixed(2)),
    variableFare: Number((fare * 0.45).toFixed(2))
  };

  stopSearchingTimer();
  setRuntimeState({
    bookingStatus: 'completed',
    activeBookingId: null,
    activeBooking: null,
    driverOffers: [],
    driverActiveRide: null,
    paymentState: {
      status: 'settled',
      paymentId: runtimeState.paymentState?.paymentId || null,
      amount: fare,
      method: runtimeState.paymentMethod || 'pix',
      error: ''
    },
    driverCoordinate: null,
    searchingElapsedSeconds: 0
  });
  pushTripHistoryItem(fallbackReceipt);

  return {
    success: true,
    receipt: fallbackReceipt
  };
}

function updatePrototypeSettings(patch = {}) {
  const nextPatch = {};

  if (typeof patch.notificationsEnabled === 'boolean') {
    nextPatch.notificationsEnabled = patch.notificationsEnabled;
  }
  if (typeof patch.trafficLayerEnabled === 'boolean') {
    nextPatch.trafficLayerEnabled = patch.trafficLayerEnabled;
  }
  if (typeof patch.voiceGuidanceEnabled === 'boolean') {
    nextPatch.voiceGuidanceEnabled = patch.voiceGuidanceEnabled;
  }

  if (Object.keys(nextPatch).length > 0) {
    setRuntimeState(nextPatch);
  }
}

function updatePrototypeRiderProfile(patch = {}) {
  if (!patch || typeof patch !== 'object') {
    return;
  }

  setRuntimeState(previous => ({
    riderProfile: {
      ...previous.riderProfile,
      ...(typeof patch.name === 'string' ? { name: patch.name.trim() } : {}),
      ...(typeof patch.phone === 'string' ? { phone: patch.phone.trim() } : {}),
      ...(typeof patch.email === 'string' ? { email: patch.email.trim() } : {}),
      ...(typeof patch.preference === 'string' ? { preference: patch.preference.trim() } : {})
    }
  }));
}

function getRuntimeBookingId() {
  return runtimeState.activeBookingId || runtimeState.driverActiveRide?.bookingId || runtimeState.activeBooking?.bookingId || null;
}

async function getRealtimeSocket(profile, fallbackMessage = 'Serviço indisponível no momento.') {
  const ready = await ensureSocketReady(profile);
  if (!ready) {
    throw new Error(runtimeState.socketError || fallbackMessage);
  }

  return WebSocketManager.getInstance();
}

async function loadPrototypeChatSession(profile, forceReload = false) {
  const bookingId = getRuntimeBookingId();
  if (!bookingId) {
    setRuntimeState({
      activeChatId: null,
      activeChatBookingId: null,
      chatMessages: [],
      chatLoading: false,
      chatError: 'Inicie uma corrida para abrir o chat.'
    });
    return {
      success: false,
      bookingId: null,
      chatId: null,
      messages: []
    };
  }

  setRuntimeState({
    chatLoading: true,
    chatError: ''
  });

  try {
    const socket = await getRealtimeSocket(profile, 'Serviço de chat indisponível.');
    const shouldCreateChat =
      forceReload || !runtimeState.activeChatId || runtimeState.activeChatBookingId !== bookingId;

    let chatId = runtimeState.activeChatId;
    if (shouldCreateChat) {
      const chatResponse = await socket.createChat({
        bookingId,
        tripId: bookingId,
        participants: [profile?.uid, runtimeState.driverInfo?.id].filter(Boolean),
        type: 'trip_chat'
      });
      chatId = chatResponse?.chatId || chatResponse?.id || bookingId;
    }

    const messagesResponse = await socket.loadChatMessages(chatId, 0, CHAT_MESSAGE_LIMIT);
    const loadedMessages = Array.isArray(messagesResponse?.messages) ? messagesResponse.messages : [];
    const mergedMessages = mergeChatMessages(runtimeState.chatMessages, loadedMessages);

    setRuntimeState({
      activeChatId: chatId,
      activeChatBookingId: bookingId,
      chatMessages: mergedMessages,
      chatLoading: false,
      chatError: ''
    });

    return {
      success: true,
      bookingId,
      chatId,
      messages: mergedMessages,
      raw: messagesResponse
    };
  } catch (error) {
    setRuntimeState({
      chatLoading: false,
      chatError: error?.message || 'Não foi possível carregar o chat.'
    });
    throw error;
  }
}

async function sendPrototypeChatMessage(profile, text) {
  const messageText = sanitizeText(text, '');
  if (!messageText) {
    return {
      success: false,
      ignored: true
    };
  }

  const bookingId = getRuntimeBookingId();
  if (!bookingId) {
    throw new Error('Inicie uma corrida para enviar mensagens.');
  }

  const optimisticId = `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const optimisticMessage = {
    id: optimisticId,
    text: messageText,
    senderId: profile?.uid || runtimeState.profileUid || null,
    author: 'you',
    timestamp: new Date().toISOString()
  };

  setRuntimeState(previous => ({
    chatSending: true,
    chatError: '',
    chatMessages: mergeChatMessages(previous.chatMessages, [optimisticMessage])
  }));

  try {
    const socket = await getRealtimeSocket(profile, 'Serviço de chat indisponível.');
    const needsChatCreation = !runtimeState.activeChatId || runtimeState.activeChatBookingId !== bookingId;

    let chatId = runtimeState.activeChatId;
    if (needsChatCreation) {
      const chatResponse = await socket.createChat({
        bookingId,
        tripId: bookingId,
        participants: [profile?.uid, runtimeState.driverInfo?.id].filter(Boolean),
        type: 'trip_chat'
      });
      chatId = chatResponse?.chatId || chatResponse?.id || bookingId;
    }

    const response = await socket.sendMessage({
      chatId: chatId || bookingId,
      bookingId,
      tripId: bookingId,
      message: messageText,
      senderId: profile?.uid || runtimeState.profileUid || null,
      receiverId: runtimeState.driverInfo?.id || null,
      senderType: 'passenger',
      timestamp: new Date().toISOString(),
      messageType: 'text'
    });

    const confirmedId = response?.messageId || response?.id || optimisticId;
    const patchedMessages = runtimeState.chatMessages.map(item => {
      if (item.id !== optimisticId) {
        return item;
      }
      return {
        ...item,
        id: String(confirmedId)
      };
    });

    setRuntimeState({
      chatSending: false,
      activeChatId: chatId || bookingId,
      activeChatBookingId: bookingId,
      chatMessages: mergeChatMessages(patchedMessages, []),
      chatError: ''
    });

    return {
      success: true,
      chatId: chatId || bookingId,
      messageId: confirmedId,
      raw: response
    };
  } catch (error) {
    setRuntimeState({
      chatSending: false,
      chatError: error?.message || 'Não foi possível enviar a mensagem.'
    });
    throw error;
  }
}

async function createPrototypeSupportTicket(profile, payload = {}) {
  const description = sanitizeText(payload.description, '');
  if (!description) {
    throw new Error('Descreva o problema para abrir um ticket.');
  }

  setRuntimeState({
    supportLoading: true,
    supportError: ''
  });

  try {
    const socket = await getRealtimeSocket(profile, 'Serviço de suporte indisponível.');
    const type = sanitizeText(payload.type, 'support');
    const priority = sanitizeText(payload.priority, 'N3');
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const response = await socket.createSupportTicket(type, priority, description, attachments);
    const ticket = {
      id: response?.ticketId || response?.id || `ticket-${Date.now()}`,
      type,
      priority,
      description,
      createdAt: new Date().toISOString()
    };

    setRuntimeState({
      supportLoading: false,
      supportError: '',
      supportLastTicket: ticket
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: 'Ticket enviado',
        message: `Suporte recebeu sua solicitação (#${ticket.id}).`,
        kind: 'support',
        scope: 'both'
      })
    );

    return {
      success: true,
      ticket,
      raw: response
    };
  } catch (error) {
    setRuntimeState({
      supportLoading: false,
      supportError: error?.message || 'Não foi possível abrir o ticket.'
    });
    throw error;
  }
}

async function reportPrototypeIncident(profile, payload = {}) {
  const description = sanitizeText(payload.description, '');
  if (!description) {
    throw new Error('Descreva o incidente para continuar.');
  }

  setRuntimeState({
    supportLoading: true,
    supportError: ''
  });

  try {
    const socket = await getRealtimeSocket(profile, 'Serviço de segurança indisponível.');
    const type = sanitizeText(payload.type, 'incident');
    const location = runtimeState.currentCoordinate
      ? {
          lat: runtimeState.currentCoordinate.latitude,
          lng: runtimeState.currentCoordinate.longitude
        }
      : null;
    const response = await socket.reportIncident(type, description, [], location);
    const incident = {
      id: response?.incidentId || response?.id || `incident-${Date.now()}`,
      type,
      description,
      createdAt: new Date().toISOString()
    };

    setRuntimeState({
      supportLoading: false,
      supportError: '',
      supportLastIncident: incident
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: 'Incidente registrado',
        message: `Registro de segurança criado (#${incident.id}).`,
        kind: 'support',
        scope: 'both'
      })
    );

    return {
      success: true,
      incident,
      raw: response
    };
  } catch (error) {
    setRuntimeState({
      supportLoading: false,
      supportError: error?.message || 'Não foi possível registrar o incidente.'
    });
    throw error;
  }
}

async function syncDriverActivationWithProfile(profile) {
  const isDriverProfile = profile?.usertype === 'driver' || profile?.userType === 'driver';
  const uid = sanitizeText(profile?.uid, '');
  const persistedState = await loadPersistedDriverActivation(uid);

  if (!isDriverProfile) {
    const fallbackState = computeDriverOnboardingState(persistedState || createInitialDriverOnboardingState());
    setRuntimeState({
      driverActivation: fallbackState,
      driverCanGoOnline: fallbackState.canGoOnline,
      driverOnline: false
    });
    return fallbackState;
  }

  const profileState = computeDriverOnboardingState(profile?.driverActivation || createInitialDriverOnboardingState());
  const mergedState = mergeDriverActivation(profileState, persistedState);

  setRuntimeState(previous => {
    const existingNotifications = Array.isArray(previous.notifications) ? previous.notifications : [];
    const activationNotifications = Array.isArray(mergedState?.notifications) ? mergedState.notifications : [];
    const freshActivationNotifications = activationNotifications.filter(
      item => item?.id && !existingNotifications.some(existing => existing.id === item.id)
    );

    return {
      driverActivation: mergedState,
      driverCanGoOnline: Boolean(mergedState?.canGoOnline),
      notifications: [...freshActivationNotifications, ...existingNotifications].slice(0, NOTIFICATION_LIMIT)
    };
  });

  await persistDriverActivation(uid, mergedState);
  return mergedState;
}

async function updatePrototypeDriverActivation(profile, updater, { appendNotifications = true } = {}) {
  const current = computeDriverOnboardingState(runtimeState.driverActivation || createInitialDriverOnboardingState());
  const next = typeof updater === 'function' ? updater(current) : updater;
  const normalized = computeDriverOnboardingState(next || current);

  setRuntimeState({
    driverActivation: normalized,
    driverCanGoOnline: Boolean(normalized?.canGoOnline),
    ...(normalized?.canGoOnline ? {} : { driverOnline: false })
  });

  const uid = sanitizeText(profile?.uid, '');
  await persistDriverActivation(uid, normalized);

  if (appendNotifications && Array.isArray(normalized.notifications) && normalized.notifications.length > 0) {
    const latestNotification = normalized.notifications[0];
    const alreadyExists = (runtimeState.notifications || []).some(item => item.id === latestNotification.id);
    if (!alreadyExists) {
      appendRuntimeNotification(latestNotification);
    }
  }

  return normalized;
}

async function setPrototypeDriverOnline(profile, isOnline) {
  const nextOnline = Boolean(isOnline);

  if (nextOnline) {
    const activationState = computeDriverOnboardingState(runtimeState.driverActivation || createInitialDriverOnboardingState());
    if (!activationState?.canGoOnline) {
      appendRuntimeNotification(
        createRuntimeNotification({
          title: 'Ativação pendente',
          message: 'Conclua as etapas de ativação do motorista antes de ficar online.',
          kind: 'driver',
          scope: 'driver'
        })
      );

      setRuntimeState({
        driverOnline: false,
        driverCanGoOnline: false,
        lastError: 'Ativação do motorista pendente.'
      });

      return {
        success: false,
        blocked: true,
        reason: 'Ativação do motorista pendente.'
      };
    }
  }

  setRuntimeState({
    driverOnline: nextOnline,
    lastError: ''
  });

  if (!profile?.uid) {
    return {
      success: true,
      localOnly: true,
      isOnline: nextOnline
    };
  }

  try {
    const socket = await getRealtimeSocket(profile, 'Serviço do motorista indisponível.');
    await socket.setDriverStatus(profile.uid, nextOnline ? 'available' : 'offline', nextOnline);
    return {
      success: true,
      isOnline: nextOnline
    };
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] setDriverStatus remoto falhou, mantendo estado local:', error?.message || error);
    return {
      success: false,
      isOnline: nextOnline,
      error: error?.message || 'Falha ao atualizar status remoto'
    };
  }
}

function resolveOfferInput(offerInput = null) {
  const bookingKey = offerInput?.bookingId || offerInput?.id || runtimeState.activeBookingId || null;
  if (!bookingKey) {
    return null;
  }

  const fromQueue = (runtimeState.driverOffers || []).find(item => (item.bookingId || item.id) === bookingKey) || null;
  if (fromQueue) {
    return fromQueue;
  }

  return offerInput;
}

async function acceptPrototypeDriverOffer(profile, offerInput = null) {
  const offer = resolveOfferInput(offerInput);
  const bookingId = offer?.bookingId || runtimeState.activeBookingId;
  if (!bookingId) {
    throw new Error('Nenhuma oferta pendente para aceitar.');
  }

  const driverName = sanitizeText(profile?.name || profile?.firstName, 'Motorista Leaf');
  const driverId = sanitizeText(profile?.uid, `driver-${Date.now()}`);
  const driverCoordinate = runtimeState.driverCoordinate || runtimeState.currentCoordinate || getOriginCoordinate();
  const vehicleModel = sanitizeText(profile?.vehicleModel, 'Leaf Plus');
  const vehiclePlate = sanitizeText(profile?.vehiclePlate, 'LEF-2042');

  try {
    const socket = await getRealtimeSocket(profile, 'Serviço de aceite indisponível.');
    await socket.acceptRide(bookingId, {
      driverId,
      driverName,
      driver: {
        id: driverId,
        name: driverName,
        location: {
          lat: driverCoordinate.latitude,
          lng: driverCoordinate.longitude
        },
        vehicle: {
          model: vehicleModel,
          plate: vehiclePlate
        }
      },
      location: {
        lat: driverCoordinate.latitude,
        lng: driverCoordinate.longitude
      },
      vehicle: {
        model: vehicleModel,
        plate: vehiclePlate
      }
    });
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] acceptRide remoto falhou, mantendo fluxo local:', error?.message || error);
  }

  const activeRide = offer || buildDriverOffer({
    bookingId,
    destination: runtimeState.selectedDestination,
    fare: runtimeState.selectedFare,
    etaMinutes: runtimeState.tripDurationMin,
    pickupAddress: runtimeState.currentAddress,
    passengerName: runtimeState.profileName
  });

  setRuntimeState(previous => ({
    bookingStatus: 'accepted',
    activeBookingId: bookingId,
    driverInfo: {
      id: driverId,
      name: driverName,
      plate: vehiclePlate,
      model: vehicleModel,
      rating: Number(profile?.rating || 4.9)
    },
    driverCoordinate,
    driverOffers: (previous.driverOffers || []).filter(item => (item.bookingId || item.id) !== bookingId),
    driverActiveRide: {
      ...activeRide,
      bookingId,
      status: 'accepted'
    },
    lastError: ''
  }));
  appendRuntimeNotification(
    createRuntimeNotification({
      title: 'Corrida aceita',
      message: 'Você assumiu uma nova corrida no painel do motorista.',
      kind: 'driver',
      scope: 'driver'
    })
  );

  return {
    success: true,
    bookingId,
    ride: activeRide
  };
}

async function rejectPrototypeDriverOffer(profile, offerInput = null, reason = 'Motorista indisponível') {
  const offer = resolveOfferInput(offerInput);
  const bookingId = offer?.bookingId || runtimeState.activeBookingId;
  if (!bookingId) {
    throw new Error('Nenhuma oferta pendente para recusar.');
  }

  try {
    const socket = await getRealtimeSocket(profile, 'Serviço de recusa indisponível.');
    await socket.rejectRide(bookingId, reason);
  } catch (error) {
    Logger.warn('⚠️ [PrototypeRuntime] rejectRide remoto falhou, mantendo fluxo local:', error?.message || error);
  }

  if (runtimeState.activeBookingId === bookingId) {
    stopSearchingTimer();
  }

  setRuntimeState(previous => {
    const isActiveBooking = previous.activeBookingId === bookingId;

    return {
      driverOffers: (previous.driverOffers || []).filter(item => (item.bookingId || item.id) !== bookingId),
      driverActiveRide:
        previous.driverActiveRide?.bookingId === bookingId ? null : previous.driverActiveRide,
      bookingStatus: isActiveBooking ? 'idle' : previous.bookingStatus,
      activeBookingId: isActiveBooking ? null : previous.activeBookingId,
      activeBooking: isActiveBooking ? null : previous.activeBooking,
      driverInfo: isActiveBooking ? null : previous.driverInfo,
      driverCoordinate: isActiveBooking ? null : previous.driverCoordinate,
      searchingElapsedSeconds: isActiveBooking ? 0 : previous.searchingElapsedSeconds,
      lastError: reason || previous.lastError
    };
  });
  appendRuntimeNotification(
    createRuntimeNotification({
      title: 'Corrida recusada',
      message: reason || 'A oferta foi recusada no painel do motorista.',
      kind: 'driver',
      scope: 'driver'
    })
  );

  return {
    success: true,
    bookingId
  };
}

function clearDestinationPreview() {
  clearPrototypeMapRoute();
  setRuntimeState({
    selectedDestination: null,
    tripDistanceKm: null,
    tripDurationMin: null,
    tripArrivalText: ''
  });
}

export function usePrototypeRideRuntime() {
  const authProfile = useSelector(state => state?.auth?.profile);
  const authUid = useSelector(state => state?.auth?.uid);
  const [snapshot, setSnapshot] = useState(runtimeState);

  const profile = useMemo(() => {
    if (!authProfile) {
      return null;
    }

    return {
      ...authProfile,
      uid: authProfile.uid || authUid || null
    };
  }, [authProfile, authUid]);

  const unreadNotificationCount = useMemo(() => {
    if (!Array.isArray(snapshot.notifications)) {
      return 0;
    }
    return snapshot.notifications.filter(item => !item.read).length;
  }, [snapshot.notifications]);

  useEffect(() => {
    return subscribeRuntime(setSnapshot);
  }, []);

  useEffect(() => {
    const incomingName = sanitizeText(profile?.name || profile?.firstName, '');
    const incomingEmail = sanitizeText(profile?.email, '');
    const incomingPhone = sanitizeText(profile?.phoneNumber || profile?.phone, '');

    setRuntimeState(previous => ({
      profileUid: profile?.uid || null,
      profileName: incomingName,
      riderProfile: {
        ...previous.riderProfile,
        ...(incomingName ? { name: incomingName } : {}),
        ...(incomingEmail ? { email: incomingEmail } : {}),
        ...(incomingPhone ? { phone: incomingPhone } : {})
      }
    }));
  }, [profile?.email, profile?.firstName, profile?.name, profile?.phone, profile?.phoneNumber, profile?.uid]);

  useEffect(() => {
    syncDriverActivationWithProfile(profile).catch(error => {
      Logger.warn('⚠️ [PrototypeRuntime] Falha ao sincronizar ativação do motorista:', error?.message || error);
    });
  }, [profile?.uid, profile?.usertype, profile?.userType]);

  useEffect(() => {
    if (!runtimeState.ready && !runtimeState.initializing) {
      bootstrapRuntime(profile).catch(error => {
        Logger.warn('⚠️ [PrototypeRuntime] Falha no bootstrap:', error?.message || error);
      });
      return;
    }

    if (profile?.uid) {
      ensureSocketReady(profile).catch(error => {
        Logger.warn('⚠️ [PrototypeRuntime] Falha ao garantir conexão:', error?.message || error);
      });
    }
  }, [profile, profile?.uid]);

  const loadDestinationSuggestions = useCallback(async query => {
    const results = await findDestinations(query);
    return results.map(item => normalizeDestinationItem(item));
  }, []);

  const selectDestination = useCallback(async destination => {
    const normalized = normalizeDestinationItem(destination || {});
    const resolved = await resolveDestinationCoordinate(normalized);
    await previewDestinationOnMap(resolved);
    setRuntimeState({
      selectedDestination: resolved,
      lastError: ''
    });
    return resolved;
  }, []);

  const requestRide = useCallback(
    async payload => {
      try {
        const result = await requestPrototypeRide(profile, payload);
        return result;
      } catch (error) {
        stopSearchingTimer();
        setRuntimeState({
          bookingStatus: 'idle',
          searchingElapsedSeconds: 0,
          paymentState: {
            status: 'failed',
            paymentId: null,
            amount: Number(payload?.fare ?? runtimeState.selectedFare ?? 0),
            method: payload?.paymentMethod || runtimeState.paymentMethod || 'pix',
            error: error?.message || 'Não foi possível confirmar o pagamento.'
          },
          lastError: error?.message || 'Não foi possível solicitar a corrida.'
        });
        throw error;
      }
    },
    [profile]
  );

  const cancelRideSearch = useCallback(async () => {
    await cancelPrototypeRide();
  }, []);

  const startTripFlow = useCallback(async () => {
    return startPrototypeTrip();
  }, []);

  const completeTripFlow = useCallback(async () => {
    return completePrototypeTrip();
  }, []);

  const clearFlowPreview = useCallback(() => {
    clearDestinationPreview();
  }, []);

  const updateSettings = useCallback(patch => {
    updatePrototypeSettings(patch);
  }, []);

  const updateRiderProfile = useCallback(patch => {
    updatePrototypeRiderProfile(patch);
  }, []);

  const loadChatSession = useCallback(
    async ({ forceReload = false } = {}) => {
      return loadPrototypeChatSession(profile, forceReload);
    },
    [profile]
  );

  const sendChatMessage = useCallback(
    async text => {
      return sendPrototypeChatMessage(profile, text);
    },
    [profile]
  );

  const openSupportTicket = useCallback(
    async payload => {
      return createPrototypeSupportTicket(profile, payload);
    },
    [profile]
  );

  const reportIncident = useCallback(
    async payload => {
      return reportPrototypeIncident(profile, payload);
    },
    [profile]
  );

  const setDriverOnline = useCallback(
    async isOnline => {
      return setPrototypeDriverOnline(profile, isOnline);
    },
    [profile]
  );

  const acceptDriverOffer = useCallback(
    async offer => {
      return acceptPrototypeDriverOffer(profile, offer);
    },
    [profile]
  );

  const rejectDriverOffer = useCallback(
    async (offer, reason) => {
      return rejectPrototypeDriverOffer(profile, offer, reason);
    },
    [profile]
  );

  const updateDriverActivationChecklistState = useCallback(
    async (stageKey, fieldKey, value) => {
      return updatePrototypeDriverActivation(profile, current =>
        updateDriverOnboardingChecklist(current, stageKey, fieldKey, value)
      );
    },
    [profile]
  );

  const completeDriverActivationStageState = useCallback(
    async stageKey => {
      return updatePrototypeDriverActivation(profile, current =>
        completeDriverOnboardingStage(current, stageKey)
      );
    },
    [profile]
  );

  const markNotificationRead = useCallback(notificationId => {
    markNotificationReadInState(notificationId);
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    markAllNotificationsReadInState();
  }, []);

  return {
    ...snapshot,
    unreadNotificationCount,
    profile,
    loadDestinationSuggestions,
    selectDestination,
    requestRide,
    cancelRideSearch,
    startTripFlow,
    completeTripFlow,
    clearFlowPreview,
    updateSettings,
    updateRiderProfile,
    loadChatSession,
    sendChatMessage,
    openSupportTicket,
    reportIncident,
    setDriverOnline,
    acceptDriverOffer,
    rejectDriverOffer,
    updateDriverActivationChecklist: updateDriverActivationChecklistState,
    completeDriverActivationStage: completeDriverActivationStageState,
    markNotificationRead,
    markAllNotificationsRead
  };
}
