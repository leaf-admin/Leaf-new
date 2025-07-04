import React, { useEffect, useState } from "react";
import CircularLoading from "../components/CircularLoading";
import { useDispatch } from "react-redux";
import { api } from "common";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import moment from "moment/min/moment-with-locales";
import { getAuth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

function AuthLoading(props) {
  const { t } = useTranslation();
  const {
    fetchUser,
    fetchCarTypes,
    fetchSettings,
    fetchBookings,
    fetchCancelReasons,
    fetchPromos,
    fetchDriverEarnings,
    fetchUsers,
    fetchNotifications,
    fetchEarningsReport,
    signOff,
    fetchWithdraws,
    fetchPaymentMethods,
    fetchLanguages,
    fetchWalletHistory,
    fetchCars,
    fetchComplain,
    fetchSMTP,
    fetchSos,
    fetchSMSConfig,
    fetchFleetAdminEarnings
  } = api;
  const dispatch = useDispatch();
  const [authState, setAuthState] = useState({ profile: null });
  const [settings, setSettings] = useState(null);
  const [languageData, setLanguageData] = useState(null);
  const [isProfileReady, setIsProfileReady] = useState(false);

  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const userData = await AsyncStorage.getItem('@user_data');
        const settingsData = await AsyncStorage.getItem('@settings');
        const langData = await AsyncStorage.getItem('@language_data');
        
        if (userData) {
          const profile = JSON.parse(userData);
          setAuthState({ profile });
        }
        if (settingsData) {
          setSettings(JSON.parse(settingsData));
        }
        if (langData) {
          setLanguageData(JSON.parse(langData));
        }
      } catch (error) {
        console.error('Erro ao carregar estado inicial:', error);
      }
    };

    loadInitialState();
  }, []);

  useEffect(() => {
    dispatch(fetchSettings());
  }, [dispatch, fetchSettings]);

  useEffect(() => {
    let obj = {};
    let def1 = {};
    if (languageData && languageData.langlist) {
      for (const value of Object.values(languageData.langlist)) {
        obj[value.langLocale] = value.keyValuePairs;
        if (value.default === true) {
          def1 = value;
          break;
        }
      }
      if(def1 && def1.langLocale){
        const result = localStorage.getItem('lang');
        if (result) {
          let langLocale = JSON.parse(result)['langLocale'];
          let dateLocale = JSON.parse(result)['dateLocale'];
          i18n.addResourceBundle(
            langLocale,
            "translations",
            obj[langLocale]
          );
          i18n.changeLanguage(langLocale);
          moment.locale(dateLocale);
        } else {
          i18n.addResourceBundle(
            def1.langLocale,
            "translations",
            obj[def1.langLocale]
          );
          i18n.changeLanguage(def1.langLocale);
          moment.locale(def1.dateLocale);
        }
      }

      dispatch(fetchUser());
    }
  }, [languageData, dispatch, fetchUser]);

  useEffect(() => {
    if (settings && settings.settings) {
      dispatch(fetchLanguages());
      dispatch(fetchCarTypes());
      document.title = settings.settings.appName;
    }
  }, [settings, dispatch, fetchLanguages, fetchCarTypes]);

  useEffect(() => {
    let unsubscribe;
    let initialized = false;

    const checkAndFetch = async (firebaseUser) => {
      if (initialized) return;
      initialized = true;

      // Busca multiplataforma
      const userData = await getUserData();
      console.log('[AuthLoading] Dados do userData utilitário:', userData);
      console.log('[AuthLoading] Firebase Auth user:', firebaseUser);

      if (
        firebaseUser &&
        userData &&
        firebaseUser.uid === userData.uid
      ) {
        const token = await firebaseUser.getIdToken();
        console.log('[AuthLoading] Token obtido:', token ? 'Sim' : 'Não');
        
        // Aguardar o perfil estar disponível
        if (!authState.profile || !authState.profile.usertype) {
          console.log('[AuthLoading] Aguardando perfil estar disponível...');
          return;
        }

        // Marcar perfil como pronto
        setIsProfileReady(true);
        
        let role = authState.profile.usertype;
        console.log('[AuthLoading] Iniciando carregamento de dados para role:', role);
        
        // Função auxiliar para garantir que o perfil existe antes de cada fetch
        const safeFetch = (fetchFn) => {
          if (!authState.profile || !authState.profile.usertype) {
            console.warn('[AuthLoading] Tentativa de fetch sem perfil disponível:', fetchFn.name);
            return Promise.resolve();
          }
          return dispatch(fetchFn());
        };

        try {
          if (role === "customer") {
            await Promise.all([
              safeFetch(fetchBookings),
              safeFetch(fetchWalletHistory),
              safeFetch(fetchPaymentMethods),
              safeFetch(fetchCancelReasons),
              safeFetch(fetchUsers)
            ]);
          } else if (role === "driver") {
            await Promise.all([
              safeFetch(fetchBookings),
              safeFetch(fetchWithdraws),
              safeFetch(fetchPaymentMethods),
              safeFetch(fetchCars),
              safeFetch(fetchWalletHistory)
            ]);
          } else if (role === "admin") {
            await Promise.all([
              safeFetch(fetchUsers),
              safeFetch(fetchBookings),
              safeFetch(fetchPromos),
              safeFetch(fetchDriverEarnings),
              safeFetch(fetchFleetAdminEarnings),
              safeFetch(fetchNotifications),
              safeFetch(fetchEarningsReport),
              safeFetch(fetchCancelReasons),
              safeFetch(fetchWithdraws),
              safeFetch(fetchComplain),
              safeFetch(fetchPaymentMethods),
              safeFetch(fetchCars),
              safeFetch(fetchSMTP),
              safeFetch(fetchSMSConfig),
              safeFetch(fetchSos)
            ]);
          } else if (role === "fleetadmin") {
            await Promise.all([
              safeFetch(fetchUsers),
              safeFetch(fetchBookings),
              safeFetch(fetchDriverEarnings),
              safeFetch(fetchCars),
              safeFetch(fetchCancelReasons),
              safeFetch(fetchPaymentMethods),
              safeFetch(fetchWalletHistory)
            ]);
          } else {
            alert(t("not_valid_user_type"));
            dispatch(signOff());
          }
        } catch (error) {
          console.error('[AuthLoading] Erro ao carregar dados:', error);
        }
      } else {
        // Divergência: forçar logout e limpar storage
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.removeItem('userData');
        } else {
          let AsyncStorage;
          try {
            AsyncStorage = require('@react-native-async-storage/async-storage').default;
            AsyncStorage.removeItem('userData');
          } catch (e) {}
        }
        alert(t("user_issue_contact_admin"));
        dispatch(signOff());
      }
    };

    const authInstance = getAuth();
    unsubscribe = authInstance.onAuthStateChanged((user) => {
      checkAndFetch(user);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [authState.profile, dispatch, t]);

  return settings && settings.loading ? (
    <CircularLoading />
  ) : settings && settings.settings ? (
    authState.loading || !languageData || !languageData.langlist || !isProfileReady ? (
      <CircularLoading />
    ) : (
      props.children
    )
  ) : (
    <div>
      <span>No Database Settings found</span>
    </div>
  );
}

export default AuthLoading;
