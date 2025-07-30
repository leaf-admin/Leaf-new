import { useState, useEffect, useRef } from 'react';
import * as TaskManager from 'expo-task-manager';
import { Alert, Platform, View, ActivityIndicator } from 'react-native';
import i18n from './src/i18n';
import { colors } from './src/common/theme';
import GetPushToken from './src/components/GetPushToken';
import AsyncStorage from '@react-native-async-storage/async-storage';
import moment from 'moment/min/moment-with-locales';
import {
  AuthLoadingScreen,
} from './src/screens';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import auth from '@react-native-firebase/auth';
import { api } from './src/common-local';

// Configurar moment.js para português
moment.locale('pt-br');

const LOCATION_TASK_NAME = 'background-location-task';

TaskManager.defineTask(LOCATION_TASK_NAME, ({ data: { locations }, error }) => {
  if (error) {
    return;
  }
  if (locations.length > 0) {
    let location = locations[locations.length - 1];
    if (location.coords) {
      // Salvar localização no AsyncStorage em vez do Redux
      AsyncStorage.setItem('@last_location', JSON.stringify({
        lat: location.coords.latitude,
        lng: location.coords.longitude
      }));
    }
  }
});

export default function AppCommon({ children }) {
  const { t } = i18n;
  const [gps, setGps] = useState(null);
  const [activeBooking, setActiveBooking] = useState(null);
  const [lastLocation, setLastLocation] = useState(null);
  const [settings, setSettings] = useState(null);
  const watcher = useRef();
  const locationOn = useRef(false);
  const [languagedata, setLanguagedata] = useState({ langlist: null });
  const initialFunctionsNotCalled = useRef(true);
  const authStillNotResponded = useRef(true);
  const authState = useRef('loading');
  const locationLoading = useRef(true);
  const fetchingToken = useRef(true);
  const langCalled = useRef();
  const [tasks, setTasks] = useState([]);
  const [sound, setSound] = useState();
  const [playedSounds, setPlayedSounds] = useState([]);
  const [deviceId,setDeviceId] = useState();
  const [playing, setPlaying] = useState();
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isFirebaseInitialized, setIsFirebaseInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Verificar inicialização do Firebase
  useEffect(() => {
    let isMounted = true;
    const checkFirebaseInit = async () => {
      try {
        if (!auth()) {
          if (isMounted) {
            setTimeout(checkFirebaseInit, 100);
          }
          return;
        }

        if (isMounted) {
          setIsFirebaseInitialized(true);
          setIsLoading(false);
        }
      } catch (error) {
        if (isMounted) {
          setTimeout(checkFirebaseInit, 100);
        }
      }
    };

    checkFirebaseInit();
    return () => {
      isMounted = false;
    };
  }, []);

  // Só iniciar o listener de auth quando o Firebase estiver inicializado
  useEffect(() => {
    if (!isFirebaseInitialized) return;

    let isMounted = true;
    const unsubscribe = auth().onAuthStateChanged(async (user) => {
      if (!isMounted) return;
      
      setFirebaseUser(user);
      setIsAuthReady(true);
      
      try {
        // Se não tiver usuário no Firebase Auth, mas tiver UID no AsyncStorage
        if (!user) {
          const storedUid = await AsyncStorage.getItem('@auth_uid');
          if (storedUid) {
            // Usar o UID do AsyncStorage para autenticação
            const userData = await AsyncStorage.getItem('@user_data');
            if (userData) {
              const parsedData = JSON.parse(userData);
            }
          }
        } else {
          if (user.uid) {
            // Não fazer chamadas automáticas aqui
          }
        }
      } catch (error) {
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isFirebaseInitialized]);

  const loadSound = async () => {
    Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
    });

    const { sound } = await Audio.Sound.createAsync(settings.CarHornRepeat?require('./assets/sounds/repeat.wav'):require('./assets/sounds/horn.wav'));
    setSound(sound);
  }
  
  useEffect(()=>{
    if(settings){
      loadSound();
    }
  },[settings]);

  useEffect(() => {
      AsyncStorage.getItem('deviceId', (err, result) => {
        if (result) {
          setDeviceId(result);
        } else {
          const ID = "id" + new Date().getTime();
          AsyncStorage.setItem('deviceId',ID);
          setDeviceId(ID);
        }
      });
  }, []);

  useEffect(() => {
    if (api) {
      api.fetchSettings();
      api.fetchLanguages();
      api.fetchCarTypes();
      langCalled.current = true;
    }
  }, [api]);

  useEffect(() => {
    if (languagedata.langlist && langCalled.current) {
      let obj = {};
      let defl = {};
      for (const value of Object.values(languagedata.langlist)) {
        obj[value.langLocale] = value.keyValuePairs;
        if (value.default) {
          defl = value;
        }
      }
      
      // Manter português como padrão
      i18n.locale = 'pt-BR';
      i18n.defaultLocale = 'pt-BR';
      moment.locale('pt-br');
    }
  }, [languagedata.langlist, langCalled.current]);

  useEffect(() => {
    if (languagedata.langlist && langCalled.current) {
      api.fetchUser();
    }
  }, [languagedata.langlist, langCalled.current]);

  // Adicione um log para o estado de autenticação
  useEffect(() => {
  }, [authState.current]);

  // Adicione um log para as configurações
  useEffect(() => {
  }, [settings]);

  useEffect(() => {
    if (authState.current && authState.current.usertype && authState.current.usertype == 'driver' && tasks && tasks.length > 0) {
      notifyBooking();
    }
  }, [authState.current, tasks]);

  _onPlaybackStatusUpdate = playbackStatus => {
    if (!playbackStatus.isLoaded) {
      if (playbackStatus.error) {

      }
    } else {
      if (playbackStatus.isPlaying) {
         setPlaying(true);
      } else {
        setPlaying(false);
      }
      if (playbackStatus.isBuffering) {

      }
      if (playbackStatus.didJustFinish && !playbackStatus.isLooping) {
        setPlaying(false);
        sound.stopAsync();
      }

    }
  };

  const notifyBooking = async () => {
    for(let i=0;i<tasks.length;i++){
      if(!playedSounds.includes(tasks[i].id)){
        let newArr = [...playedSounds];
        newArr.push(tasks[i].id);
        if(!playing){
          sound.playAsync();
          sound.setOnPlaybackStatusUpdate(_onPlaybackStatusUpdate);
        }
        setPlayedSounds(newArr);
      }
    }
  }

  useEffect(() => {
    if (gps && gps.location && gps.location.lat && gps.location.lng) {
      locationLoading.current = false;
      if (authState.current && authState.current.usertype && authState.current.usertype == 'driver' ) {
        api.saveUserLocation({
          lat: gps.location.lat,
          lng: gps.location.lng
        });
      }
      if (activeBooking && authState.current && authState.current.usertype && authState.current.usertype == 'driver') {
        if (lastLocation && (activeBooking.status == 'ACCEPTED' || activeBooking.status == 'STARTED')) {
          let diff = api.GetDistance(lastLocation.lat, lastLocation.lng, gps.location.lat, gps.location.lng);
          if (diff > 0.010 && activeBooking.driverDeviceId === deviceId) {
            api.saveTracking(activeBooking.id, {
              at: new Date().getTime(),
              status: activeBooking.status,
              lat: gps.location.lat,
              lng: gps.location.lng
            });
          }
        }
        if(!lastLocation && activeBooking.status == 'ACCEPTED'){
          api.saveTracking(activeBooking.id, {
            at: new Date().getTime(),
            status: activeBooking.status,
            lat: gps.location.lat,
            lng: gps.location.lng
          });
        }
        if (activeBooking.status == 'ACCEPTED') {
          let diff = api.GetDistance(activeBooking.pickup.lat, activeBooking.pickup.lng, gps.location.lat, gps.location.lng);
          if (diff < 0.02) {
            let bookingData = activeBooking;
            bookingData.status = 'ARRIVED';
            api.updateBooking(bookingData);
            api.saveTracking(activeBooking.id, {
              at: new Date().getTime(),
              status: 'ARRIVED',
              lat: gps.location.lat,
              lng: gps.location.lng
            });
          }
        }
      }
    }
  }, [gps]);

  useEffect(() => {
    if (authState.current
      && authState.current.usertype
      && authState.current.usertype == 'driver'
      && authState.current.driverActiveStatus
    ) {
      if (!locationOn.current) {
        locationOn.current = true;
        if (Platform.OS == 'android') {
          AsyncStorage.getItem('firstRun', (err, result) => {
            if (result) {
              StartBackgroundLocation();
            } else {
              Alert.alert(
                t('disclaimer'),
                t('disclaimer_text'),
                [
                  {
                    text: t('ok'), onPress: () => {
                      AsyncStorage.setItem('firstRun', 'OK');
                      StartBackgroundLocation();
                    }
                  }
                ],
                { cancelable: false }
              );
            }
          });
        } else {
          StartBackgroundLocation();
        }
      }
    }
    if (authState.current
      && authState.current.usertype
      && authState.current.usertype == 'driver'
      && authState.current.driverActiveStatus == false
    ) {
      if (locationOn.current) {
        locationOn.current = false;
        StopBackgroundLocation();
      } else {
        api.saveUserLocation({
          error:true
        });
        locationLoading.current = false;
      }
    }
    if (authState.current
      && authState.current.usertype
      && authState.current.usertype == 'customer'
    ) {
      if (!locationOn.current) {
        locationOn.current = true;
        GetOneTimeLocation();
      }
    }
  }, [authState.current]);

  const saveToken = async () => {
    let token = await GetPushToken();
    if((authState.current && authState.current.pushToken && authState.current.pushToken != token) || !(authState.current && authState.current.pushToken) ){
      api.updatePushToken(
        token ? token : 'token_error',
        Platform.OS == 'ios' ? 'IOS' : 'ANDROID'
      );
    }
  };

  const GetOneTimeLocation = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      try {
        let tempWatcher = await Location.watchPositionAsync({
          accuracy: Location.Accuracy.Balanced
        }, location => {
          api.saveUserLocation({
            lat: location.coords.latitude,
            lng: location.coords.longitude
          });
          tempWatcher.remove();
        })
      } catch (error) {
        api.saveUserLocation({
          error:true
        });
        locationLoading.current = false;
      }
    } else {
      api.saveUserLocation({
        error:true
      });
      locationLoading.current = false;
    }
  }

  const StartBackgroundLocation = async () => {
    let permResp = await Location.requestForegroundPermissionsAsync();
    let tempWatcher = await Location.watchPositionAsync({
      accuracy: Location.Accuracy.Balanced
    }, location => {
      api.saveUserLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude
      });
      tempWatcher.remove();
    })
    if (permResp.status == 'granted') {
      try {
        let { status } = await Location.requestBackgroundPermissionsAsync();
        if (status === 'granted') {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.BestForNavigation,
            showsBackgroundLocationIndicator: true,
            activityType: Location.ActivityType.AutomotiveNavigation,
            foregroundService: {
              notificationTitle: t('locationServiveTitle'),
              notificationBody: t('locationServiveBody'),
              notificationColor: colors.SKY
            }
          });
        } else {
          if (__DEV__) {
            StartForegroundGeolocation();
          } else {
            api.saveUserLocation({
              error:true
            });
            locationLoading.current = false;
          }
        }
      } catch (error) {
        if (__DEV__) {
          StartForegroundGeolocation();
        } else {
          api.saveUserLocation({
            error:true
          });
          locationLoading.current = false;
        }
      }
    } else {
      api.saveUserLocation({
        error:true
      });
      locationLoading.current = false;
    }
  }

  const StartForegroundGeolocation = async () => {
    watcher.current = await Location.watchPositionAsync({
      accuracy: Location.Accuracy.High,
      activityType: Location.ActivityType.AutomotiveNavigation,
    }, location => {
      api.saveUserLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude
      });
    });
  }

  const StopBackgroundLocation = async () => {
    locationOn.current = false;
    try {
      TaskManager.getRegisteredTasksAsync().then((res) => {
        if (res.length > 0) {
          for (let i = 0; i < res.length; i++) {
            if (res[i].taskName == LOCATION_TASK_NAME) {
              Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
              break;
            }
          }
        } else {
          if (watcher.current) {
            watcher.current.remove();
          }
        }
      });
    } catch (error) {
    }
  }

  useEffect(() => {
    if (authState.current && languagedata && languagedata.langlist && settings && initialFunctionsNotCalled.current) {
      authStillNotResponded.current = false;
      if (authState.current.usertype) {
        authState.current = authState.current.usertype;
        if (authState.current.lang) {
          const lang = authState.current.lang;
          i18n.locale = lang['langLocale'];
          moment.locale(lang['dateLocale']);
        }
        let role = authState.current.usertype;
          saveToken();
          fetchingToken.current = false;
          if (role === 'customer') {
            api.fetchDrivers('app');
            initialFunctionsNotCalled.current = false;
          } else if (role === 'driver') {
            api.fetchTasks();
            api.fetchCars();
            initialFunctionsNotCalled.current = false;
          }
          else {
            Alert.alert(t('alert'), t('not_valid_user_type'));
            api.signOff();
          }
      } else {
        Alert.alert(t('alert'), t('user_issue_contact_admin'));
        api.signOff();
      }
    }
  }, [authState.current, languagedata, languagedata.langlist, settings]);


  useEffect(() => {
    if (api && languagedata && languagedata.langlist && authState.current && authState.current.error && authState.current.error.flag && !authState.current && settings) {
      locationLoading.current = false;
      authState.current = 'failed';
      authStillNotResponded.current = false;
      initialFunctionsNotCalled.current = true;
      fetchingToken.current = false;
      StopBackgroundLocation();
      api.clearLoginError();
    }
    api.fetchusedreferral()
  }, [authState.current, authState.current?.error, authState.current?.error?.flag, languagedata && languagedata.langlist, settings]);

  const hideSplash = async () => {
    await SplashScreen.hideAsync();
  };
  hideSplash();

  if (isLoading || !isFirebaseInitialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.SKY} />
      </View>
    );
  }

  return children;
}