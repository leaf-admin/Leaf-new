import {
  FETCH_NOTIFICATIONS,
  FETCH_NOTIFICATIONS_SUCCESS,
  FETCH_NOTIFICATIONS_FAILED,
  EDIT_NOTIFICATIONS,
  SEND_NOTIFICATION,
  SEND_NOTIFICATION_SUCCESS,
  SEND_NOTIFICATION_FAILED,
} from "../store/types";
import { RequestPushMsg } from '../other/NotificationFunctions';
import { firebase } from '../config/configureFirebase';
import store from '../store/store';

export const fetchNotifications = () => (dispatch) => {

  const {
    notifyRef
  } = firebase;

  dispatch({
    type: FETCH_NOTIFICATIONS,
    payload: null
  });
  onValue(notifyRef, snapshot => {
    if (snapshot.val()) {
      const data = snapshot.val();

      const arr = Object.keys(data).map(i => {
        data[i].id = i
        return data[i]
      });

      dispatch({
        type: FETCH_NOTIFICATIONS_SUCCESS,
        payload: arr
      });
    } else {
      dispatch({
        type: FETCH_NOTIFICATIONS_FAILED,
        payload: "No data available."
      });
    }
  });
};

export const editNotifications = (notification, method) => (dispatch) => {
  const {
    notifyRef,
    notifyEditRef
  } = firebase;
  dispatch({
    type: EDIT_NOTIFICATIONS,
    payload: { method, notification }
  });
  if (method === 'Add') {
    push(notifyRef, notification);
  } else if (method === 'Delete') {
    remove(notifyEditRef(notification.id));
  } else {
    set(notifyEditRef(notification.id), notification);
  }
}

export const sendNotification = (notification) => async (dispatch) => {

  const {
    config
  } = firebase;

  // Fallback para config se não estiver disponível
  const safeConfig = config || {
    projectId: "leaf-reactnative",
    appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
    databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
    storageBucket: "leaf-reactnative.firebasestorage.app",
    apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
    authDomain: "leaf-reactnative.firebaseapp.com",
    messagingSenderId: "106504629884",
    measurementId: "G-22368DBCY9"
  };

  dispatch({
    type: SEND_NOTIFICATION,
    payload: notification
  });

  const settings = store.getState().settingsdata.settings;
  let host = window && window.location && settings.CompanyWebsite === window.location.origin? window.location.origin : `https://${safeConfig.projectId}.web.app`
  let url = `${host}/send_notification`;

  fetch(url, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
      },
      body: JSON.stringify({
          "notification": notification
      })
  });
}
