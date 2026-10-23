import { Alert, AppState, DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';

// A corrida por cima do app de navegação (Android): o motorista dirige com o Waze ou o
// Google Maps em tela cheia e vê o estado, o tempo e o botão da etapa num balão do Leaf.
// No Android 16 a notificação da corrida vira Live Update (carro na trilha e ETA no
// chip da barra de status). O módulo nativo só existe a partir do build 1.0.9.

const ENABLED_KEY = 'leaf:driver-ride-overlay:v1';
const ASKED_KEY = 'leaf:driver-ride-overlay-asked:v1';

// Botões que fazem sentido no balão: a ação da etapa, não "Navegar" (o motorista já
// está no app de navegação).
const STAGE_ACTIONS = new Set(['arrived_at_pickup', 'start_trip', 'end_trip']);

function nativeModule() {
  return Platform.OS === 'android' ? NativeModules?.LeafRideOverlay || null : null;
}

export function isRideOverlayAvailable() {
  return Boolean(nativeModule());
}

// Texto da pílula recolhida quando não há ETA: cabe em poucos caracteres.
function shortStageLabel(status, actionId) {
  if (actionId === 'arrived_at_pickup') return 'No embarque';
  if (actionId === 'end_trip') return 'Chegando';
  switch (String(status || '').trim().toLowerCase()) {
    case 'accepted': return 'A caminho';
    case 'arrived': return 'Embarque';
    case 'started': return 'Em viagem';
    default: return 'Corrida';
  }
}

/** Monta o que o balão e o Live Update mostram a partir da notificação da corrida. */
export function buildRideOverlayState({
  bookingId, status, ongoing = {}, actions = [], nearDestination = false,
  distanceKm, pickupAddress = '', destinationAddress = '',
} = {}) {
  // "Encerrar" grande num balão sobre o mapa, a viagem inteira, é um toque acidental
  // esperando para acontecer (e pelo balão não há a pergunta "Encerrar antes do
  // destino?"): só aparece perto do destino.
  const stageAction = (Array.isArray(actions) ? actions : []).find((action) =>
    STAGE_ACTIONS.has(action?.identifier) && (action.identifier !== 'end_trip' || nearDestination));
  const countdownSeconds = Number(ongoing.countdownSeconds);
  const progress = ongoing.progress === null || ongoing.progress === undefined || !Number.isFinite(Number(ongoing.progress))
    ? -1
    : Math.min(1, Math.max(0, Number(ongoing.progress)));
  const hasDistance = distanceKm !== null && distanceKm !== undefined && Number.isFinite(Number(distanceKm)) && Number(distanceKm) >= 0;
  const distanceLabel = hasDistance
    ? Number(distanceKm) < 1
      ? `${Math.round(Number(distanceKm) * 1000)} m`
      : `${Number(distanceKm).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`
    : '';
  const isBoarding = status === 'arrived';
  const isPickup = status === 'accepted';
  const atStageAction = Boolean(stageAction) && !isBoarding;
  const shortText = countdownSeconds > 0 ? `${Math.max(1, Math.ceil(countdownSeconds / 60))} min` : '';
  return {
    pillText: shortStageLabel(status, stageAction?.identifier),
    bookingId: String(bookingId || ''),
    title: String(ongoing.title || 'Corrida em andamento'),
    subtitle: String(ongoing.subtitle || ''),
    body: String(ongoing.body || ''),
    progress,
    shortText,
    actionId: stageAction?.identifier || '',
    actionLabel: stageAction?.buttonTitle || '',
    legKey: `${bookingId || ''}:${status || ''}`,
    // Only the floating window uses these presentation fields. Notification and
    // Live Update copy/actions remain unchanged, including on older native builds.
    ribbonMetric: isBoarding ? '0:00' : (atStageAction ? distanceLabel : shortText || distanceLabel) || '—',
    ribbonMetricLabel: isBoarding ? 'para embarcar' : isPickup ? 'até o embarque' : 'até o destino',
    ribbonPhase: isBoarding ? 'EMBARQUE' : isPickup ? 'ATÉ O EMBARQUE' : 'EM VIAGEM',
    ribbonTitle: status === 'started'
      ? nearDestination ? 'Chegando ao destino' : destinationAddress || 'Em viagem'
      : String(ongoing.title || 'Corrida em andamento'),
    ribbonDetail: status === 'started'
      ? [nearDestination ? destinationAddress : '', distanceLabel && `${distanceLabel} restantes`].filter(Boolean).join(' · ') || String(ongoing.body || '')
      : String(pickupAddress || ongoing.body || ''),
    ribbonSummary: status === 'started' ? String(ongoing.title || 'Em viagem') : 'LEAF',
    ribbonCountdownSeconds: isBoarding && Number.isFinite(countdownSeconds) && countdownSeconds > 0 ? countdownSeconds : 0,
  };
}

/**
 * Oferta de corrida por cima do Waze/Maps (como Uber e 99): o mesmo card da tela do
 * motorista (valor, R$/km, pedágio, embarque e destino, tempo). "Aceitar corrida" abre o
 * Leaf e aceita pelo caminho normal (rideAction=accept_offer).
 */
export function buildOfferCardState({
  bookingId,
  fareLabel = '',
  pickupEtaLabel = '',
  distanceLabel = '',
  durationLabel = '',
  perKmLabel = '',
  tollLabel = '',
  pickupLabel = '',
  dropoffLabel = '',
  expiresAtMs = 0,
  totalMs = 20000,
} = {}) {
  const clean = (value) => (value && value !== '--' ? String(value) : '');
  return {
    bookingId: String(bookingId || ''),
    fareLabel: clean(fareLabel),
    perKmLabel: clean(perKmLabel),
    tollLabel: clean(tollLabel),
    tripLine: [
      clean(pickupEtaLabel) && `${pickupEtaLabel} até o embarque`,
      clean(distanceLabel),
      clean(durationLabel),
    ].filter(Boolean).join(' · '),
    pickupLabel: clean(pickupLabel),
    dropoffLabel: clean(dropoffLabel),
    expiresAtMs: Number(expiresAtMs) > 0 ? Number(expiresAtMs) : 0,
    totalMs: Number(totalMs) > 0 ? Number(totalMs) : 20000,
  };
}

export async function isRideOverlayEnabled() {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) !== 'false';
  } catch (_error) {
    return true;
  }
}

export async function setRideOverlayEnabled(enabled) {
  try {
    await AsyncStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  } catch (_error) {
    // vale para esta sessão
  }
  controller.enabled = Boolean(enabled);
  if (!enabled) await controller.hideOverlay();
  return Boolean(enabled);
}

export async function getRideOverlayStatus() {
  const native = nativeModule();
  if (!native?.getStatus) {
    return { overlaySupported: false, canDrawOverlays: false, liveUpdateSupported: false };
  }
  try {
    return await native.getStatus();
  } catch (_error) {
    return { overlaySupported: false, canDrawOverlays: false, liveUpdateSupported: false };
  }
}

export async function openRideOverlaySettings() {
  try {
    await nativeModule()?.openOverlaySettings?.();
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Antes da primeira navegação externa: uma pergunta só, para ligar o balão. Sem a
 * permissão o motorista segue com a notificação e os avisos de chegada.
 */
export async function maybeAskRideOverlayPermission() {
  if (!isRideOverlayAvailable()) return false;
  const status = await getRideOverlayStatus();
  if (!status.overlaySupported || status.canDrawOverlays) return false;
  try {
    if ((await AsyncStorage.getItem(ASKED_KEY)) === 'true') return false;
    await AsyncStorage.setItem(ASKED_KEY, 'true');
  } catch (_error) {
    return false;
  }
  return new Promise((resolve) => {
    Alert.alert(
      'Ver a corrida por cima do mapa?',
      'Enquanto você navega no Waze ou no Google Maps, um balão do Leaf mostra o tempo, o destino e o botão da etapa. Ative "Sobrepor a outros apps" para o Leaf.',
      [
        { text: 'Agora não', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Ativar', onPress: () => openRideOverlaySettings().then(() => resolve(true)) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

class RideOverlayController {
  constructor() {
    this.state = null;
    this.offerState = null;
    this.enabled = true;
    this.appState = AppState.currentState;
    this.subscription = null;
    this.overlayShown = false;
    this.liveUpdateShown = false;
    this.actionSubscription = null;
    this.actionExecutor = null;
    this.actionInFlight = null;
  }

  setActionExecutor(executor) {
    this.actionExecutor = typeof executor === 'function' ? executor : null;
    if (!this.actionExecutor) {
      this.actionSubscription?.remove?.();
      this.actionSubscription = null;
      return;
    }
    if (!this.actionSubscription && nativeModule()?.completeOverlayAction) {
      this.actionSubscription = DeviceEventEmitter.addListener('LeafRideOverlayAction', (request) => {
        void this.handleAction(request);
      });
    }
  }

  async handleAction({ requestId, bookingId, actionIdentifier } = {}) {
    const native = nativeModule();
    if (!requestId || !native?.completeOverlayAction) return;
    // A duplicate native event must not re-execute (or resolve) its active request.
    if (this.actionInFlight === requestId) return;
    let success = false;
    let message = 'Não foi possível confirmar. Tente novamente.';
    const ownsRequest = !this.actionInFlight;
    try {
      if (!ownsRequest || !this.actionExecutor || !bookingId ||
          this.state?.bookingId !== bookingId || this.state?.actionId !== actionIdentifier ||
          !STAGE_ACTIONS.has(actionIdentifier)) {
        throw new Error('Ação indisponível. Aguarde a atualização da corrida.');
      }
      this.actionInFlight = requestId;
      const result = await this.actionExecutor({ bookingId, actionIdentifier });
      success = result?.success === true;
      if (!success) throw new Error('O servidor não confirmou a ação.');
      message = 'Confirmado';
    } catch (error) {
      message = error?.message || message;
      Logger.warn('⚠️ [RideOverlay] Ação não confirmada:', message);
    } finally {
      if (ownsRequest) this.actionInFlight = null;
      await native.completeOverlayAction(requestId, success, message).catch(() => {});
    }
  }

  ensureListening() {
    if (this.subscription || !isRideOverlayAvailable()) return;
    isRideOverlayEnabled().then((enabled) => { this.enabled = enabled; });
    this.subscription = AppState.addEventListener('change', (next) => {
      this.appState = next;
      if (next === 'active') {
        // De volta ao Leaf: o balão e o card de oferta saem sempre, mesmo que uma
        // atualização em segundo plano ainda estivesse sendo desenhada.
        this.hideOverlay();
        this.hideOfferCard();
        return;
      }
      this.render().catch(() => {});
      this.renderOffer().catch(() => {});
    });
  }

  /** Estado atual da corrida (motorista). Mostra o balão só com o Leaf em segundo plano. */
  async update(state) {
    if (!isRideOverlayAvailable()) return false;
    this.ensureListening();
    this.state = state;
    await this.render();
    return true;
  }

  /** Oferta nova: o card de oferta por cima de outros apps, só com o Leaf em segundo plano. */
  async showOffer(offerState) {
    if (!isRideOverlayAvailable() || !offerState?.bookingId) return false;
    this.ensureListening();
    const key = `${offerState.bookingId}:${offerState.expiresAtMs}`;
    if (this.offerKey === key) return true;
    this.offerKey = key;
    this.offerState = offerState;
    await this.renderOffer();
    return true;
  }

  /** Oferta aceita, recusada ou vencida: o card sai. */
  async clearOffer() {
    if (!this.offerState) return;
    this.offerState = null;
    this.offerKey = '';
    await this.hideOfferCard();
  }

  async renderOffer() {
    const native = nativeModule();
    if (!native?.showOfferCard || !this.offerState) return;
    // Estado de agora, não o guardado: o push chega com o app em segundo plano antes de
    // qualquer evento de AppState ter atualizado o controle.
    this.appState = AppState.currentState || this.appState;
    if (this.appState === 'active' || !this.enabled) return;
    if (this.offerState.expiresAtMs && this.offerState.expiresAtMs <= Date.now()) return;
    try {
      await native.showOfferCard(this.offerState);
      if (this.appState === 'active') await this.hideOfferCard();
    } catch (error) {
      Logger.warn('⚠️ [RideOverlay] Falha ao mostrar a oferta:', error?.message || error);
    }
  }

  async hideOfferCard() {
    try {
      await nativeModule()?.hideOfferCard?.();
    } catch (_error) {
      // já escondido
    }
  }

  async render() {
    const native = nativeModule();
    const visibleState = this.state;
    if (!native || !visibleState) return;
    this.appState = AppState.currentState || this.appState;
    try {
      if (this.appState !== 'active' && this.enabled) {
        this.overlayShown = Boolean(await native.showOverlay(visibleState));
        // O app pode ter voltado para a frente enquanto o balão era desenhado.
        if (this.appState === 'active') {
          await this.hideOverlay();
        }
      } else if (this.overlayShown) {
        await this.hideOverlay();
      }
    } catch (error) {
      Logger.warn('⚠️ [RideOverlay] Falha ao atualizar o balão:', error?.message || error);
    }
  }

  /** Android 16: a notificação da corrida como Live Update. Falso abaixo do Android 16. */
  async showLiveUpdate(state) {
    const native = nativeModule();
    if (!native?.showLiveUpdate) return false;
    try {
      this.liveUpdateShown = Boolean(await native.showLiveUpdate(state));
      return this.liveUpdateShown;
    } catch (error) {
      Logger.warn('⚠️ [RideOverlay] Falha no Live Update:', error?.message || error);
      return false;
    }
  }

  async hideOverlay() {
    this.overlayShown = false;
    try {
      await nativeModule()?.hideOverlay?.();
    } catch (_error) {
      // já escondido
    }
  }

  /** Fim da corrida: some o balão e o Live Update. */
  async dismiss() {
    this.state = null;
    await this.hideOverlay();
    if (this.liveUpdateShown) {
      this.liveUpdateShown = false;
      try {
        await nativeModule()?.cancelLiveUpdate?.();
      } catch (_error) {
        // já removido
      }
    }
  }
}

const controller = new RideOverlayController();
export default controller;
