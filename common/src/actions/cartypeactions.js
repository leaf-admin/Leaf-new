import {
  FETCH_CAR_TYPES,
  FETCH_CAR_TYPES_SUCCESS,
  FETCH_CAR_TYPES_FAILED,
  EDIT_CAR_TYPE
} from "../store/types";
import store from '../store/store';
import { firebase } from '../config/configureFirebase';
import { onValue, push, remove, set, uploadBytesResumable, getDownloadURL } from 'firebase/database';
import { ref } from 'firebase/storage';

export const fetchCarTypes = () => (dispatch) => {

  const {
    carTypesRef
  } = firebase;

  dispatch({
    type: FETCH_CAR_TYPES,
    payload: null
  });
  onValue(carTypesRef, snapshot => {
    if (snapshot.val()) {
      let data = snapshot.val();
      const arr = Object.keys(data).map(i => {
        data[i].id = i;
        return data[i]
      });
      dispatch({
        type: FETCH_CAR_TYPES_SUCCESS,
        payload: arr
      });
    } else {
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
    console.log('getCarTypes - Buscando tipos de carro...');
    
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
      
      console.log('getCarTypes - Tipos de carro encontrados:', arr);
      return arr;
    } else {
      console.log('getCarTypes - Nenhum tipo de carro encontrado');
      return null;
    }
  } catch (error) {
    console.warn('getCarTypes - Erro ao buscar tipos de carro:', error);
    return null;
  }
};