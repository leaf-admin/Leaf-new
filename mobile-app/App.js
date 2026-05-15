import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Alert, View, Platform } from 'react-native';
import { Provider } from 'react-redux';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { store } from './src/state/appStore';
import AppNavigator from './src/navigation/AppNavigator';
import AuthProvider from './src/components/AuthProvider';
import { LanguageProvider } from './src/components/i18n/LanguageProvider';
import FCMNotificationService from './src/services/FCMNotificationService';
import InteractiveNotificationService from './src/services/InteractiveNotificationService';
import PersistentRideNotificationService from './src/services/PersistentRideNotificationService';
import WebSocketManager from './src/services/WebSocketManager';
import { setupAxiosInterceptor } from './src/utils/axiosInterceptor';
import Logger from './src/utils/Logger';
import NetworkStatusBanner from './src/components/NetworkStatusBanner';
import { toUserFriendlyMessage } from './src/utils/friendlyErrorMessages';
import './src/i18n'; // Inicializar i18n
import './src/utils/ReanimatedWrapper'; // Suprimir warnings do Reanimated

const FRIENDLY_ALERT_PATCH_BYPASS_OPTION_KEY = '__skipFriendlyAlertPatch';

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
  const bootWatchdogRef = useRef(null);
  const hasMarkedReadyRef = useRef(false);

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

  const markAppReady = useCallback((reason) => {
    if (hasMarkedReadyRef.current) {
      return;
    }

    hasMarkedReadyRef.current = true;

    if (bootWatchdogRef.current) {
      clearTimeout(bootWatchdogRef.current);
      bootWatchdogRef.current = null;
    }

    Logger.log(`✅ App liberado para renderização (${reason})`);
    setAppIsReady(true);
  }, []);

  // ✅ Desabilitar DevMenu também no useEffect para garantir (dentro do componente)
  useEffect(() => {
    hideDevelopmentClientMenu();
  }, []);

  // Inicializar FCM e notificações interativas quando o app iniciar
  useEffect(() => {
    if (isInitializationLocked) return;
    setIsInitializationLocked(true);

    bootWatchdogRef.current = setTimeout(() => {
      Logger.warn('⚠️ [App] Watchdog de boot acionado; liberando UI antes do fim da inicialização');
      markAppReady('watchdog');
    }, 3500);

    const initializeApp = async () => {
      try {
        Logger.log('🚀 Inicializando app...');
        
        // Garantir que a splash screen está visível
        await withTimeout(SplashScreen.preventAutoHideAsync(), 2000, 'Splash preventAutoHide');
        
        // Libera a UI assim que a splash nativa estiver sob controle.
        // Socket e notificações continuam inicializando em background para reduzir o tempo de abertura.
        markAppReady('shell-ready');

        // 1. Conectar WebSocket em background (para que o FCM possa registrar o token depois)
        // ✅ Timeout de 10s para conexão WebSocket (Item 1.3)
        try {
          const wsManager = WebSocketManager.getInstance();
          if (!wsManager.isConnected()) {
            Logger.log('🔌 [App] Conectando WebSocket...');
            
            // Timeout de 10s para conexão
            try {
              await withTimeout(wsManager.connect(), 10000, 'WebSocket connect');
              Logger.log('✅ [App] WebSocket conectado');
            } catch (timeoutError) {
              Logger.warn('⚠️ [App] WebSocket timeout ou erro (continuando mesmo assim):', timeoutError.message);
              // Continuar mesmo se o WebSocket falhar - ele tentará reconectar automaticamente
            }
          } else {
            Logger.log('✅ [App] WebSocket já conectado');
          }
        } catch (wsError) {
          Logger.warn('⚠️ [App] Erro ao conectar WebSocket (continuando mesmo assim):', wsError.message);
          // Continuar mesmo se o WebSocket falhar - ele tentará reconectar automaticamente
        }
        
        // 2. Inicializar FCM (agora o WebSocket já está conectado ou tentando conectar)
        await withTimeout(FCMNotificationService.initialize(), 8000, 'FCM initialize');
        
        // 3. Inicializar serviço de notificações interativas do sistema
        await withTimeout(InteractiveNotificationService.initialize(), 5000, 'InteractiveNotification initialize');
        
        // 4. Inicializar serviço de notificações persistentes de corrida
        await withTimeout(PersistentRideNotificationService.initialize(), 5000, 'PersistentRideNotification initialize');
        
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
        markAppReady('init-error');
      } finally {
        if (bootWatchdogRef.current) {
          clearTimeout(bootWatchdogRef.current);
          bootWatchdogRef.current = null;
        }
      }
    };

    initializeApp();

    // Cleanup quando o app for destruído
    return () => {
      if (bootWatchdogRef.current) {
        clearTimeout(bootWatchdogRef.current);
        bootWatchdogRef.current = null;
      }
      FCMNotificationService.destroy();
    };
  }, [isInitializationLocked, markAppReady, withTimeout]);

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
      }, 100); // Pequeno delay para garantir que o layout foi renderizado
      
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
