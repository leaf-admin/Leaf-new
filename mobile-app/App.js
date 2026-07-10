import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Alert, View, Platform, LogBox } from 'react-native';
import { Provider } from 'react-redux';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import { store } from './src/state/appStore';
import AppNavigator from './src/navigation/AppNavigator';
import AuthProvider from './src/components/AuthProvider';
import { LanguageProvider } from './src/components/i18n/LanguageProvider';
import FCMNotificationService from './src/services/FCMNotificationService';
import InteractiveNotificationService from './src/services/InteractiveNotificationService';
import PersistentRideNotificationService from './src/services/PersistentRideNotificationService';
import { setupAxiosInterceptor } from './src/utils/axiosInterceptor';
import Logger from './src/utils/Logger';
import NetworkStatusBanner from './src/components/NetworkStatusBanner';
import AndroidPermissionDisclosureHost from './src/components/AndroidPermissionDisclosureHost';
import { toUserFriendlyMessage } from './src/utils/friendlyErrorMessages';
import { registerPortraitOrientationGuard } from './src/utils/appOrientationGuard';
import './src/i18n'; // Inicializar i18n
import './src/utils/ReanimatedWrapper'; // Suprimir warnings do Reanimated

// LogBox allowlist — only known non-critical warnings are ignored
// All other warnings remain visible so QA and dev can catch regressions early
if (__DEV__) {
  LogBox.ignoreLogs([
    // Deprecated Firebase namespaced API — pending migration to modular API
    'This method is deprecated (as well as all React Native Firebase namespaced API)',
    // Socket QA token expiry — expected in dev with short-lived tokens
    'Token QA do socket expirado ou próximo de expirar',
  ]);
}

const FRIENDLY_ALERT_PATCH_BYPASS_OPTION_KEY = '__skipFriendlyAlertPatch';
const CANONICAL_FONT_ASSETS = {
  'Inter-Regular': require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  'Inter-Medium': require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
  'Inter-SemiBold': require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  'Inter-Bold': require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  'Inter-Light': require('@expo-google-fonts/inter/300Light/Inter_300Light.ttf'),
};

function getDevClient() {
  if (!__DEV__ || Platform.OS === 'web') {
    return null;
  }

  try {
    return require('expo-dev-client');
  } catch (error) {
    return null;
  }
}

function hideDevelopmentClientMenu() {
  const DevClient = getDevClient();
  if (!DevClient) {
    return;
  }

  try {
    if (DevClient.setDevMenuVisible) {
      DevClient.setDevMenuVisible(false);
    }
    if (DevClient.disableDevMenu) {
      DevClient.disableDevMenu();
    }
    if (DevClient.hideDevMenu) {
      DevClient.hideDevMenu();
    }
  } catch (error) {
    // Dev client is development-only; failures here must never affect release startup.
  }
}

function installGlobalFriendlyAlertPatch() {
  if (!Alert?.alert || global.__LEAF_ALERT_PATCHED__) {
    return;
  }

  const originalAlert = Alert.alert.bind(Alert);
  global.__LEAF_ALERT_PATCHED__ = true;

  Alert.alert = (title, message, buttons, options) => {
    const shouldBypassFriendlyPatch =
      Boolean(
        options &&
          typeof options === 'object' &&
          options[FRIENDLY_ALERT_PATCH_BYPASS_OPTION_KEY] === true
      );
    const normalizedOptions =
      options && typeof options === 'object'
        ? Object.fromEntries(
            Object.entries(options).filter(
              ([key]) => key !== FRIENDLY_ALERT_PATCH_BYPASS_OPTION_KEY
            )
          )
        : options;

    if (shouldBypassFriendlyPatch) {
      return originalAlert(title, message, buttons, normalizedOptions);
    }

    // Alguns fluxos usam Alert.alert('mensagem-unica')
    if (typeof message === 'undefined') {
      const friendlySingleMessage = toUserFriendlyMessage(title, {
        context: 'api',
        fallbackMessage: 'Nao foi possivel concluir esta acao agora. Tente novamente.'
      });
      return originalAlert('Atencao', friendlySingleMessage, buttons, normalizedOptions);
    }

    const friendlyMessage = toUserFriendlyMessage(message, {
      context: 'api',
      fallbackMessage: 'Nao foi possivel concluir esta acao agora. Tente novamente.'
    });

    return originalAlert(
      title || 'Atencao',
      friendlyMessage,
      buttons,
      normalizedOptions
    );
  };
}

async function loadCanonicalFonts() {
  await Font.loadAsync(CANONICAL_FONT_ASSETS);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ CRÍTICO: Manter a splash screen nativa visível desde o início
// Isso DEVE ser chamado antes de qualquer renderização
// Usar try/catch para garantir que não quebra se já foi chamado
try {
  SplashScreen.preventAutoHideAsync();
  Logger.log('✅ Splash screen nativa mantida visível');
} catch (e) {
  Logger.warn('⚠️ Erro ao manter splash screen:', e);
}

hideDevelopmentClientMenu();

// ✅ Configurar interceptor axios para CORS
setupAxiosInterceptor();
installGlobalFriendlyAlertPatch();

export default function App() {
  if (process.env.EXPO_PUBLIC_LEAF_ONBOARDING_SCREENSHOT === '1') {
    const AuthFlowScreenshotHarness = require('./src/components/auth/AuthFlowScreenshotHarness').default;

    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <Provider store={store}>
            <LanguageProvider>
              <AuthFlowScreenshotHarness />
            </LanguageProvider>
          </Provider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  const [appIsReady, setAppIsReady] = useState(false);
  const [isInitializationLocked, setIsInitializationLocked] = useState(false);
  const hasMarkedReadyRef = useRef(false);
  const hasLoadedCanonicalFontsRef = useRef(false);

  const withTimeout = useCallback(async (promise, timeoutMs, label) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${label} timeout (${timeoutMs}ms)`)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const initializeOptionalBootService = useCallback(async (label, promise, timeoutMs) => {
    try {
      await withTimeout(promise, timeoutMs, label);
    } catch (error) {
      Logger.warn(`⚠️ [App] ${label} não concluiu durante o boot; mantendo UI ativa:`, error?.message || error);
    }
  }, [withTimeout]);

  const markAppReady = useCallback((reason) => {
    if (hasMarkedReadyRef.current) {
      return;
    }

    hasMarkedReadyRef.current = true;

    Logger.log(`✅ App liberado para renderização (${reason})`);
    setAppIsReady(true);
  }, []);

  // ✅ Desabilitar DevMenu também no useEffect para garantir (dentro do componente)
  useEffect(() => {
    hideDevelopmentClientMenu();
    return registerPortraitOrientationGuard();
  }, []);

  // Inicializar FCM e notificações interativas quando o app iniciar
  useEffect(() => {
    if (isInitializationLocked) return;
    setIsInitializationLocked(true);

    const initializeApp = async () => {
      try {
        Logger.log('🚀 Inicializando app...');
        
        // Garantir que a splash screen está visível
        await withTimeout(SplashScreen.preventAutoHideAsync(), 2000, 'Splash preventAutoHide');
        await withTimeout(loadCanonicalFonts(), 5000, 'Inter font load');
        hasLoadedCanonicalFontsRef.current = true;
        
        // Libera a UI assim que a splash nativa e a fonte canônica estiverem sob controle.
        // Socket e notificações continuam inicializando em background para reduzir o tempo de abertura.
        markAppReady('shell-ready');

        if (Platform.OS === 'android') {
          await wait(__DEV__ ? 1800 : 450);
        }

        // 1. Inicializar FCM sem abrir socket anônimo no boot.
        // O realtime autentica somente quando o perfil já está hidratado no RealtimeConnectionGuard.
        await withTimeout(FCMNotificationService.initialize(), 8000, 'FCM initialize');
        
        // 2. Inicializar serviços de notificação em modo não-bloqueante.
        // Eles podem demorar mais em simuladores/dev-client e não devem gerar erro visual no app.
        await initializeOptionalBootService(
          'InteractiveNotification initialize',
          InteractiveNotificationService.initialize(),
          8000
        );
        
        await initializeOptionalBootService(
          'PersistentRideNotification initialize',
          PersistentRideNotificationService.initialize(),
          8000
        );
        
        // Registrar handlers específicos para tipos de notificação
        FCMNotificationService.registerNotificationHandler('trip_update', async (remoteMessage) => {
          Logger.log('🚗 Handler de viagem registrado:', remoteMessage);
        });

        FCMNotificationService.registerNotificationHandler('payment_confirmation', async (remoteMessage) => {
          Logger.log('💳 Handler de pagamento registrado:', remoteMessage);
        });

        FCMNotificationService.registerNotificationHandler('rating_received', async (remoteMessage) => {
          Logger.log('⭐ Handler de avaliação registrado:', remoteMessage);
        });

        Logger.log('✅ App inicializado com sucesso');
        markAppReady('full-init');
      } catch (error) {
        Logger.error('❌ Erro ao inicializar app:', error);
        if (hasLoadedCanonicalFontsRef.current) {
          markAppReady('init-error-after-fonts');
        } else {
          try {
            await withTimeout(loadCanonicalFonts(), 5000, 'Inter font recovery');
            hasLoadedCanonicalFontsRef.current = true;
          } catch (fontError) {
            Logger.error('❌ Inter não carregou durante o boot; liberando UI para evitar splash infinita:', fontError);
          }
          markAppReady('font-recovery');
        }
      }
    };

    initializeApp();

    // Cleanup quando o app for destruído
    return () => {
      FCMNotificationService.destroy();
    };
  }, [initializeOptionalBootService, isInitializationLocked, markAppReady, withTimeout]);

  // Failsafe de release: a splash nativa nunca pode ficar presa se algum serviço de boot pendurar.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasMarkedReadyRef.current) {
        Logger.warn('⚠️ [App] Boot excedeu o limite; liberando UI por failsafe.');
        markAppReady('startup-watchdog');
      }
    }, Platform.OS === 'android' ? 7000 : 9000);

    return () => clearTimeout(timer);
  }, [markAppReady]);

  // Esconder splash screen quando o app estiver pronto
  // IMPORTANTE: Só esconder DEPOIS que o componente estiver montado
  useEffect(() => {
    if (appIsReady) {
      // Aguardar um frame para garantir que o layout foi renderizado
      const timer = setTimeout(async () => {
        try {
          await SplashScreen.hideAsync();
          Logger.log('✅ Splash screen nativa escondida');
        } catch (error) {
          Logger.warn('⚠️ Erro ao esconder splash screen:', error);
        }
      }, Platform.OS === 'android' && __DEV__ ? 4800 : 100);
      
      return () => clearTimeout(timer);
    }
  }, [appIsReady]);

  // ✅ SOLUÇÃO 1: Renderizar Provider sempre para garantir que Redux esteja disponível
  // A splash screen nativa permanece visível via preventAutoHideAsync até hideAsync ser chamado
  // Isso evita problemas de timing com hooks do Redux
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <LanguageProvider>
          <AuthProvider>
            {/* ✅ Banner de status de conexão (não bloqueante) */}
            <NetworkStatusBanner />
            <AndroidPermissionDisclosureHost />
            
            {appIsReady ? (
              <AppNavigator />
            ) : (
              // Renderizar componente vazio enquanto não está pronto
              // A splash nativa continua visível via preventAutoHideAsync
              <View style={{ flex: 1, backgroundColor: '#1A330E' }} />
            )}
          </AuthProvider>
        </LanguageProvider>
      </Provider>
    </GestureHandlerRootView>
  );
}
