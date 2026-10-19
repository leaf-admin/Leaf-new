import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { registerFCMBackgroundMessageHandler } from './src/services/FCMBackgroundMessageHandler';
import { initObservability, wrapRootComponent } from './src/services/observability/AppObservability';

// Sentry e PostHog antes de qualquer outra coisa, para pegar erros do boot.
initObservability();

try {
  registerFCMBackgroundMessageHandler();
} catch (error) {
  console.warn('[Leaf] FCM background handler indisponível no bootstrap:', error?.message || error);
}

// ✅ CRÍTICO: Manter splash screen visível ANTES de registrar o componente
// Isso garante que a splash apareça antes de qualquer JavaScript executar
try {
  SplashScreen.preventAutoHideAsync();
} catch (e) {
  // Ignorar se já foi chamado
}

import App from './App';

registerRootComponent(wrapRootComponent(App));
