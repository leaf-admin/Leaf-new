import Logger from '../../utils/Logger';
import {
  FETCH_CANCEL_REASONS,
  FETCH_CANCEL_REASONS_SUCCESS,
  FETCH_CANCEL_REASONS_FAILED,
  EDIT_CANCELLATION_REASON
} from "../types.js";
import { firebase } from '../config/configureFirebase';
import { api } from '../api';
import { store } from '../store/store';
import { getUserId } from '../utils/authUtils';
import { getAuth } from '@react-native-firebase/auth';
import { CANCELREASON_LOADING, CANCELREASON_LOADED, CANCELREASON_ERROR } from '../store/types';


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

export const fetchCancelReasons = () => async (dispatch) => {
  try {
    dispatch({
      type: FETCH_CANCEL_REASONS,
      payload: null,
    });

    // Aguardar inicialização do Firebase
    await waitForFirebaseInit();
    Logger.log('fetchCancelReasons - Firebase Database inicializado');

    const authInstance = getAuth();
    const currentUser = authInstance.currentUser;
    
    if (!currentUser) {
      Logger.error('fetchCancelReasons - Usuário não autenticado');
      dispatch({
        type: FETCH_CANCEL_REASONS_FAILED,
        payload: 'Usuário não autenticado'
      });
      return;
    }

    const token = await currentUser.getIdToken();
    Logger.log('fetchCancelReasons - Token obtido:', token ? 'Sim' : 'Não');

    const {
      cancelreasonRef
    } = firebase;

    Logger.log('fetchCancelReasons - Iniciando busca para UID:', currentUser.uid);

    onValue(cancelreasonRef, (snapshot) => {
      if (snapshot.val()) {
        let data = snapshot.val();
        let arr = [];
        for(let i=0;i<data.length;i++){
          arr.push(data[i].label);
        }
        dispatch({
          type: FETCH_CANCEL_REASONS_SUCCESS,
          payload: {
            simple: arr,
            complex: snapshot.val()
          }
        });
      } else {
        dispatch({
          type: FETCH_CANCEL_REASONS_FAILED,
          payload: store.getState().languagedata.defaultLanguage.no_cancel_reason,
        });
      }
    }, (error) => {
      Logger.error('fetchCancelReasons - Erro ao buscar dados:', error);
      dispatch({
        type: FETCH_CANCEL_REASONS_FAILED,
        payload: error.message || 'Erro ao buscar razões de cancelamento'
      });
    });
  } catch (error) {
    Logger.error('fetchCancelReasons - Erro:', error);
    dispatch({
      type: FETCH_CANCEL_REASONS_FAILED,
      payload: error.message || 'Erro ao buscar razões de cancelamento'
    });
  }
};

export const editCancellationReason = (reasons, method) => (dispatch) => {
  const {
    cancelreasonRef
  } = firebase;

  dispatch({
    type: EDIT_CANCELLATION_REASON,
    payload: method
  });
  set(cancelreasonRef, reasons);
}

