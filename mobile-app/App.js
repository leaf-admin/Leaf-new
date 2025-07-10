import React, { useState, useEffect } from 'react';
import { Asset } from 'expo-asset';
import * as Font from 'expo-font';
import AppContainer from './src/navigation/AppNavigator';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  ImageBackground,
  LogBox,
  Platform
} from "react-native";
import { Provider } from "react-redux";
import { store } from 'common';
import { FirebaseProvider } from 'common/src/config/configureFirebase';
import { FirebaseConfig } from './config/FirebaseConfig';
import { colors } from './src/common/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import firebase from '@react-native-firebase/app';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/i18n'; // Initialize i18n with translations


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
    
    const ReactNative = require('react-native');
    try {
        ReactNative.I18nManager.allowRTL(false);
    } catch (e) {
        console.log("Erro ao configurar RTL:", e);
    }

    // Inicializar Firebase
    if (!firebase.apps.length) {
        firebase.initializeApp(FirebaseConfig);
        setIsFirebaseInitialized(true);
    } else {
        setIsFirebaseInitialized(true);
    }

    onLoad();
  }, []);

  useEffect(() => {
    if (assetsLoaded && isFirebaseInitialized) {
      console.log("App.js - Renderizando AppContainer principal");
    }
  }, [assetsLoaded, isFirebaseInitialized]);

  useEffect(() => {
    if (assetsLoaded && isFirebaseInitialized) {
      SplashScreen.hideAsync();
    }
  }, [assetsLoaded, isFirebaseInitialized]);

  const _loadResourcesAsync = async () => {
    try {
      await Promise.all([
        Asset.loadAsync([
          require('./assets/images/background.jpg'),
          require('./assets/images/logo165x90white.png'),
          require('./assets/images/bg.jpg'),
          require('./assets/images/intro.jpg'),
          require('./assets/images/g4.gif'),
          require('./assets/images/lodingDriver.gif')
        ]),
        Font.loadAsync({
          'Roboto-Bold': require('./assets/fonts/Roboto-Bold.ttf'),
          'Roboto-Regular': require('./assets/fonts/Roboto-Regular.ttf'),
          'Roboto-Medium': require('./assets/fonts/Roboto-Medium.ttf'),
          'Roboto-Light': require('./assets/fonts/Roboto-Light.ttf'),
          'Ubuntu-Regular': require('./assets/fonts/Ubuntu-Regular.ttf'),
          'Ubuntu-Medium': require('./assets/fonts/Ubuntu-Medium.ttf'),
          'Ubuntu-Light': require('./assets/fonts/Ubuntu-Light.ttf'),
          'Ubuntu-Bold': require('./assets/fonts/Ubuntu-Bold.ttf'),
          "DancingScript-Bold": require('./assets/fonts/DancingScript-Bold.ttf'),
          "DancingScript-Medium": require('./assets/fonts/DancingScript-Medium.ttf'),
          "DancingScript-SemiBold": require('./assets/fonts/DancingScript-SemiBold.ttf')
        })
      ]);
    } catch (error) {
      console.error("App.js - Erro ao carregar recursos:", error);
    }
  };

  const onLoad = async () => {
    if (__DEV__) {
      try {
        await _loadResourcesAsync();
        setAssetsLoaded(true);
      } catch (error) {
        console.error("App.js - Erro ao carregar em DEV mode:", error);
      }
    } else {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
        await _loadResourcesAsync();
        setAssetsLoaded(true);
      } catch (error) {
        console.error("App.js - Erro em PROD mode:", error);
        try {
          await _loadResourcesAsync();
          setAssetsLoaded(true);
        } catch (innerError) {
          console.error("App.js - Erro ao tentar recuperar:", innerError);
        }
      }
    }
  }

  if (!assetsLoaded || !isFirebaseInitialized) {
    return <View style={styles.container}>
      <ImageBackground
        source={require('./assets/images/intro.jpg')}
        resizeMode="stretch"
        style={styles.imagebg}
      >
        <ActivityIndicator style={{ paddingBottom: 100 }} color={colors.INDICATOR_BLUE} size='large' />
      </ImageBackground>
    </View>
  }

  return (
    <SafeAreaProvider>
      <Provider store={store}>
        {Platform.OS === 'web' && FirebaseProvider ? (
          <FirebaseProvider 
            config={FirebaseConfig} 
            AsyncStorage={AsyncStorage}
            onFirebaseInitialized={(firebase) => {
              console.log("App.js - Firebase inicializado com sucesso:", !!firebase);
            }}
          >
            <AppContainer />
          </FirebaseProvider>
        ) : (
          <AppContainer />
        )}
      </Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  imagebg: {
    flex:1,
    justifyContent: "flex-end",
    alignItems: 'center'
  }
});