import Logger from '../../utils/Logger';
import {
  FETCH_CAR_TYPES,
  FETCH_CAR_TYPES_SUCCESS,
  FETCH_CAR_TYPES_FAILED,
  EDIT_CAR_TYPE
} from "../types.js";
import { firebase } from '../config/configureFirebase';
import { api } from '../api';
import store from '../store/store';
import { CARTYPE_LOADING, CARTYPE_LOADED, CARTYPE_ERROR } from '../store/types';
import { getAuth } from '@react-native-firebase/auth';
import { onValue, push, remove, set, uploadBytesResumable, getDownloadURL } from '@react-native-firebase/database';
import { ref } from '@react-native-firebase/storage';


export const fetchCarTypes = () => (dispatch) => {
  Logger.log('🚗 fetchCarTypes - Iniciando...');
  Logger.log('🚗 fetchCarTypes - firebase:', firebase);
  Logger.log('🚗 fetchCarTypes - carTypesRef:', firebase?.carTypesRef);

  const {
    carTypesRef
  } = firebase;

  if (!carTypesRef) {
    Logger.error('❌ fetchCarTypes - carTypesRef não disponível!');
    return;
  }

  dispatch({
    type: FETCH_CAR_TYPES,
    payload: null
  });
  
  Logger.log('🚗 fetchCarTypes - Configurando listener onValue...');
  onValue(carTypesRef, snapshot => {
    Logger.log('🚗 fetchCarTypes - onValue callback executado:', {
      hasData: !!snapshot.val(),
      dataKeys: snapshot.val() ? Object.keys(snapshot.val()) : null
    });
    
    if (snapshot.val()) {
      let data = snapshot.val();
      const arr = Object.keys(data).map(i => {
        data[i].id = i;
        return data[i]
      });
      Logger.log('🚗 fetchCarTypes - Dados processados:', arr.length, 'carros');
      dispatch({
        type: FETCH_CAR_TYPES_SUCCESS,
        payload: arr
      });
    } else {
      Logger.log('⚠️ fetchCarTypes - Nenhum dado encontrado');
      dispatch({
        type: FETCH_CAR_TYPES_FAILED,
        payload: store.getState().languagedata.defaultLanguage.no_cars
      });
    }
  });
};

export const editCarType = (cartype, method) => async (dispatch) => {
  const {
    carTypesRef, 
    carTypesEditRef,
    carDocImage
  } = firebase;
  dispatch({
    type: EDIT_CAR_TYPE,
    payload: { method, cartype }
  });
  if (method === 'Add') {
    push(carTypesRef, cartype);
  } else if (method === 'Delete') {
    remove(carTypesEditRef(cartype.id));
  } else if (method === 'UpdateImage') {
    await uploadBytesResumable(carDocImage(cartype.id), cartype.image);
    let image = await getDownloadURL(carDocImage(cartype.id));
      let data = cartype;
      data.image = image;
    set(carTypesEditRef(cartype.id), data);
  }
   else {
    set(carTypesEditRef(cartype.id), cartype);
  }
}

// Função para buscar tipos de carro de forma síncrona
export const getCarTypes = async () => {
  try {
    Logger.log('getCarTypes - Buscando tipos de carro...');
    
    const carTypesRef = firebase.carTypesRef;
    const snapshot = await new Promise((resolve) => {
      const unsubscribe = onValue(carTypesRef, (snap) => {
        unsubscribe();
        resolve(snap);
      });
    });

    if (snapshot.val()) {
      let data = snapshot.val();
      const arr = Object.keys(data).map(i => {
        data[i].id = i;
        return data[i]
      });
      
      Logger.log('getCarTypes - Tipos de carro encontrados:', arr);
      return arr;
    } else {
      Logger.log('getCarTypes - Nenhum tipo de carro encontrado');
      return null;
    }
  } catch (error) {
    Logger.warn('getCarTypes - Erro ao buscar tipos de carro:', error);
    return null;
  }
};