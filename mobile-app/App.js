import React, { useState, useEffect } from 'react';
import { Asset } from 'expo-asset';
import * as Font from 'expo-font';
import AppContainer from './src/navigation/AppNavigator';
import * as Notifications from 'expo-notifications';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  LogBox,
} from "react-native";
import { Provider } from "react-redux";
import { store } from './src/common-local';
import { FirebaseProvider } from './src/common-local/config/configureFirebase';
import { FirebaseConfig } from './config/FirebaseConfig';
import { colors } from './src/common/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import firebase from '@react-native-firebase/app';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/i18n';
import notificationService from './src/services/NotificationService';

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [isFirebaseInitialized, setIsFirebaseInitialized] = useState(false);

  useEffect(() => {
    console.log("App.js - Iniciando aplicação");
    
    // Inicializar Firebase
    if (!firebase.apps.length) {
        firebase.initializeApp(FirebaseConfig);
        setIsFirebaseInitialized(true);
    } else {
        setIsFirebaseInitialized(true);
    }

    // Carregar recursos
    _loadResourcesAsync();
    
    // Inicializar serviço de notificações
    _initializeNotificationService();
  }, []);

  useEffect(() => {
    if (assetsLoaded && isFirebaseInitialized) {
      console.log("App.js - Renderizando AppContainer principal");
      SplashScreen.hideAsync();
    }
  }, [assetsLoaded, isFirebaseInitialized]);

  const _loadResourcesAsync = async () => {
    try {
      console.log("App.js - Carregando recursos");
      
      // Carregar fontes essenciais
      await Font.loadAsync({
        'Roboto-Regular': require('./assets/fonts/Roboto-Regular.ttf'),
        'Roboto-Bold': require('./assets/fonts/Roboto-Bold.ttf'),
        'Roboto-Medium': require('./assets/fonts/Roboto-Medium.ttf'),
        'Roboto-Light': require('./assets/fonts/Roboto-Light.ttf'),
      });
      
      console.log("App.js - Recursos carregados com sucesso");
      setAssetsLoaded(true);
    } catch (error) {
      console.error("App.js - Erro ao carregar recursos:", error);
      // Mesmo com erro, continuar
      setAssetsLoaded(true);
    }
  };

  const _initializeNotificationService = async () => {
    try {
      console.log("App.js - Inicializando serviço de notificações...");
      const success = await notificationService.initialize();
      if (success) {
        console.log("App.js - Serviço de notificações inicializado com sucesso");
      } else {
        console.log("App.js - Falha ao inicializar serviço de notificações");
      }
    } catch (error) {
      console.error("App.js - Erro ao inicializar notificações:", error);
    }
  };

  if (!assetsLoaded || !isFirebaseInitialized) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.INDICATOR_BLUE} />
      </View>
    );
  }

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <AppContainer />
      </SafeAreaProvider>
    </Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.BACKGROUND,
  },
});