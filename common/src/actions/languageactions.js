import {
    FETCH_LANGUAGE,
    FETCH_LANGUAGE_SUCCESS,
    FETCH_LANGUAGE_FAILED,
    EDIT_LANGUAGE
} from "../store/types";
import { firebase } from '../config/configureFirebase';
import { onValue, set, push, remove, update } from "firebase/database";
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
                        const response = await fetch(`https://us-central1-${config.projectId}.cloudfunctions.net/gettranslation?str=${word}&from=${defLangLocale}&to=${langLocaleArr[j].langLocale}`, {
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