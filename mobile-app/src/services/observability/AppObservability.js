// Erros (Sentry) e uso do app (PostHog) num só lugar. Sem DSN ou chave,
// tudo vira no-op; em desenvolvimento também, salvo EXPO_PUBLIC_OBSERVABILITY_IN_DEV=true.
// O Sentry fica sempre ligado em produção (só erros, sem dados pessoais). O
// PostHog respeita a opção "Dados de uso" das configurações.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { createRageTapDetector, maskPii, sanitizeProperties, scrubSentryEvent } from './observabilityPrivacy';

const ANALYTICS_OPT_OUT_KEY = 'leaf:analytics-opt-out:v1';

// O Expo só embute no bundle as variáveis lidas de forma literal
// (process.env.EXPO_PUBLIC_X). Leitura por nome dinâmico volta vazia em produção.
const clean = (value) => String(value || '').trim();
const readConfig = () => ({
  inDev: clean(process.env.EXPO_PUBLIC_OBSERVABILITY_IN_DEV) === 'true',
  sentryDsn: clean(process.env.EXPO_PUBLIC_SENTRY_DSN),
  sentryEnvironment: clean(process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT),
  posthogApiKey: clean(process.env.EXPO_PUBLIC_POSTHOG_API_KEY),
  posthogHost: clean(process.env.EXPO_PUBLIC_POSTHOG_HOST),
});
const enabledInThisBuild = (config) => !__DEV__ || config.inDev;

let Sentry = null;
let posthog = null;
let analyticsEnabled = true;
let currentScreen = null;
let identifiedUid = null;
const registerTap = createRageTapDetector();

function releaseName() {
  const appId = Application.applicationId || 'br.com.leaf.ride';
  return `${appId}@${Application.nativeApplicationVersion || '0'}+${Application.nativeBuildVersion || '0'}`;
}

function initSentry(config) {
  const dsn = config.sentryDsn;
  if (!dsn) return;
  try {
    Sentry = require('@sentry/react-native');
    Sentry.init({
      dsn,
      environment: config.sentryEnvironment || (__DEV__ ? 'development' : 'production'),
      release: releaseName(),
      dist: String(Application.nativeBuildVersion || ''),
      sendDefaultPii: false,
      tracesSampleRate: 0,
      enableAutoSessionTracking: true,
      attachScreenshot: false,
      beforeSend: scrubSentryEvent,
      beforeBreadcrumb: (breadcrumb) => maskPii(breadcrumb),
    });
    Sentry.setTags({
      platform: Platform.OS,
      update_id: Updates.updateId || 'embedded',
      update_channel: Updates.channel || 'none',
      runtime_version: Updates.runtimeVersion || 'unknown',
    });
  } catch (error) {
    Sentry = null;
  }
}

function initPosthog(config) {
  const apiKey = config.posthogApiKey;
  if (!apiKey) return;
  try {
    const PostHog = require('posthog-react-native').default;
    posthog = new PostHog(apiKey, {
      host: config.posthogHost || 'https://eu.i.posthog.com',
      captureAppLifecycleEvents: true,
      personProfiles: 'identified_only',
      flushAt: 20,
    });
    posthog.register({
      platform: Platform.OS,
      app_build: String(Application.nativeBuildVersion || ''),
      update_id: Updates.updateId || 'embedded',
    });
    AsyncStorage.getItem(ANALYTICS_OPT_OUT_KEY)
      .then((value) => {
        if (value === 'true') {
          analyticsEnabled = false;
          posthog?.optOut();
        }
      })
      .catch(() => {});
  } catch (error) {
    posthog = null;
  }
}

export function initObservability() {
  const config = readConfig();
  if (!enabledInThisBuild(config)) return;
  if (!Sentry) initSentry(config);
  if (!posthog) initPosthog(config);
}

/** Envolve o componente raiz com o boundary do Sentry quando ele está ativo. */
export function wrapRootComponent(Component) {
  return Sentry?.wrap ? Sentry.wrap(Component) : Component;
}

export function track(event, properties = {}) {
  if (!posthog || !analyticsEnabled) return;
  posthog.capture(event, sanitizeProperties({ screen: currentScreen, ...properties }));
}

export function trackScreen(name) {
  if (!name || name === currentScreen) return;
  currentScreen = name;
  Sentry?.addBreadcrumb?.({ category: 'navigation', message: name, level: 'info' });
  if (posthog && analyticsEnabled) posthog.screen(name);
}

export function trackTouch(x, y) {
  if (registerTap(x, y)) {
    track('$rageclick', {});
  }
}

export function identifyUser({ uid, role } = {}) {
  const id = String(uid || '').trim();
  if (!id || id === identifiedUid) return;
  identifiedUid = id;
  Sentry?.setUser?.({ id });
  Sentry?.setTag?.('role', role || 'unknown');
  if (posthog && analyticsEnabled) posthog.identify(id, sanitizeProperties({ role: role || null }));
}

export function resetUser() {
  if (!identifiedUid) return;
  identifiedUid = null;
  Sentry?.setUser?.(null);
  posthog?.reset();
}

export function captureError(error, context = {}) {
  Sentry?.captureException?.(error, { extra: sanitizeProperties(context) });
}

export function isAnalyticsEnabled() {
  return analyticsEnabled;
}

export async function loadAnalyticsPreference() {
  try {
    analyticsEnabled = (await AsyncStorage.getItem(ANALYTICS_OPT_OUT_KEY)) !== 'true';
  } catch (error) {
    analyticsEnabled = true;
  }
  return analyticsEnabled;
}

export async function setAnalyticsEnabled(enabled) {
  analyticsEnabled = Boolean(enabled);
  if (analyticsEnabled) {
    posthog?.optIn();
  } else {
    posthog?.optOut();
  }
  try {
    await AsyncStorage.setItem(ANALYTICS_OPT_OUT_KEY, analyticsEnabled ? 'false' : 'true');
  } catch (error) {
    // A escolha vale para esta sessão mesmo se o armazenamento falhar.
  }
  return analyticsEnabled;
}

export function resetObservabilityForTests() {
  Sentry = null;
  posthog = null;
  analyticsEnabled = true;
  currentScreen = null;
  identifiedUid = null;
}
