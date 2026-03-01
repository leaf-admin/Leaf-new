import Logger from '../utils/Logger';
import {
  FETCH_SETTINGS,
  FETCH_SETTINGS_SUCCESS,
  FETCH_SETTINGS_FAILED,
  EDIT_SETTINGS,
  CLEAR_SETTINGS_ERROR
} from "../types";

import { firebase } from './config/configureFirebase';
import { api } from '../api';
import { store } from '../store/store';
import { SETTINGS_LOADING, SETTINGS_LOADED, SETTINGS_ERROR } from '../store/types';
import { getAuth } from '@react-native-firebase/auth';
import { onValue, set } from '@react-native-firebase/database';

export const fetchSettings= () => (dispatch) => {

  const {
    settingsRef
  } = firebase;

  dispatch({
    type: FETCH_SETTINGS,
    payload: null,
  });
  onValue(settingsRef, (snapshot) => {
    if (snapshot.val()) {
      dispatch({
        type: FETCH_SETTINGS_SUCCESS,
        payload: snapshot.val(),
      });
    } else {
      dispatch({
        type: FETCH_SETTINGS_FAILED,
        payload: "Unable to fetch database and settings.",
      });
    }
  });
};

export const editSettings = (settings) => (dispatch) => {
  const {
    settingsRef
  } = firebase;
  dispatch({
    type: EDIT_SETTINGS,
    payload: settings
  });
  set(settingsRef, settings);
  alert(store.getState().languagedata.defaultLanguage.updated);
};

export const clearSettingsViewError = () => (dispatch) => {
  dispatch({
    type: CLEAR_SETTINGS_ERROR,
    payload: null
  });
};

// Função para buscar configurações de forma síncrona
export const getSettings = async () => {
  try {
    Logger.log('getSettings - Buscando configurações...');
    
    const settingsRef = firebase.settingsRef;
    const snapshot = await new Promise((resolve) => {
      const unsubscribe = onValue(settingsRef, (snap) => {
        unsubscribe();
        resolve(snap);
      });
    });

    if (snapshot.val()) {
      const settings = snapshot.val();
      Logger.log('getSettings - Configurações encontradas:', settings);
      return settings;
    } else {
      Logger.log('getSettings - Nenhuma configuração encontrada');
      return null;
    }
  } catch (error) {
    Logger.warn('getSettings - Erro ao buscar configurações:', error);
    return null;
  }
};