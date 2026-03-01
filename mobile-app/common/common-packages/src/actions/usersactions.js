import {
  FETCH_ALL_USERS,
  FETCH_ALL_USERS_SUCCESS,
  FETCH_ALL_USERS_FAILED,
  EDIT_USER,
  EDIT_USER_SUCCESS,
  EDIT_USER_FAILED,
  DELETE_USER,
  DELETE_USER_SUCCESS,
  DELETE_USER_FAILED,
  FETCH_ALL_USERS_STATIC,
  FETCH_ALL_USERS_STATIC_SUCCESS,
  FETCH_ALL_USERS_STATIC_FAILED,
  USER_DELETED,
  FETCH_ALL_DRIVERS,
  FETCH_ALL_DRIVERS_SUCCESS,
  FETCH_ALL_DRIVERS_FAILED
} from "../store/types";
import { firebase } from '../config/configureFirebase';
import { api } from '../api';
import { store } from '../store/store';
import { USERS_LOADING, USERS_LOADED, USERS_ERROR } from '../store/types';
import { getAuth } from '@react-native-firebase/auth';
import { get, set, push, remove, update, onValue, off, signOut, ref } from '@react-native-firebase/database';
import { waitForFirebaseInit } from '../utils/firebaseUtils';
import getUserData from '../utils/getUserData';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadBytesResumable, getDownloadURL } from '@react-native-firebase/storage';
import { GetDistance } from '../other/GeoFunctions';
import { Platform } from 'react-native';

export const fetchUsers = () => (dispatch) => {
  const usersRef = ref(firebase.database, 'users');

  dispatch({
    type: FETCH_ALL_USERS,
    payload: null
  });

  onValue(usersRef, snapshot => {
    if (snapshot.val()) {
      const data = snapshot.val();
      const arr = Object.keys(data).map(i => {
        return {
          id: i,
          ...data[i]
        };
      });
      dispatch({
        type: FETCH_ALL_USERS_SUCCESS,
        payload: arr
      });
    } else {
      dispatch({
        type: FETCH_ALL_USERS_FAILED,
        payload: "No users available."
      });
    }
  });
};

export const fetchUsersOnce = () => (dispatch) => {
  const usersRef = ref(firebase.database, 'users');

  dispatch({
    type: FETCH_ALL_USERS,
    payload: null
  });

  onValue(usersRef, snapshot => {
    if (snapshot.val()) {
      const data = snapshot.val();
      const arr = Object.keys(data).map(i => {
        return {
          id: i,
          ...data[i]
        };
      });
      dispatch({
        type: FETCH_ALL_USERS_SUCCESS,
        payload: arr
      });
    } else {
      dispatch({
        type: FETCH_ALL_USERS_FAILED,
        payload: "No users available."
      });
    }
  }, { onlyOnce: true });
};

export const clearFetchDrivers = () => (dispatch) => {
  const {
    driversRef,
    allLocationsRef,
  } = firebase;
  off(driversRef);
  off(allLocationsRef);
}

export const fetchDrivers = (appType) => async(dispatch) => {
  const {
    driversRef,
    allLocationsRef,
    settingsRef,
  } = firebase;

  const settingsdata = await get(settingsRef);
  const settings = settingsdata.val();

  dispatch({
    type: FETCH_ALL_USERS,
    payload: null
  });

  onValue(driversRef, snapshot => {
    if (snapshot.val()) {
      onValue(allLocationsRef, locres=>{
        const locations = locres.val();
          const data = snapshot.val();
          const arr = Object.keys(data)
          .filter(i => data && data[i].approved == true && data[i].driverActiveStatus == true && locations && locations[i] && ( (data[i].licenseImage && settings.license_image_required) || !settings.license_image_required)
                      && (((data[i].carApproved && settings.carType_required) || !settings.carType_required) || !settings.carType_required) && ((data[i].term && settings.term_required) || !settings.term_required) ) 
          .map(i => {
            return {
              id: i,
              location: locations && locations[i] ? locations[i]:null,
              carType: data[i].carType ? data[i].carType : null,
              vehicleNumber:  data[i].vehicleNumber ? data[i].vehicleNumber : null,
              fleetadmin:  data[i].fleetadmin ? data[i].fleetadmin : null,
              firstName: data[i].firstName,
              lastName: data[i].lastName,
              queue: data[i].queue
            };
          });
          dispatch({
            type: FETCH_ALL_DRIVERS_SUCCESS,
            payload: arr
          });
        }, appType === 'app' ? {onlyOnce: true} : settings && settings.realtime_drivers ? null : {onlyOnce: true})
    } else {
      dispatch({
        type: FETCH_ALL_DRIVERS_FAILED,
        payload: "No users available."
      });
    }
  },appType === 'app'? {onlyOnce: true}: settings && settings.realtime_drivers ? null : {onlyOnce: true});
};

export const addUser = (userdata) => (dispatch) => {
  const {
    usersRef
  } = firebase;

  dispatch({
    type: EDIT_USER,
    payload: userdata
  });

  delete userdata.tableData;

  push(usersRef, userdata).then(() => {
    dispatch({
      type: EDIT_USER_SUCCESS,
      payload: null
    });
  }).catch((error) => {
    dispatch({
      type: EDIT_USER_FAILED,
      payload: error
    });
  });
}

export const editUser = (id, user) => (dispatch) => {
  const {
    singleUserRef
  } = firebase;

  dispatch({
    type: EDIT_USER,
    payload: user
  });
  let editedUser = user;
  delete editedUser.id;
  delete editedUser.tableData;
  set(singleUserRef(id), editedUser);
}

export const updateUserCar = (id, data) => (dispatch) => {
  const {
    singleUserRef
  } = firebase;

  dispatch({
    type: EDIT_USER,
    payload: data  
  });
  update(singleUserRef(id),data);
}

export const updateLicenseImage = (uid, imageBlob, imageType) => async (dispatch) => {
  const {
    singleUserRef,
    driverDocsRef,
    driverDocsRefBack,
    verifyIdImageRef
  } = firebase;

  let profile = {};
  if(imageType === 'licenseImage'){
    await uploadBytesResumable(driverDocsRef(uid),imageBlob);
    let image = await getDownloadURL(driverDocsRef(uid));
    profile.licenseImage = image;
  }
  if(imageType === 'licenseImageBack'){
    await uploadBytesResumable(driverDocsRefBack(uid),imageBlob);
    let image1 = await getDownloadURL(driverDocsRefBack(uid));
    profile.licenseImageBack = image1;
  }
  if(imageType === 'verifyIdImage'){
    await uploadBytesResumable(verifyIdImageRef(uid),imageBlob);
    let image1 = await getDownloadURL(verifyIdImageRef(uid));
    profile.verifyIdImage = image1;
  }
  update(singleUserRef(uid),profile);
  dispatch({
    type: EDIT_USER,
    payload: uid
  });
};

export const deleteUser = (uid) => (dispatch) => {
  const {
    auth,
    walletHistoryRef,
    singleUserRef,
    userNotificationsRef,
    carsRef,
    carEditRef
  } = firebase;

  dispatch({
    type: DELETE_USER,
    payload: uid
  });

  if (auth.currentUser.uid === uid) {
    off(singleUserRef(uid));
    off(walletHistoryRef(uid));
    off(userNotificationsRef(uid));
  }

  onValue(singleUserRef(uid), userdata => {
    const profile = userdata.val();
    if(profile.usertype === 'driver'){
      onValue(carsRef(uid, profile.usertype), carssnapshot => {
        let cars = carssnapshot.val();
        if (cars) {
          const arr = Object.keys(cars);
          for(let i = 0; i < arr.length; i++){
            remove(carEditRef(arr[i]));
          }
        }
      });
    } 
    
    remove(singleUserRef(uid)).then(() => {
      if (auth.currentUser.uid === uid) {
        signOut(auth);
        dispatch({
          type: USER_DELETED,
          payload: null
        });
      } else {
        remove(singleUserRef(uid)).then(() => {
          dispatch({
            type: DELETE_USER_SUCCESS,
            payload: null
          });
        }).catch((error) => {
          dispatch({
            type: DELETE_USER_FAILED,
            payload: error
          });
        });
      }
    });
  },{onlyOnce:true});
}

export const fetchUserBookings = () => async (dispatch) => {
  try {
    await waitForFirebaseInit();
    console.log('fetchUserBookings - Firebase Database inicializado');

    const uid = await getUserId();
    if (!uid) {
      console.error('fetchUserBookings - UID não encontrado');
      return;
    }

    const userInfo = store.getState().auth.profile;
    if (!userInfo || !userInfo.usertype) {
      console.error('fetchUserBookings - Tipo de usuário não encontrado');
      return;
    }

    console.log('fetchUserBookings - Caminho completo:', firebase.bookingListRef(uid, userInfo.usertype).toString());
    
    onValue(firebase.bookingListRef(uid, userInfo.usertype), (snapshot) => {
      if (snapshot.val()) {
        const data = snapshot.val();
        dispatch({
          type: 'FETCH_USER_BOOKINGS_SUCCESS',
          payload: data
        });
      } else {
        dispatch({
          type: 'FETCH_USER_BOOKINGS_FAILED',
          payload: 'Nenhuma reserva encontrada'
        });
      }
    }, (error) => {
      console.error('fetchUserBookings - Erro ao buscar dados:', error);
      dispatch({
        type: 'FETCH_USER_BOOKINGS_FAILED',
        payload: error.message || 'Erro ao buscar reservas'
      });
    });
  } catch (error) {
    console.error('fetchUserBookings - Erro:', error);
    dispatch({
      type: 'FETCH_USER_BOOKINGS_FAILED',
      payload: error.message || 'Erro ao buscar reservas'
    });
  }
};

// Utilitário para aguardar até que o currentUser esteja disponível
const waitForAuth = async (maxTries = 30, interval = 200) => {
  const authInstance = getAuth();
  let tries = 0;
  while (!authInstance.currentUser && tries < maxTries) {
    console.log(`[waitForAuth] Tentativa ${tries + 1}: currentUser ainda null`);
    await new Promise(res => setTimeout(res, interval));
    tries++;
  }
  if (authInstance.currentUser) {
    console.log('[waitForAuth] currentUser disponível:', authInstance.currentUser.uid);
    return authInstance.currentUser;
  } else {
    console.warn('[waitForAuth] currentUser permaneceu null após várias tentativas');
    return null;
  }
};

export const fetchUserCancelReasons = () => async (dispatch) => {
  console.log('=== NOVA VERSAO fetchUserCancelReasons ===');
  try {
    await waitForFirebaseInit();
    console.log('fetchUserCancelReasons - Firebase Database inicializado');

    const cancelReasonsRef = get(firebase.database, 'cancel_reason');
    console.log('fetchUserCancelReasons - Caminho acessado:', cancelReasonsRef.toString());

    // Desligar listener existente antes de criar um novo (se houver)
    off(cancelReasonsRef);

    const listener = onValue(cancelReasonsRef, (snapshot) => {
      if (snapshot.val()) {
        const data = snapshot.val();
        dispatch({
          type: 'FETCH_CANCEL_REASONS_SUCCESS',
          payload: data
        });
      } else {
        dispatch({
          type: 'FETCH_CANCEL_REASONS_FAILED',
          payload: 'Nenhum motivo de cancelamento encontrado'
        });
      }
    }, (error) => {
      console.error('fetchUserCancelReasons - Erro ao buscar dados:', error);
      dispatch({
        type: 'FETCH_CANCEL_REASONS_FAILED',
        payload: error.message
      });
    });

    // Retornar o método de desligamento do listener
    return listener;

  } catch (error) {
    console.error('fetchUserCancelReasons - Erro:', error);
    dispatch({
      type: 'FETCH_CANCEL_REASONS_FAILED',
      payload: error.message
    });
    // Em caso de erro, garantir que nenhum listener fique ativo
     if (firebase.database) {
         const cancelReasonsRef = get(firebase.database, 'cancel_reason');
         off(cancelReasonsRef);
     }
  }
};

// Nova action para desligar o listener de motivos de cancelamento
export const unsubscribeCancelReasons = () => (dispatch, getState) => {
    const state = getState();
    // Assumindo que o listener é salvo em algum lugar do estado Redux (precisará de ajuste no reducer)
    // const listener = state.algumReducer.cancelReasonsListener;
    // if (listener && typeof listener === 'function') {
    //     console.log('Desligando listener de motivos de cancelamento');
    //     listener();
    // }
    // Como alternativa, podemos desligar pela referência direta se o listener não for salvo no estado
    if (firebase.database) {
        console.log('Tentando desligar listener de motivos de cancelamento pela referência');
        const cancelReasonsRef = get(firebase.database, 'cancel_reason');
        off(cancelReasonsRef);
    } else {
        console.warn('Firebase Database não disponível para desligar listener de motivos de cancelamento');
    }
};

export const fetchUserPaymentMethods = () => async (dispatch) => {
  try {
    await waitForFirebaseInit();
    console.log('fetchUserPaymentMethods - Firebase Database inicializado');

    const uid = await getUserId();
    if (!uid) {
      console.error('fetchUserPaymentMethods - UID não encontrado');
      return;
    }

    const userInfo = store.getState().auth.profile;
    if (!userInfo || !userInfo.usertype) {
      console.error('fetchUserPaymentMethods - Tipo de usuário não encontrado');
      return;
    }

    console.log('fetchUserPaymentMethods - Iniciando busca com:', { uid, usertype: userInfo.usertype });

    const methodsRef = get(firebase.database, `payment_methods/${uid}`);
    
    onValue(methodsRef, (snapshot) => {
      if (snapshot.val()) {
        const data = snapshot.val();
        dispatch({
          type: 'FETCH_USER_PAYMENT_METHODS_SUCCESS',
          payload: data
        });
      } else {
        dispatch({
          type: 'FETCH_USER_PAYMENT_METHODS_FAILED',
          payload: 'Nenhum método de pagamento encontrado'
        });
      }
    }, (error) => {
      console.error('fetchUserPaymentMethods - Erro ao buscar dados:', error);
      dispatch({
        type: 'FETCH_USER_PAYMENT_METHODS_FAILED',
        payload: error.message || 'Erro ao buscar métodos de pagamento'
      });
    });
  } catch (error) {
    console.error('fetchUserPaymentMethods - Erro:', error);
    dispatch({
      type: 'FETCH_USER_PAYMENT_METHODS_FAILED',
      payload: error.message || 'Erro ao buscar métodos de pagamento'
    });
  }
};

export const fetchUserPromos = () => async (dispatch) => {
  console.log('=== NOVA VERSAO fetchUserPromos ===');
  try {
    await waitForFirebaseInit();
    console.log('fetchUserPromos - Firebase Database inicializado');

    const promosRef = get(firebase.database, 'promos');
    console.log('fetchUserPromos - Caminho acessado:', promosRef.toString());

    // Desligar listener existente antes de criar um novo (se houver)
    off(promosRef);

    const listener = onValue(promosRef, (snapshot) => {
      if (snapshot.val()) {
        const data = snapshot.val();
        dispatch({
          type: 'FETCH_PROMOS_SUCCESS',
          payload: data
        });
      } else {
        dispatch({
          type: 'FETCH_PROMOS_FAILED',
          payload: 'Nenhuma promoção encontrada'
        });
      }
    }, (error) => {
      console.error('fetchUserPromos - Erro ao buscar dados:', error);
      dispatch({
        type: 'FETCH_PROMOS_FAILED',
        payload: error.message
      });
    });

    // Retornar o método de desligamento do listener
    return listener;

  } catch (error) {
    console.error('fetchUserPromos - Erro:', error);
    dispatch({
      type: 'FETCH_PROMOS_FAILED',
      payload: error.message
    });
    // Em caso de erro, garantir que nenhum listener fique ativo
     if (firebase.database) {
         const promosRef = get(firebase.database, 'promos');
         off(promosRef);
     }
  }
};

// Nova action para desligar o listener de promoções
export const unsubscribePromos = () => (dispatch, getState) => {
    const state = getState();
    // Assumindo que o listener é salvo em algum lugar do estado Redux (precisará de ajuste no reducer)
    // const listener = state.algumReducer.promosListener;
    // if (listener && typeof listener === 'function') {
    //     console.log('Desligando listener de promoções');
    //     listener();
    // }
     // Como alternativa, podemos desligar pela referência direta se o listener não for salvo no estado
    if (firebase.database) {
        console.log('Tentando desligar listener de promoções pela referência');
        const promosRef = get(firebase.database, 'promos');
        off(promosRef);
    } else {
        console.warn('Firebase Database não disponível para desligar listener de promoções');
    }
};

export const fetchAllUsers = () => async (dispatch) => {
    try {
        const uid = await getUserId();
        if (!uid) {
            console.error('fetchAllUsers - UID não encontrado');
            return;
        }

        const usersRef = get(firebase.database, 'users');
        onValue(usersRef, (snapshot) => {
            const data = snapshot.val();
            dispatch({ type: 'FETCH_ALL_USERS_SUCCESS', payload: data || {} });
        });
    } catch (error) {
        console.error('fetchAllUsers - Erro:', error);
        dispatch({ type: 'FETCH_ALL_USERS_FAILURE', payload: error.message });
    }
};

// === Função temporária de diagnóstico ===
export const testReadBookingsSimple = () => async () => {
  try {
    const snapshot = await get(get(firebase.database, 'bookings'));
    if (snapshot.exists()) {
      console.log('testReadBookingsSimple - Sucesso:', snapshot.val());
    } else {
      console.log('testReadBookingsSimple - Nó vazio');
    }
  } catch (error) {
    console.error('testReadBookingsSimple - Erro:', error);
  }
};

export const fetchBookings = () => async (dispatch) => {
  console.log('=== LOG RASTREADOR fetchBookings (usersactions) ===');
  try {
    await waitForFirebaseInit();
    console.log('fetchBookings - Firebase Database inicializado');

    // Tentar obter UID do AsyncStorage primeiro
    const storedUid = await AsyncStorage.getItem('@auth_uid');
    const storedUserData = await AsyncStorage.getItem('@user_data');
    let uid = null;
    let userInfo = null;

    if (storedUid && storedUserData) {
      uid = storedUid;
      userInfo = JSON.parse(storedUserData);
      console.log('fetchBookings - Usando UID do AsyncStorage:', uid);
    } else {
      // Se não tiver no AsyncStorage, tentar do Firebase Auth
      const currentUser = await waitForAuth();
      if (currentUser) {
        uid = currentUser.uid;
        userInfo = store.getState().auth.profile;
        console.log('fetchBookings - Usando UID do Firebase Auth:', uid);
      }
    }

    if (!uid) {
      console.error('fetchBookings - UID não encontrado');
      dispatch({
        type: 'FETCH_BOOKINGS_FAILED',
        payload: 'Usuário não autenticado'
      });
      return;
    }

    if (!userInfo || !userInfo.usertype) {
      console.error('fetchBookings - Tipo de usuário não encontrado');
      dispatch({
        type: 'FETCH_BOOKINGS_FAILED',
        payload: 'Tipo de usuário não encontrado'
      });
      return;
    }

    console.log('fetchBookings - Iniciando busca com:', { uid, usertype: userInfo.usertype });
    
    // Usar o caminho correto para bookings
    const bookingsRef = get(firebase.database, `bookings/${uid}`);
    console.log('fetchBookings - Caminho acessado:', bookingsRef.toString());

    onValue(bookingsRef, (snapshot) => {
      if (snapshot.val()) {
        const data = snapshot.val();
        dispatch({
          type: 'FETCH_BOOKINGS_SUCCESS',
          payload: data
        });
      } else {
        dispatch({
          type: 'FETCH_BOOKINGS_FAILED',
          payload: 'Nenhuma reserva encontrada'
        });
      }
    }, (error) => {
      console.error('fetchBookings - Erro ao buscar dados:', error);
      dispatch({
        type: 'FETCH_BOOKINGS_FAILED',
        payload: error.message
      });
    });
  } catch (error) {
    console.error('fetchBookings - Erro:', error);
    dispatch({
      type: 'FETCH_BOOKINGS_FAILED',
      payload: error.message
    });
  }
};

// Função para buscar dados de um usuário específico
export const getUser = async (uid) => {
  try {
    console.log('getUser - Buscando dados do usuário:', uid);
    
    if (!uid) {
      console.error('getUser - UID não fornecido');
      return null;
    }

    const userRef = get(firebase.database, `users/${uid}`);
    const snapshot = await new Promise((resolve) => {
      const unsubscribe = userRef.on('value', (snap) => {
        unsubscribe();
        resolve(snap);
      });
    });

    if (snapshot.val()) {
      const userData = snapshot.val();
      userData.uid = uid;
      console.log('getUser - Dados do usuário encontrados:', userData);
      return userData;
    } else {
      console.log('getUser - Usuário não encontrado no banco de dados');
      return null;
    }
  } catch (error) {
    console.error('getUser - Erro ao buscar dados do usuário:', error);
    return null;
  }
};

// Função simplificada para buscar motoristas próximos (apenas Firebase)
export const fetchNearbyDrivers = (lat, lng, radius = 5, options = {}) => async (dispatch) => {
  const {
    driversRef,
    allLocationsRef,
    settingsRef,
  } = firebase;

  const settingsdata = await get(settingsRef);
  const settings = settingsdata.val();

  dispatch({
    type: FETCH_ALL_USERS,
    payload: null
  });

  try {
    console.log('📍 Usando Firebase para buscar motoristas');
    return new Promise((resolve) => {
      onValue(driversRef, snapshot => {
        if (snapshot.val()) {
          onValue(allLocationsRef, locres => {
            const locations = locres.val();
            const data = snapshot.val();
            
            // Filtrar motoristas aprovados e ativos
            const allDrivers = Object.keys(data)
              .filter(i => data && data[i].approved == true && data[i].driverActiveStatus == true && 
                          locations && locations[i] && 
                          ((data[i].licenseImage && settings.license_image_required) || !settings.license_image_required) &&
                          (((data[i].carApproved && settings.carType_required) || !settings.carType_required)) &&
                          ((data[i].term && settings.term_required) || !settings.term_required))
              .map(i => {
                const driverLocation = locations && locations[i] ? locations[i] : null;
                let distance = null;
                
                // Calcular distância se localização disponível
                if (driverLocation && lat && lng) {
                  distance = GetDistance(lat, lng, driverLocation.lat, driverLocation.lng);
                  if (settings.convert_to_mile) {
                    distance = distance / 1.609344;
                  }
                }

                return {
                  id: i,
                  location: driverLocation,
                  distance: distance,
                  carType: data[i].carType ? data[i].carType : null,
                  vehicleNumber: data[i].vehicleNumber ? data[i].vehicleNumber : null,
                  fleetadmin: data[i].fleetadmin ? data[i].fleetadmin : null,
                  firstName: data[i].firstName,
                  lastName: data[i].lastName,
                  queue: data[i].queue,
                  source: 'firebase'
                };
              });

            // Filtrar por raio se especificado
            const nearbyDrivers = radius ? 
              allDrivers.filter(driver => driver.distance && driver.distance <= radius) :
              allDrivers;

            // Ordenar por distância
            const sortedDrivers = nearbyDrivers.sort((a, b) => {
              if (!a.distance) return 1;
              if (!b.distance) return -1;
              return a.distance - b.distance;
            });

            dispatch({
              type: FETCH_ALL_DRIVERS_SUCCESS,
              payload: sortedDrivers
            });
            
            resolve(sortedDrivers);
          }, options.appType === 'app' ? {onlyOnce: true} : settings && settings.realtime_drivers ? null : {onlyOnce: true});
        } else {
          dispatch({
            type: FETCH_ALL_DRIVERS_FAILED,
            payload: "No users available."
          });
          resolve([]);
        }
      }, options.appType === 'app' ? {onlyOnce: true} : settings && settings.realtime_drivers ? null : {onlyOnce: true});
    });

  } catch (error) {
    console.error('❌ Erro ao buscar motoristas próximos:', error);
    dispatch({
      type: FETCH_ALL_DRIVERS_FAILED,
      payload: error.message
    });
    return [];
  }
};
