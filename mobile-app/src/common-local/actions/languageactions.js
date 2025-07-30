import {
    FETCH_LANGUAGE,
    FETCH_LANGUAGE_SUCCESS,
    FETCH_LANGUAGE_FAILED,
    EDIT_LANGUAGE
} from "../store/types";
import { firebase } from '../config/configureFirebase';
import { api } from '../api';
import { store } from '../store/store';
import { LANGUAGE_LOADING, LANGUAGE_LOADED, LANGUAGE_ERROR } from '../store/types';
import { getAuth } from '@react-native-firebase/auth';
import { onValue, push, remove, set, update } from '@react-native-firebase/database';
import { getLangKey } from "../other/getLangKey";

export const fetchLanguages = () => (dispatch) => {

    const {
        languagesRef
    } = firebase;

    dispatch({
        type: FETCH_LANGUAGE,
        payload: null
    });
    onValue(languagesRef, snapshot => {
        if (snapshot.val()) {
            const data = snapshot.val();
            let defLang = null;
            const arr = Object.keys(data).map(i => {
                data[i].id = i;
                if(data[i].default){
                    defLang = data[i].keyValuePairs;
                }
                return data[i]
            });
            dispatch({
                type: FETCH_LANGUAGE_SUCCESS,
                payload: {
                    defaultLanguage: defLang,
                    langlist: arr
                }
            });
        } else {
            dispatch({
                type: FETCH_LANGUAGE_FAILED,
                payload: "No Languages available."
            });
        }
    });
};

export const editLanguage = (lang, method) => (dispatch) => {
    const {
        languagesRef,
        languagesEditRef
    } = firebase;
    dispatch({
        type: EDIT_LANGUAGE,
        payload: { lang, method }
    });
    if (method === 'Add') {
        push(languagesRef, lang);
    } else if (method === 'Delete') {
        remove(languagesEditRef(lang.id));
    } else {
        set(languagesEditRef(lang.id),lang);
    }
}


export const convertLanguage = async (word, userLangLocale)=>{
    const {
        languagesRef,
        langEditRef,
        config,
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
    
    let langKey = getLangKey(word);

    onValue(languagesRef, async (snapshot) => {
        if (snapshot.val()) {
            const data = snapshot.val();
            const langLocaleArr = Object.keys(data).map(i => {
                data[i].id = i;
                return {langLocale : data[i].langLocale, id: data[i].id}
            });

            let defLangLocale = "";

            if(userLangLocale){
                defLangLocale = userLangLocale;
            }else{
                const defLocale = Object.keys(data).filter(i => {
                    data[i].id = i;
                    return data[i].default === true;
                })[0];

                defLangLocale = data[defLocale].langLocale;
            }

            for (let j = 0; j < langLocaleArr.length; j++){
                try{
                    if(langLocaleArr[j].langLocale === defLangLocale){
                        update(langEditRef(langLocaleArr[j].id),{[langKey]:word})
                    }else{
                        const response = await fetch(`https://us-central1-${safeConfig.projectId}.cloudfunctions.net/gettranslation?str=${word}&from=${defLangLocale}&to=${langLocaleArr[j].langLocale}`, {
                            method: 'GET',
                            headers: {
                              'Content-Type': 'application/json'
                            }
                          })
                          const json = await response.json();
                          if(json){
                            update(langEditRef(langLocaleArr[j].id),{[langKey]:json.text})
                          }
                    }
                  }
                  catch(err) {
                    console.log("errror occured in language add", err)
                  };
            }
        }
    }, {onlyOnce: true});

}

// Função para buscar idiomas de forma síncrona
export const getLanguages = async () => {
    try {
        console.log('getLanguages - Buscando idiomas...');
        
        const languagesRef = firebase.languagesRef;
        const snapshot = await new Promise((resolve) => {
            const unsubscribe = onValue(languagesRef, (snap) => {
                unsubscribe();
                resolve(snap);
            });
        });

        if (snapshot.val()) {
            const data = snapshot.val();
            let defLang = null;
            const arr = Object.keys(data).map(i => {
                data[i].id = i;
                if(data[i].default){
                    defLang = data[i].keyValuePairs;
                }
                return data[i]
            });
            
            const result = {
                defaultLanguage: defLang,
                langlist: arr
            };
            
            console.log('getLanguages - Idiomas encontrados:', result);
            return result;
        } else {
            console.log('getLanguages - Nenhum idioma encontrado');
            return null;
        }
    } catch (error) {
        console.warn('getLanguages - Erro ao buscar idiomas:', error);
        return null;
    }
};