import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';

// ✅ CRÍTICO: Manter splash screen visível ANTES de registrar o componente
// Isso garante que a splash apareça antes de qualquer JavaScript executar
try {
  SplashScreen.preventAutoHideAsync();
} catch (e) {
  // Ignorar se já foi chamado
}

import App from './App';

registerRootComponent(App);