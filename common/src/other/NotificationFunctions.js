import { firebase } from '../config/configureFirebase';
import store from '../store/store';

export const RequestPushMsg = (token, data) => {
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
    
    const settings = store.getState().settingsdata.settings;
    let host = window && window.location && settings.CompanyWebsite === window.location.origin? window.location.origin : `https://${safeConfig.projectId}.web.app`
    let url = `${host}/send_notification`;

    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            "token": token,
            ...data
        })
    })
    .then((response) => {

    })
    .catch((error) => {
        console.log(error)
    });
}