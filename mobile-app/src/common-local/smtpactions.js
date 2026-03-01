import {
  FETCH_SMTP,
  FETCH_SMTP_SUCCESS,
  FETCH_SMTP_FAILED
} from "../types";
import { firebase } from './config/configureFirebase';

export const fetchSMTP = () => (dispatch) => {

  const {
    smtpRef
  } = firebase;

  dispatch({
    type: FETCH_SMTP,
    payload: null,
  });
  onValue(smtpRef, (snapshot) => {
    if (snapshot.val()) {
      dispatch({
        type: FETCH_SMTP_SUCCESS,
        payload: snapshot.val(),
      });
    } else {
      dispatch({
        type: FETCH_SMTP_FAILED,
        payload: "Unable to fetch SMTP details.",
      });
    }
  });
};

export const checkSMTP = async(fromEmail, smtpDetails) => {
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

  let url = `https://${safeConfig.projectId}.web.app/checksmtpdetails`;

  const body = { fromEmail: fromEmail, smtpDetails: smtpDetails };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  })

  return await response.json();
}