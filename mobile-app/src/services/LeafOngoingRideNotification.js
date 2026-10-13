import { Platform } from 'react-native';
import Logger from '../utils/Logger';

// Notificação de corrida em andamento no Android, com barra de progresso e cronômetro
// nativos. O expo-notifications não tem nenhum dos dois: o progresso era desenhado com
// caracteres de bloco no texto e a notificação era recriada a cada atualização.
//
// O módulo nativo só existe em builds que incluem a biblioteca; nos demais (e no iOS,
// que usa Live Activity) `isAvailable()` é falso e quem chama mantém o caminho antigo.

export const ONGOING_RIDE_CHANNEL_ID = 'leaf_ride_live';
export const ONGOING_RIDE_NOTIFICATION_ID = 'leaf-ride-live';
const BRAND_COLOR = '#1A330E';

let cachedModule;
let channelReady = false;
let actionListener = null;
let foregroundUnsubscribe = null;

function loadNotifee() {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  cachedModule = null;
  if (Platform.OS !== 'android') {
    return cachedModule;
  }
  try {
    const { NativeModules } = require('react-native');
    if (!NativeModules?.NotifeeApiModule) {
      return cachedModule;
    }
    // eslint-disable-next-line global-require
    cachedModule = require('@notifee/react-native');
  } catch (error) {
    Logger.warn('⚠️ [OngoingRideNotification] Biblioteca nativa indisponível:', error?.message || error);
    cachedModule = null;
  }
  return cachedModule;
}

export function isOngoingRideNotificationAvailable() {
  return Boolean(loadNotifee());
}

async function ensureChannel(mod) {
  if (channelReady) return;
  await mod.default.createChannel({
    id: ONGOING_RIDE_CHANNEL_ID,
    name: 'Corrida em andamento',
    description: 'Acompanhamento da corrida com tempo e progresso',
    // Visível na barra e na tela de bloqueio, sem som nem vibração a cada atualização.
    importance: mod.AndroidImportance.DEFAULT,
    visibility: mod.AndroidVisibility.PUBLIC,
    vibration: false,
    sound: undefined,
  });
  channelReady = true;
}

/**
 * Monta a notificação nativa a partir de um descritor neutro. Função pura: é o que os
 * testes cobrem.
 * @param {Object} descriptor
 * @param {string} descriptor.title
 * @param {string} descriptor.body
 * @param {string} [descriptor.subtitle] texto curto ao lado do nome do app
 * @param {number|null} [descriptor.progress] 0..1; null esconde a barra
 * @param {number} [descriptor.countdownSeconds] cronômetro regressivo
 * @param {Array<{identifier: string, buttonTitle: string}>} [descriptor.actions]
 * @param {Object} [descriptor.data]
 */
export function buildOngoingRideNotification(descriptor = {}, { now = Date.now(), androidStyle = null } = {}) {
  const progressRatio = Number(descriptor.progress);
  const hasProgress = descriptor.progress !== null && descriptor.progress !== undefined && Number.isFinite(progressRatio);
  const countdownSeconds = Number(descriptor.countdownSeconds);
  const hasCountdown = Number.isFinite(countdownSeconds) && countdownSeconds > 0;
  const data = {};
  Object.entries(descriptor.data || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    data[key] = typeof value === 'string' ? value : JSON.stringify(value);
  });

  return {
    id: ONGOING_RIDE_NOTIFICATION_ID,
    title: String(descriptor.title || 'Corrida em andamento'),
    body: String(descriptor.body || ''),
    ...(descriptor.subtitle ? { subtitle: String(descriptor.subtitle) } : {}),
    data,
    android: {
      channelId: ONGOING_RIDE_CHANNEL_ID,
      smallIcon: 'ic_stat_leaf',
      color: BRAND_COLOR,
      ongoing: true,
      autoCancel: false,
      onlyAlertOnce: true,
      showTimestamp: hasCountdown,
      ...(hasCountdown
        ? {
            timestamp: now + Math.round(countdownSeconds) * 1000,
            showChronometer: true,
            chronometerDirection: 'down',
          }
        : {}),
      ...(hasProgress
        ? {
            progress: {
              max: 100,
              current: Math.round(Math.min(1, Math.max(0, progressRatio)) * 100),
            },
          }
        : {}),
      ...(androidStyle ? { style: androidStyle } : {}),
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: (Array.isArray(descriptor.actions) ? descriptor.actions : [])
        .filter((action) => action?.identifier && action?.buttonTitle)
        .slice(0, 3)
        .map((action) => ({
          title: String(action.buttonTitle),
          pressAction: { id: String(action.identifier), launchActivity: 'default' },
        })),
    },
  };
}

export async function displayOngoingRideNotification(descriptor = {}) {
  const mod = loadNotifee();
  if (!mod) return false;
  try {
    await ensureChannel(mod);
    const body = String(descriptor.body || '');
    await mod.default.displayNotification(
      buildOngoingRideNotification(descriptor, {
        androidStyle: body.includes('\n')
          ? { type: mod.AndroidStyle.BIGTEXT, text: body }
          : null,
      }),
    );
    return true;
  } catch (error) {
    Logger.warn('⚠️ [OngoingRideNotification] Falha ao exibir:', error?.message || error);
    return false;
  }
}

export async function cancelOngoingRideNotification() {
  const mod = loadNotifee();
  if (!mod) return false;
  try {
    await mod.default.cancelNotification(ONGOING_RIDE_NOTIFICATION_ID);
    return true;
  } catch (error) {
    Logger.warn('⚠️ [OngoingRideNotification] Falha ao remover:', error?.message || error);
    return false;
  }
}

/**
 * Botões da notificação ("Cheguei", "Iniciar", "Encerrar"). O listener recebe
 * `{ actionIdentifier, data }`, o mesmo formato usado pelas ações do expo-notifications.
 */
export function setOngoingRideActionListener(listener) {
  actionListener = typeof listener === 'function' ? listener : null;
  const mod = loadNotifee();
  if (!mod || foregroundUnsubscribe) return;
  const handle = async ({ type, detail }) => {
    if (type !== mod.EventType.ACTION_PRESS) return;
    const actionIdentifier = detail?.pressAction?.id;
    if (!actionIdentifier || actionIdentifier === 'default' || !actionListener) return;
    try {
      await actionListener({ actionIdentifier, data: detail?.notification?.data || {} });
    } catch (error) {
      Logger.warn('⚠️ [OngoingRideNotification] Ação falhou:', error?.message || error);
    }
  };
  foregroundUnsubscribe = mod.default.onForegroundEvent(handle);
  mod.default.onBackgroundEvent(handle);
}
