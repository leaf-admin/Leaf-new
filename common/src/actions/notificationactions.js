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
import { onValue, set, push, remove } from "firebase/database";
import store from '../store/store';

export const fetchUserNotifications = () => (dispatch) => {

  const {
    auth,
    userNotificationsRef
  } = firebase;

  dispatch({
    type: FETCH_NOTIFICATIONS,
    payload: null
  });

  const uid = auth.currentUser.uid;

  onValue(userNotificationsRef(uid), snapshot => {
    const data = snapshot.val(); 
    if(data){
      const arr = Object.keys(data).map(i => {
        data[i].id = i
        return data[i]
      });
      dispatch({
        type: FETCH_NOTIFICATIONS_SUCCESS,
        payload: arr.reverse()
      });
    } else {
      dispatch({
        type: FETCH_NOTIFICATIONS_FAILED,
        payload: "No data available."
      });
    }
  });
};

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

  dispatch({
    type: SEND_NOTIFICATION,
    payload: notification
  });

  const settings = store.getState().settingsdata.settings;
  let host = window && window.location && settings.CompanyWebsite === window.location.origin? window.location.origin : `https://${config.projectId}.web.app`
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
