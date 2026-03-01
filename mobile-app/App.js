import React, { useEffect, useState, useCallback } from 'react';
import { View, Platform } from 'react-native';
import { Provider } from 'react-redux';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as DevClient from 'expo-dev-client';
import { store } from './src/common-local/store';
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
import './src/i18n'; // Inicializar i18n
import './src/utils/ReanimatedWrapper'; // Suprimir warnings do Reanimated

// ✅ CRÍTICO: Manter a splash screen nativa visível desde o início
// Isso DEVE ser chamado antes de qualquer renderização
// Usar try/catch para garantir que não quebra se já foi chamado
try {
  SplashScreen.preventAutoHideAsync();
  Logger.log('✅ Splash screen nativa mantida visível');
} catch (e) {
  Logger.warn('⚠️ Erro ao manter splash screen:', e);
}

// ✅ Desabilitar DevMenu completamente (mesmo em development)
// O DevMenu pode aparecer automaticamente e criar uma tela extra indesejada
// IMPORTANTE: Isso é uma camada extra de segurança - o plugin nativo também desabilita
if (Platform.OS !== 'web' && DevClient) {
  try {
    // Desabilitar DevMenu sempre (pode ser reativado manualmente se necessário)
    if (DevClient.setDevMenuVisible) {
      DevClient.setDevMenuVisible(false);
    }
    // Também tentar desabilitar via configuração
    if (DevClient.disableDevMenu) {
      DevClient.disableDevMenu();
    }
    // Tentar esconder o FAB (Floating Action Button) do DevMenu
    if (DevClient.hideDevMenu) {
      DevClient.hideDevMenu();
    }
  } catch (e) {
    // Ignorar se não disponível
  }
}

// ✅ Configurar interceptor axios para CORS
setupAxiosInterceptor();

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);

  // ✅ Desabilitar DevMenu também no useEffect para garantir (dentro do componente)
  useEffect(() => {
    if (Platform.OS !== 'web' && DevClient) {
      try {
        if (DevClient.setDevMenuVisible) {
          DevClient.setDevMenuVisible(false);
        }
      } catch (e) {
        // Ignorar
      }
    }
  }, []);

  // Inicializar FCM e notificações interativas quando o app iniciar
  useEffect(() => {
    const initializeApp = async () => {
      try {
        Logger.log('🚀 Inicializando app...');
        
        // Garantir que a splash screen está visível
        await SplashScreen.preventAutoHideAsync();
        
        // 1. Conectar WebSocket primeiro (para que o FCM possa registrar o token depois)
        // ✅ Timeout de 10s para conexão WebSocket (Item 1.3)
        try {
          const wsManager = WebSocketManager.getInstance();
          if (!wsManager.isConnected()) {
            Logger.log('🔌 [App] Conectando WebSocket...');
            
            // Timeout de 10s para conexão
            const wsPromise = wsManager.connect();
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000)
            );
            
            try {
              await Promise.race([wsPromise, timeoutPromise]);
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
        await FCMNotificationService.initialize();
        
        // 3. Inicializar serviço de notificações interativas do sistema
        await InteractiveNotificationService.initialize();
        
        // 4. Inicializar serviço de notificações persistentes de corrida
        await PersistentRideNotificationService.initialize();
        
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

        // Aguardar 4 segundos para garantir que a splash apareça
        await new Promise(resolve => setTimeout(resolve, 4000));

        Logger.log('✅ App inicializado com sucesso');
        setAppIsReady(true);
      } catch (error) {
        Logger.error('❌ Erro ao inicializar app:', error);
        // Mesmo com erro, mostrar o app após 4 segundos
        setTimeout(() => setAppIsReady(true), 4000);
      }
    };

    initializeApp();

    // Cleanup quando o app for destruído
    return () => {
      FCMNotificationService.destroy();
    };
  }, []);

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