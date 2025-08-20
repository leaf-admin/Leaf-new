import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { store } from './src/common-local/store';
import AppNavigator from './src/navigation/AppNavigator';
import AuthProvider from './src/components/AuthProvider';
import FCMNotificationService from './src/services/FCMNotificationService';
import './src/i18n'; // Inicializar i18n

export default function App() {
  // Inicializar FCM quando o app iniciar
  useEffect(() => {
    const initializeFCM = async () => {
      try {
        console.log('🚀 Inicializando FCM no App.js...');
        await FCMNotificationService.initialize();
        
        // Registrar handlers específicos para tipos de notificação
        FCMNotificationService.registerNotificationHandler('trip_update', async (remoteMessage) => {
          console.log('🚗 Handler de viagem registrado:', remoteMessage);
          // Aqui você pode implementar lógica específica para atualizações de viagem
        });

        FCMNotificationService.registerNotificationHandler('payment_confirmation', async (remoteMessage) => {
          console.log('💳 Handler de pagamento registrado:', remoteMessage);
          // Aqui você pode implementar lógica específica para confirmações de pagamento
        });

        FCMNotificationService.registerNotificationHandler('rating_received', async (remoteMessage) => {
          console.log('⭐ Handler de avaliação registrado:', remoteMessage);
          // Aqui você pode implementar lógica específica para avaliações recebidas
        });

      } catch (error) {
        console.error('❌ Erro ao inicializar FCM:', error);
      }
    };

    initializeFCM();

    // Cleanup quando o app for destruído
    return () => {
      FCMNotificationService.destroy();
    };
  }, []);

  return (
    <Provider store={store}>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </Provider>
  );
}
