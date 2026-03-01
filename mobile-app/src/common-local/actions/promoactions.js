import Logger from '../../utils/Logger';
import {
  FETCH_PROMOS,
  FETCH_PROMOS_SUCCESS,
  FETCH_PROMOS_FAILED,
  EDIT_PROMOS
} from "../types.js";
import { firebase } from '../config/configureFirebase';
import { api } from '../api';
import { store } from '../store/store';
import { PROMO_LOADING, PROMO_LOADED, PROMO_ERROR } from '../store/types';
import { getAuth } from '@react-native-firebase/auth';
import { getUserId } from '../utils/authUtils';


const waitForFirebaseInit = async () => {
  return new Promise((resolve) => {
    const checkFirebase = () => {
      if (firebase && firebase.database) {
        const db = getDatabase();
        if (db) {
          resolve(true);
        } else {
          setTimeout(checkFirebase, 100);
        }
      } else {
        setTimeout(checkFirebase, 100);
      }
    };
    checkFirebase();
  });
};

export const fetchPromos = () => async (dispatch) => {
  try {
    dispatch({
      type: FETCH_PROMOS,
      payload: null
    });

    // Aguardar inicialização do Firebase
    await waitForFirebaseInit();
    Logger.log('fetchPromos - Firebase Database inicializado');

    const authInstance = getAuth();
    const currentUser = authInstance.currentUser;
    
    if (!currentUser) {
      Logger.error('fetchPromos - Usuário não autenticado');
      dispatch({
        type: FETCH_PROMOS_FAILED,
        payload: 'Usuário não autenticado'
      });
      return;
    }

    const token = await currentUser.getIdToken();
    Logger.log('fetchPromos - Token obtido:', token ? 'Sim' : 'Não');

    const {
      promoRef
    } = firebase;

    Logger.log('fetchPromos - Iniciando busca para UID:', currentUser.uid);

    onValue(promoRef, snapshot => {
      if (snapshot.val()) {
        const data = snapshot.val();
        const arr = Object.keys(data).map(i => {
          data[i].id = i;
          return data[i]
        });
        dispatch({
          type: FETCH_PROMOS_SUCCESS,
          payload: arr
        });
      } else {
        dispatch({
          type: FETCH_PROMOS_FAILED,
          payload: "No promos available."
        });
      }
    }, (error) => {
      Logger.error('fetchPromos - Erro ao buscar dados:', error);
      dispatch({
        type: FETCH_PROMOS_FAILED,
        payload: error.message || 'Erro ao buscar promoções'
      });
    });
  } catch (error) {
    Logger.error('fetchPromos - Erro:', error);
    dispatch({
      type: FETCH_PROMOS_FAILED,
      payload: error.message || 'Erro ao buscar promoções'
    });
  }
};

export const editPromo = (promo, method) => (dispatch) => {
  const {
    promoRef, 
    promoEditRef
  } = firebase;
  dispatch({
    type: EDIT_PROMOS,
    payload: { method, promo }
  });
  if (method === 'Add') {
    push(promoRef, promo);
  } else if (method === 'Delete') {
    remove(promoEditRef(promo.id));
  } else {
    set(promoEditRef(promo.id),promo);
  }
}