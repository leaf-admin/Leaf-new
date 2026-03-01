import Logger from '../utils/Logger';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, StatusBar, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextInputMask } from 'react-native-masked-text';
import { api } from '../../common';
import auth from '@react-native-firebase/auth';
import { FirebaseConfig } from '../../config/FirebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import i18n from '../i18n';
import { colors } from '../common/theme';
import GetPushToken from '../components/GetPushToken';
import moment from 'moment/min/moment-with-locales';
import {
  AuthLoadingScreen,
} from './';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { getUserId, getUserData, saveUserData } from '../utils/authUtils';


// ✅ Importar BackgroundLocationService para registrar a task de localização em background
// A task é definida no BackgroundLocationService quando o módulo é carregado
import '../services/BackgroundLocationService';

// ✅ Importar FeatureFlagService para inicializar feature flags
import featureFlagService from '../services/FeatureFlagService';

export default function AppCommon({ children }) {
  Logger.log("AppCommon - Iniciando renderização");

  const { t } = i18n;
  
  const [settings, setSettings] = useState(null);
  const [userData, setUserData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFirebaseInitialized, setIsFirebaseInitialized] = useState(false);
  const [isNavigationReady, setIsNavigationReady] = useState(false);
  const watcher = useRef();
  const locationOn = useRef(false);
  const initialFunctionsNotCalled = useRef(true);
  const authStillNotResponded = useRef(true);
  const authState = useRef('loading');
  const locationLoading = useRef(true);
  const fetchingToken = useRef(true);
  const langCalled = useRef();
  const [sound, setSound] = useState();
  const [playedSounds, setPlayedSounds] = useState([]);
  const [deviceId,setDeviceId] = useState();
  const [playing, setPlaying] = useState();
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [languagesData, setLanguagesData] = useState(null);
  const [error, setError] = useState({ flag: false });

  // Aguardar um tempo para garantir que a navegação esteja pronta
  useEffect(() => {
    const timer = setTimeout(() => {
      Logger.log('AppCommon - Navegação considerada pronta após timeout');
      setIsNavigationReady(true);
    }, 1000); // Aguardar 1 segundo

    return () => clearTimeout(timer);
  }, []);

  // Função para logar todos os dados do AsyncStorage
  const logAllAsyncStorageData = async () => {
    try {
      Logger.log('=== DADOS DO ASYNCSTORAGE ===');
      const allKeys = await AsyncStorage.getAllKeys();
      Logger.log('Chaves encontradas:', allKeys);
      
      for (const key of allKeys) {
        const value = await AsyncStorage.getItem(key);
        Logger.log(`\nChave: ${key}`);
        try {
          const parsedValue = JSON.parse(value);
          Logger.log('Valor:', JSON.stringify(parsedValue, null, 2));
        } catch (e) {
          Logger.log('Valor:', value);
        }
      }
      Logger.log('=== FIM DOS DADOS ===\n');
    } catch (error) {
      Logger.error('Erro ao ler AsyncStorage:', error);
    }
  };

  // Função para restaurar a sessão do usuário
  const restoreUserSession = async () => {
    try {
      // Primeiro, verificar se temos dados do usuário no AsyncStorage
      const storedUserData = await AsyncStorage.getItem('@user_data');
      if (storedUserData) {
        const parsedUserData = JSON.parse(storedUserData);
        Logger.log('Dados do usuário encontrados no AsyncStorage:', parsedUserData);
        
        if (parsedUserData.uid && parsedUserData.usertype) {
          setUserData(parsedUserData);
          return true;
        }
      }
      return false;
    } catch (error) {
      Logger.error('Erro ao restaurar sessão:', error);
      return false;
    }
  };

  // Função para salvar token (implementação básica)
  const saveToken = async () => {
    try {
      Logger.log('AppCommon - Salvando token...');
      // Implementação básica - pode ser expandida conforme necessário
      const token = await auth().currentUser?.getIdToken();
      if (token) {
        await AsyncStorage.setItem('@auth_token', token);
        Logger.log('AppCommon - Token salvo com sucesso');
      }
    } catch (error) {
      Logger.warn('AppCommon - Erro ao salvar token:', error);
    }
  };

  // Função para parar localização em background (usando BackgroundLocationService)
  const StopBackgroundLocation = async () => {
    try {
      Logger.log('AppCommon - Parando localização em background...');
      const BackgroundLocationService = require('../services/BackgroundLocationService').default;
      await BackgroundLocationService.stopBackgroundTracking();
      Logger.log('AppCommon - Localização em background parada');
    } catch (error) {
      Logger.warn('AppCommon - Erro ao parar localização:', error);
    }
  };

  // Inicializar Firebase e verificar autenticação
  useEffect(() => {
    Logger.log("AppCommon - Inicializando Firebase");
    const initializeFirebase = async () => {
      try {
        // Logar todos os dados do AsyncStorage
        await logAllAsyncStorageData();

        // Tentar restaurar a sessão do usuário
        const sessionRestored = await restoreUserSession();
        Logger.log('Sessão restaurada:', sessionRestored);

        // Verificar se o auth está disponível
        Logger.log("AppCommon - Verificando se auth está disponível...");
        const authInstance = auth();
        Logger.log("AppCommon - Auth instance:", authInstance);
        
        // Verificar usuário atual
        const currentUser = authInstance.currentUser;
        Logger.log("AppCommon - Usuário atual:", currentUser);

        // Configurar listener de autenticação
        Logger.log("AppCommon - Configurando onAuthStateChanged...");
        const unsubscribe = authInstance.onAuthStateChanged(async (user) => {
          Logger.log("AppCommon - Estado de autenticação mudou:", user ? "Usuário logado" : "Usuário não logado");
          
          if (user) {
            // Usuário está logado no Firebase
            const uid = user.uid;
            Logger.log("AppCommon - UID do usuário:", uid);
            
            // Se não temos dados do usuário, buscar do Firebase
            if (!userData) {
              try {
                const userData = await api.getUser(uid);
                if (userData) {
                  setUserData(userData);
                  await saveUserData(userData);
                  Logger.log('Dados do usuário salvos:', userData);
                }
              } catch (apiError) {
                Logger.warn('Erro ao buscar dados do usuário:', apiError);
              }
            }
          } else {
            // Usuário não está logado no Firebase
            Logger.log("AppCommon - Nenhum usuário logado no Firebase");
            // Não vamos limpar os dados do AsyncStorage aqui para manter a sessão
          }
          
          setIsFirebaseInitialized(true);
          setIsLoading(false);
        });

        // Fallback: se o listener não for chamado em 3 segundos, forçar inicialização
        setTimeout(() => {
          Logger.log("AppCommon - Fallback: onAuthStateChanged não foi chamado, forçando inicialização");
          if (!isFirebaseInitialized) {
            Logger.log("AppCommon - Forçando isFirebaseInitialized = true");
            setIsFirebaseInitialized(true);
            setIsLoading(false);
          }
        }, 3000);

        return () => {
          unsubscribe();
        };
      } catch (error) {
        Logger.error('Erro ao inicializar Firebase:', error);
        setIsFirebaseInitialized(true);
        setIsLoading(false);
      }
    };

    initializeFirebase();
  }, []); // Remover dependência de isNavigationReady

  // Carregar configurações e outros dados iniciais
  useEffect(() => {
    if (isFirebaseInitialized && !isLoading) {
      Logger.log("AppCommon - Carregando dados iniciais");
      const loadInitialData = async () => {
        try {
          // ✅ Inicializar Feature Flags
          await featureFlagService.initialize();
          Logger.log('✅ AppCommon - Feature Flags inicializadas');
          
          // Carregar configurações
          const settingsData = await api.getSettings();
          Logger.log('AppCommon - Settings Data Completo:', JSON.stringify(settingsData, null, 2));
          
          // Configurações padrão caso a API não retorne
          const defaultSettings = {
            decimal: 2,
            currency: 'R$',
            convert_to_mile: false,
            driverRadius: 10,
            useDistanceMatrix: false,
            imageIdApproval: false,
            term_required: false,
            coustomerBidPrice: false,
            coustomerBidPriceType: 'flat',
            bidprice: 0,
            AllowCriticalEditsAdmin: false,
            CompanyTermCondition: '',
            carType_required: false,
            horizontal_view: false,
            dynamicPricingEnabled: false // Padrão: desabilitado na fase inicial (baixa demanda)
          };

          // Mesclar configurações da API com as padrão
          const finalSettings = {
            ...defaultSettings,
            ...(settingsData || {})
          };

          Logger.log('AppCommon - Settings Final:', JSON.stringify(finalSettings, null, 2));
          Logger.log('AppCommon - Settings Decimal:', finalSettings.decimal);
          Logger.log('AppCommon - Settings Currency:', finalSettings.currency);

          if (finalSettings) {
            setSettings(finalSettings);
            await AsyncStorage.setItem('@settings', JSON.stringify(finalSettings));
            Logger.log('AppCommon - Settings salvo no AsyncStorage');
          }

          // Carregar idiomas
          try {
            const languagesData = await api.getLanguages();
            if (languagesData) {
              setLanguagesData(languagesData);
              await AsyncStorage.setItem('@languages', JSON.stringify(languagesData));
            }
          } catch (langError) {
            Logger.warn('Erro ao carregar idiomas:', langError);
          }

          // Carregar tipos de carro
          try {
            const carTypesData = await api.getCarTypes();
            if (carTypesData) {
              await AsyncStorage.setItem('@car_types', JSON.stringify(carTypesData));
            }
          } catch (carError) {
            Logger.warn('Erro ao carregar tipos de carro:', carError);
          }

          // Logar todos os dados do AsyncStorage após carregar os dados iniciais
          await logAllAsyncStorageData();
        } catch (error) {
          Logger.error('Erro ao carregar dados iniciais:', error);
        }
      };

      loadInitialData();
    }
  }, [isFirebaseInitialized, isLoading]);

  useEffect(() => {
    if (userData && languagesData && languagesData.langlist && settings && initialFunctionsNotCalled.current) {
      authStillNotResponded.current = false;
      if (userData.usertype) {
        authState.current= userData.usertype;
        if (userData.lang) {
          const lang = userData.lang;
          i18n.locale = lang['langLocale'];
          moment.locale(lang['dateLocale']);
        } else {
          // Fallback para português brasileiro se o usuário não tiver configuração de idioma
          i18n.locale = 'pt-BR';
          moment.locale('pt-br');
        }
        let role = userData.usertype;
        saveToken();
        fetchingToken.current = false;
        if (role === 'customer') {
          try {
            api.fetchDrivers('app');
          } catch (driverError) {
            Logger.warn('Erro ao buscar motoristas:', driverError);
          }
          initialFunctionsNotCalled.current = false;
        } else if (role === 'driver') {
          try {
            api.fetchTasks();
            api.fetchCars();
          } catch (taskError) {
            Logger.warn('Erro ao buscar tarefas/carros:', taskError);
          }
          initialFunctionsNotCalled.current = false;
        }
      }
    }
  }, [api, languagesData, settings, userData]);

  useEffect(() => {
    if (api && languagesData && languagesData.langlist && error && error.flag && !userData && settings) {
      locationLoading.current = false;
      authState.current= 'failed';
      authStillNotResponded.current = false;
      initialFunctionsNotCalled.current = true;
      fetchingToken.current = false;
      StopBackgroundLocation();
      try {
        api.clearLoginError();
      } catch (clearError) {
        Logger.warn('Erro ao limpar erro de login:', clearError);
      }
    }
    try {
      api.fetchusedreferral();
    } catch (referralError) {
      Logger.warn('Erro ao buscar referências usadas:', referralError);
    }
  }, [error, error?.flag, languagesData && languagesData.langlist, settings]);

  useEffect(() => {
    const authInstance = auth();
    const unsubscribe = authInstance.onAuthStateChanged(async (user) => {
      setFirebaseUser(user);
      setIsAuthReady(true);
      
      // Se não tiver usuário no Firebase Auth, mas tiver UID no AsyncStorage
      if (!user) {
        const storedUid = await AsyncStorage.getItem('@auth_uid');
        if (storedUid) {
          // Usar o UID do AsyncStorage para autenticação
          const userData = await AsyncStorage.getItem('@user_data');
          if (userData) {
            // dispatch(fetchBookings()); // COMENTAR
            // dispatch(fetchUserCancelReasons()); // COMENTAR
            // dispatch(fetchUserPromos()); // COMENTAR
          }
        }
      } else {
        // Se tiver usuário no Firebase Auth, usar normalmente
        // dispatch(fetchBookings()); // COMENTAR
        // dispatch(fetchUserCancelReasons()); // COMENTAR
        // dispatch(fetchUserPromos()); // COMENTAR
      }
    });
    return () => unsubscribe();
  }, [api]);

  const hideSplash = async () => {
    try {
      await SplashScreen.hideAsync();
    } catch (splashError) {
      Logger.warn('Erro ao esconder splash:', splashError);
    }
  };
  hideSplash();

  // Aguardar apenas a inicialização do Firebase
  if (isLoading || !isFirebaseInitialized) {
    Logger.log("AppCommon - Aguardando inicialização:", { 
      isFirebaseInitialized, 
      isLoading
    });
    return <AuthLoadingScreen />;
  }

  Logger.log("AppCommon - Renderizando children");
  return (
    <>
      {children}
    </>
  );
} 