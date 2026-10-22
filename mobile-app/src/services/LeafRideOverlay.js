import { Alert, AppState, NativeModules, Platform } from 'react-native';
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
export function buildRideOverlayState({ bookingId, status, ongoing = {}, actions = [], nearDestination = false } = {}) {
  // "Encerrar" grande num balão sobre o mapa, a viagem inteira, é um toque acidental
  // esperando para acontecer (e pelo balão não há a pergunta "Encerrar antes do
  // destino?"): só aparece perto do destino.
  const stageAction = (Array.isArray(actions) ? actions : []).find((action) =>
    STAGE_ACTIONS.has(action?.identifier) && (action.identifier !== 'end_trip' || nearDestination));
  const countdownSeconds = Number(ongoing.countdownSeconds);
  const progress = ongoing.progress === null || ongoing.progress === undefined || !Number.isFinite(Number(ongoing.progress))
    ? -1
    : Math.min(1, Math.max(0, Number(ongoing.progress)));
  return {
    pillText: shortStageLabel(status, stageAction?.identifier),
    bookingId: String(bookingId || ''),
    title: String(ongoing.title || 'Corrida em andamento'),
    subtitle: String(ongoing.subtitle || ''),
    body: String(ongoing.body || ''),
    progress,
    shortText: countdownSeconds > 0 ? `${Math.max(1, Math.ceil(countdownSeconds / 60))} min` : '',
    actionId: stageAction?.identifier || '',
    actionLabel: stageAction?.buttonTitle || '',
    legKey: `${bookingId || ''}:${status || ''}`,
  };
}

/**
 * Oferta de corrida por cima do Waze/Maps (como Uber e 99). O botão só abre o Leaf no
 * card da oferta: aceitar continua sendo no app, com o tempo e os detalhes à vista.
 */
export function buildOfferOverlayState({
  bookingId,
  fareLabel = '',
  pickupEtaLabel = '',
  distanceLabel = '',
  perKmLabel = '',
  dropoffLabel = '',
  expiresAtMs = 0,
} = {}) {
  const id = String(bookingId || '');
  return {
    bookingId: id,
    title: 'Nova corrida',
    subtitle: [pickupEtaLabel && `${pickupEtaLabel} até o embarque`, distanceLabel, perKmLabel]
      .filter((part) => part && part !== '--').join(' · '),
    body: dropoffLabel ? `Para ${dropoffLabel}` : '',
    progress: -1,
    shortText: fareLabel && fareLabel !== '--' ? fareLabel : '',
    actionId: 'open_offer',
    actionLabel: 'Ver corrida',
    legKey: `offer:${id}:${expiresAtMs || ''}`,
    pillText: 'Nova corrida',
    expiresAtMs: Number(expiresAtMs) > 0 ? Number(expiresAtMs) : 0,
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
  }

  ensureListening() {
    if (this.subscription || !isRideOverlayAvailable()) return;
    isRideOverlayEnabled().then((enabled) => { this.enabled = enabled; });
    this.subscription = AppState.addEventListener('change', (next) => {
      this.appState = next;
      if (next === 'active') {
        // De volta ao Leaf: o balão sai sempre, mesmo que uma atualização em segundo
        // plano ainda estivesse sendo desenhada.
        this.hideOverlay();
        return;
      }
      this.render().catch(() => {});
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

  /** Oferta nova com o Leaf em segundo plano: passa na frente do estado da corrida. */
  async showOffer(offerState) {
    if (!isRideOverlayAvailable() || !offerState?.bookingId) return false;
    this.ensureListening();
    if (this.offerState?.legKey === offerState.legKey) return true;
    this.offerState = offerState;
    await this.render();
    return true;
  }

  /** Oferta aceita, recusada ou vencida: volta ao balão da corrida (ou some). */
  async clearOffer() {
    if (!this.offerState) return;
    this.offerState = null;
    if (this.state) await this.render();
    else await this.hideOverlay();
  }

  async render() {
    const native = nativeModule();
    const visibleState = this.offerState || this.state;
    if (!native || !visibleState) return;
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
    if (this.offerState) {
      await this.render();
      return;
    }
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
