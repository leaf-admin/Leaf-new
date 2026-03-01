import {
    FETCH_ADDRESSES,
    FETCH_ADDRESSES_SUCCESS,
    FETCH_ADDRESSES_FAILED,
    EDIT_ADDRESS
  } from "../types";
  import store from '../store/store';
  import { firebase } from './config/configureFirebase';
  
  export const fetchAddresses = () => (dispatch) => {
    const { addressEditRef } = firebase;
    dispatch({
      type: FETCH_ADDRESSES,
      payload: null
    });
    const userInfo = store.getState().auth.profile;
    if (!userInfo || !userInfo.uid) {
      dispatch({
        type: FETCH_ADDRESSES_FAILED,
        payload: 'Usuário não autenticado ou sem UID.'
      });
      return;
    }
    firebase.off(addressEditRef(userInfo.uid));
    firebase.onValue(addressEditRef(userInfo.uid), snapshot => {
      if (snapshot.val()) {
        let data = snapshot.val();
        const arr = Object.keys(data).map(i => {
          data[i].id = i;
          return data[i]
        });
        dispatch({
          type: FETCH_ADDRESSES_SUCCESS,
          payload: arr
        });
      } else {
        dispatch({
          type: FETCH_ADDRESSES_FAILED,
          payload: store.getState().languagedata.defaultLanguage.no_address
        });
      }
    });
  };
  
  export const editAddress = (uid, address, method) => async (dispatch) => {
    const {
      addressRef, 
      addressEditRef,
    } = firebase;
    dispatch({
      type: EDIT_ADDRESS,
      payload: { method, address }
    });
    if (method === 'Add') {
      firebase.push(addressEditRef(uid), address);
    } else if (method === 'Delete') {
      firebase.remove(addressRef(uid, address.id));
    }
  }