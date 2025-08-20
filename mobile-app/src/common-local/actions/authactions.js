import {
  FETCH_USER,
  FETCH_USER_SUCCESS,
  FETCH_USER_FAILED,
  USER_SIGN_IN,
  USER_SIGN_IN_FAILED,
  USER_SIGN_OUT,
  CLEAR_LOGIN_ERROR,
  REQUEST_OTP,
  REQUEST_OTP_SUCCESS,
  REQUEST_OTP_FAILED,
  UPDATE_USER_WALLET_HISTORY,
  SEND_RESET_EMAIL,
  SEND_RESET_EMAIL_FAILED,
  USER_SIGN_IN_SUCCESS
} from "../store/types";

import store from '../store/store';
import { firebase } from '../config/configureFirebase';
import { api } from '../api';
import { AUTH_LOADING, AUTH_LOADED, AUTH_ERROR } from '../store/types';
import { getAuth } from '@react-native-firebase/auth';
// Removendo imports do Firebase Web SDK
// import { onValue, update, set, off } from "firebase/database";
// import { onAuthStateChanged, signInWithCredential, signInWithPopup, signOut, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithCustomToken } from "firebase/auth";
// import { uploadBytesResumable, getDownloadURL } from "firebase/storage";
import base64 from 'react-native-base64';
import AccessKey from '../other/AccessKey';
import { getUserId, getUserData, saveUserId, saveUserData, clearAuthData } from '../utils/authUtils';
import { configureAuthPersistence, checkPersistedAuth, saveAuthSession, clearAuthSession } from './authPersistence';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const registerUser = (userData) => async (dispatch) => {
  const { auth, singleUserRef } = firebase;
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error("Usuário não autenticado. O processo de OTP pode ter falhado.");
    }

    const uid = currentUser.uid;
    console.log('registerUser - Dados recebidos:', userData);
    console.log('registerUser - Usuário atual:', currentUser);

    // Extrair dados com fallbacks seguros
    const { name, userType, usertype, cpf, phone, mobile, email } = userData;
    
    // Usar usertype ou userType (ambos são aceitos)
    const finalUserType = usertype || userType;
    
    // Usar phone ou mobile (ambos são aceitos)
    const finalPhone = phone || mobile;

    console.log('registerUser - Dados extraídos:', {
      name, userType, usertype, finalUserType,
      cpf, phone, mobile, finalPhone, email
    });

    if (!finalUserType) {
      throw new Error("Tipo de usuário não definido. Deve ser 'customer' ou 'driver'.");
    }

    if (!name) {
      throw new Error("Nome não fornecido.");
    }

    // Garante que o nome seja separado em firstName e lastName
    const nameParts = name ? name.split(' ') : [''];
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    const profileData = {
      firstName: firstName,
      lastName: lastName,
      usertype: finalUserType,  // Campo que a NewMapScreen espera
      userType: finalUserType,  // Manter compatibilidade se necessário
      email: email,
      cpf: cpf,
      mobile: finalPhone,
      createdAt: new Date().toISOString(),
      approved: finalUserType === 'driver' ? false : true,
      driverActiveStatus: finalUserType === 'driver' ? false : false,
      queue: false,
      profile_image: null,
      referralId: `leaf${Math.floor(1000 + Math.random() * 9000)}`,
      walletBalance: 0,
    };

    console.log('registerUser - Dados do perfil a serem salvos:', profileData);

    // Salva os dados do perfil no Realtime Database
    await singleUserRef(uid).set(profileData);
    
    console.log('registerUser - Perfil salvo com sucesso no banco');
    
    // Atualiza o Redux com o perfil completo
    dispatch({
      type: FETCH_USER_SUCCESS,
      payload: { ...profileData, uid }
    });

    console.log('registerUser - Redux atualizado com sucesso');

  } catch (error) {
    console.error("Erro ao registrar usuário no banco de dados:", error);
    dispatch({
      type: FETCH_USER_FAILED,
      payload: { code: 'db-error', message: error.message }
    });
  }
};

// Constante para a chave do AsyncStorage
const AUTH_UID_KEY = '@auth_uid';

// Sistema de Logs Detalhados
const logAuthState = (context, data = {}) => {
  const {
    auth,
  } = firebase;

  console.log(`[${context}] Auth State Check:`, {
    timestamp: new Date().toISOString(),
    firebaseUser: auth.currentUser ? {
      uid: auth.currentUser.uid,
      email: auth.currentUser.email,
      phoneNumber: auth.currentUser.phoneNumber,
      isAnonymous: auth.currentUser.isAnonymous,
      emailVerified: auth.currentUser.emailVerified,
      providerData: auth.currentUser.providerData
    } : null,
    reduxState: {
      ...store.getState().auth,
      profile: store.getState().auth.profile ? {
        uid: store.getState().auth.profile.uid,
        usertype: store.getState().auth.profile.usertype
      } : null
    },
    ...data
  });
};

// Verificação do Firebase
const verifyFirebaseConfig = () => {
  const {
    auth,
  } = firebase;

  if (!auth) {
    console.error('[Firebase Config] Auth não está inicializado');
    return;
  }

  try {
    console.log('[Firebase Config]', {
      timestamp: new Date().toISOString(),
      persistence: auth._persistenceType || 'N/A',
      currentUser: auth.currentUser ? {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email,
        phoneNumber: auth.currentUser.phoneNumber
      } : null,
      authState: auth._authState || 'N/A'
    });
  } catch (error) {
    console.error('[Firebase Config] Erro ao verificar configuração:', error);
  }
};

// Função para salvar o UID no AsyncStorage com verificação
const saveAuthUid = async (uid) => {
  if (!uid) {
    console.error('[AsyncStorage] Tentativa de salvar UID inválido');
    return;
  }

  try {
    console.log('[AsyncStorage] Tentando salvar UID:', uid);
    await AsyncStorage.setItem(AUTH_UID_KEY, uid);
    const savedUid = await AsyncStorage.getItem(AUTH_UID_KEY);
    console.log('[AsyncStorage] UID salvo:', savedUid);
    
    if (savedUid !== uid) {
      console.error('[AsyncStorage] Falha na verificação do UID salvo');
      throw new Error('Falha na verificação do UID');
    }
    
    console.log('[AsyncStorage] UID salvo e verificado com sucesso');
  } catch (error) {
    console.error('[AsyncStorage] Erro ao salvar UID:', error);
    throw error;
  }
};

// Função para remover o UID do AsyncStorage com verificação
const removeAuthUid = async () => {
  try {
    console.log('[AsyncStorage] Tentando remover UID');
    await AsyncStorage.removeItem(AUTH_UID_KEY);
    const savedUid = await AsyncStorage.getItem(AUTH_UID_KEY);
    
    if (savedUid !== null) {
      console.error('[AsyncStorage] Falha na remoção do UID');
      throw new Error('Falha na remoção do UID');
    }
    
    console.log('[AsyncStorage] UID removido com sucesso');
  } catch (error) {
    console.error('[AsyncStorage] Erro ao remover UID:', error);
    throw error;
  }
};

// Função para obter o UID do AsyncStorage com verificação
export const getStoredAuthUid = async () => {
  try {
    console.log('[AsyncStorage] Tentando recuperar UID');
    console.log('[AsyncStorage] Chave:', AUTH_UID_KEY);
    
    const uid = await AsyncStorage.getItem(AUTH_UID_KEY);
    console.log('[AsyncStorage] UID recuperado:', uid);
    
    return uid;
  } catch (error) {
    console.error('[AsyncStorage] Erro ao recuperar UID:', error);
    return null;
  }
};

// Verificar configuração do Firebase ao iniciar
verifyFirebaseConfig();

// Função para aguardar um tempo específico
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Função para manter o estado de autenticação com retry limitado
const maintainAuthState = async (auth, uid, dispatch) => {
    const maxRetries = 3;
    const retryDelay = 2000; // 2 segundos

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Tentativa ${attempt} de ${maxRetries} para manter estado de autenticação`);
            
            // Verificar se o usuário está autenticado
            if (!auth.currentUser || auth.currentUser.uid !== uid) {
                console.log('Usuário não está autenticado, tentando restaurar sessão...');
                
                // Verificar sessão persistida
                const persistedUid = await checkPersistedAuth();
                if (persistedUid === uid) {
                    // Se temos o UID persistido, tentar reautenticar
                    const token = await auth.currentUser?.getIdToken(true);
                    if (token) {
                        await auth.signInWithCustomToken(token);
                        console.log('Sessão restaurada com sucesso usando token Firebase');
                    } else {
                        throw new Error('Token não disponível para restauração');
                    }
                } else {
                    throw new Error('UID persistido não corresponde');
                }
            }

            // Salvar sessão
            await saveAuthSession(uid);
            
            // Verificar estado de autenticação
            return new Promise((resolve, reject) => {
                const unsubscribe = auth.onAuthStateChanged(async (user) => {
                    if (user && user.uid === uid) {
                        console.log('Estado de autenticação confirmado:', user.uid);
                        
                        // Dispatch do sucesso de autenticação
                        dispatch({
                            type: USER_SIGN_IN_SUCCESS,
                            payload: { uid: user.uid }
                        });

                        // Buscar dados do usuário
                        firebase.singleUserRef(user.uid).on('value', snapshot => {
                            if (snapshot.val()) {
                                let profile = snapshot.val();
                                profile.uid = user.uid;
                                dispatch({
                                    type: FETCH_USER_SUCCESS,
                                    payload: profile
                                });
                            }
                        });

                        unsubscribe();
                        resolve();
                    }
                });
            });

        } catch (error) {
            console.error(`Tentativa ${attempt} falhou:`, error);
            
            if (attempt === maxRetries) {
                console.error('Todas as tentativas falharam');
                throw error;
            }
            
            await wait(retryDelay);
        }
    }
};

export const fetchUser = () => async (dispatch) => {
  const { auth, singleUserRef } = firebase;

  dispatch({
    type: FETCH_USER,
    payload: null
  });

  let userLoaded = false;

  try {
    // Só buscar usuário se estiver autenticado pelo Firebase Auth
    if (!auth || !auth.currentUser || !auth.currentUser.uid) {
      dispatch({
        type: FETCH_USER_FAILED,
        payload: { code: 'auth/user-not-found', message: 'Usuário não autenticado' }
      });
      return;
    }

    const currentUser = auth.currentUser;
    const userRef = singleUserRef(currentUser.uid);

    // Buscar perfil do backend
    try {
      const snapshot = await new Promise((resolve) => {
        const unsubscribe = userRef.on('value', (snap) => {
          unsubscribe();
          resolve(snap);
        });
      });

      if (snapshot.val()) {
        const profile = snapshot.val();
        profile.uid = currentUser.uid;
        // Salvar no AsyncStorage apenas para cache
        await AsyncStorage.setItem('@user_data', JSON.stringify(profile));
        dispatch({
          type: FETCH_USER_SUCCESS,
          payload: profile
        });
        userLoaded = true;
        return;
      } else {
        // Se não existe no banco, fazer logout e bloquear acesso
        await auth.signOut();
        await AsyncStorage.removeItem('@user_data');
        dispatch({
          type: FETCH_USER_FAILED,
          payload: { code: 'auth/user-not-in-db', message: 'Usuário não encontrado no banco de dados. Faça o cadastro novamente.' }
        });
        return;
      }
    } catch (error) {
      dispatch({
        type: FETCH_USER_FAILED,
        payload: error
      });
    }
  } catch (error) {
    if (!userLoaded) {
      dispatch({
        type: FETCH_USER_FAILED,
        payload: error
      });
    }
  }
};

// Função helper para obter config seguro
const getSafeConfig = () => {
    const { config } = firebase;
    return config || {
        projectId: "leaf-reactnative",
        appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
        databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
        storageBucket: "leaf-reactnative.firebasestorage.app",
        apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
        authDomain: "leaf-reactnative.firebaseapp.com",
        messagingSenderId: "106504629884",
        measurementId: "G-22368DBCY9"
    };
};

export const validateReferer = async (referralId) => {
  const config = getSafeConfig();
  const response = await fetch(`https://${config.projectId}.web.app/validate_referrer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      referralId: referralId
    })
  })
  const json = await response.json();
  return json;
};

export const checkUserExists = async (data) => {
  const config = getSafeConfig();

  const settings = store.getState().settingsdata.settings;
  let host = window && window.location && settings.CompanyWebsite === window.location.origin? window.location.origin : `https://${config.projectId}.web.app`
  let url = `${host}/check_user_exists`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      "Authorization": "Basic " + base64.encode(config.projectId + ":" + AccessKey)
    },
    body: JSON.stringify({
      email: data.email,
      mobile: data.mobile
    })
  })
  const json = await response.json();
  return json;
};

export const mainSignUp = async (regData) => {
  const config = getSafeConfig();
  let url = `https://${config.projectId}.web.app/user_signup`;
  console.log('=== INÍCIO DO PROCESSO DE CADASTRO ===');
  console.log('URL da API:', url);
  console.log('Dados sendo enviados:', { ...regData, password: '***' }); // Não logamos a senha por segurança
  
  try {
    console.log('Fazendo requisição para a API...');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ regData: regData })
    });
    
    console.log('Status da resposta:', response.status);
    console.log('Headers da resposta:', response.headers);
    
    const res = await response.json();
    console.log('Resposta completa da API:', res);
    
    if (res.error) {
      console.error('Erro retornado pela API:', res.error);
      throw new Error(res.error);
    }
    
    console.log('=== CADASTRO CONCLUÍDO COM SUCESSO ===');
    return res;
  } catch (error) {
    console.error('=== ERRO NO CADASTRO ===');
    console.error('Erro completo:', error);
    console.error('Mensagem do erro:', error.message);
    console.error('Stack do erro:', error.stack);
    throw error;
  }
};

export const updateProfileWithEmail = (profileData) => async (dispatch) => {
  const config = getSafeConfig();
  try{
    const settings = store.getState().settingsdata.settings;
    let host = window && window.location && settings.CompanyWebsite === window.location.origin? window.location.origin : `https://${config.projectId}.web.app`
    let url = `${host}/update_user_email`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        "Authorization": "Basic " + base64.encode(config.projectId + ":" + AccessKey)
      },
      body: JSON.stringify(profileData)
    })
    const result = await response.json();
    if(result.error){ 
      return {success: false, error: result.error}
    }
  }catch(error){
    return {success: false, error: error}
  }
}


export const requestPhoneOtpDevice = (verificationId) => async (dispatch) => {
    console.log('requestPhoneOtpDevice: Iniciando com verificationId:', verificationId);
    if (!verificationId) {
        console.error('requestPhoneOtpDevice: VerificationId inválido');
        dispatch({
            type: REQUEST_OTP_FAILED,
            payload: { code: 'auth/invalid-verification-id', message: 'Verification ID inválido' }
        });
        return;
    }
    
    try {
        // Adicionar timeout para evitar espera infinita
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Timeout ao processar OTP'));
            }, 5000); // 5 segundos de timeout
        });

        // Criar promise para processamento do OTP
        const processPromise = new Promise((resolve) => {
            console.log('requestPhoneOtpDevice: Enviando REQUEST_OTP_SUCCESS');
            dispatch({
                type: REQUEST_OTP_SUCCESS,
                payload: verificationId
            });
            resolve();
        });

        // Usar Promise.race para implementar timeout
        await Promise.race([processPromise, timeoutPromise]);
        console.log('requestPhoneOtpDevice: Processamento concluído com sucesso');
    } catch (error) {
        console.error('requestPhoneOtpDevice: Erro ao processar:', error);
        dispatch({
            type: REQUEST_OTP_FAILED,
            payload: error
        });
    }
}

export const mobileSignIn = (verficationId, code) => (dispatch) => {
    const {
        auth,
        mobileAuthCredential,
        singleUserRef
    } = firebase;

    console.log("mobileSignIn - Iniciando autenticação");
    console.log("VerificationId:", verficationId);
    console.log("Código:", code);

    if (!verficationId || !code) {
        console.error("mobileSignIn - Dados inválidos:", { verficationId, code });
        dispatch({
            type: USER_SIGN_IN_FAILED,
            payload: { message: 'Dados de verificação inválidos' }
        });
        return;
    }

    dispatch({
        type: USER_SIGN_IN,
        payload: null
    });

    try {
        const verificationCode = __DEV__ ? '123456' : code;
        console.log("Código de verificação final:", verificationCode);
        
        const credential = mobileAuthCredential(verficationId, verificationCode);
        console.log("Credencial criada:", credential);
        
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Timeout na autenticação'));
            }, 30000);
        });

        const authPromise = auth.signInWithCredential(credential)
            .then(async (userCredential) => {
                console.log("Usuário autenticado com sucesso:", userCredential);
                const uid = userCredential.user.uid;
                
                // Manter o estado de autenticação com retry limitado
                await maintainAuthState(auth, uid, dispatch);
            })
            .catch(error => {
                console.error("Erro na autenticação:", error);
                dispatch({
                    type: USER_SIGN_IN_FAILED,
                    payload: error
                });
            });

        Promise.race([authPromise, timeoutPromise])
            .catch(error => {
                if (error.message === 'Timeout na autenticação') {
                    console.error("Timeout na autenticação");
                    dispatch({
                        type: USER_SIGN_IN_FAILED,
                        payload: { message: 'Tempo limite excedido na autenticação' }
                    });
                }
            });
    } catch (error) {
        console.error("Erro ao criar credencial:", error);
        dispatch({
            type: USER_SIGN_IN_FAILED,
            payload: error
        });
    }
};

export const saveAddresses = async (uid, location, name) => {
  const { singleUserRef } = firebase;
  singleUserRef(uid).child("savedAddresses").on('value', (savedAdd) => {
    if (savedAdd.val()) {
      let addresses = savedAdd.val();
      let didNotMatch = true;
      for (let key in addresses) {
        let entry = addresses[key];
        if (entry.name == name ) {
          didNotMatch = false;
          singleUserRef(uid).child("savedAddresses/" + key).update({
            description: location.add,
            lat: location.lat,
            lng: location.lng,
            count: 1,
            name: name
          });
          break;
        }
      }
      if (didNotMatch) {
        singleUserRef(uid).child("savedAddresses").push({
          description: location.add,
          lat: location.lat,
          lng: location.lng,
          count: 1,
          name: name
        });
      }
    } else {
      singleUserRef(uid).child("savedAddresses").push({
        description: location.add,
        lat: location.lat,
        lng: location.lng,
        count: 1,
        name: name
      });
    }
  });
};

export const googleLogin = (idToken, accessToken) => (dispatch) => {
    const {
        auth,
        googleCredential
    } = firebase;

    dispatch({
        type: USER_SIGN_IN,
        payload: null
    });

    const credential = googleCredential(idToken, accessToken);
    auth.signInWithCredential(credential)
        .then((user) => {
            // Salvar o UID após autenticação bem-sucedida
            saveAuthUid(user.uid);
            // Dispatch com o UID ao invés do userCredential
            dispatch({
                type: USER_SIGN_IN_SUCCESS,
                payload: { uid: user.uid }
            });
        })
        .catch(error => {
            console.error("Erro no login com Google:", error);
            dispatch({
                type: USER_SIGN_IN_FAILED,
                payload: error
            });
        });
}

export const appleSignIn = (credentialData) => (dispatch) => {
    const {
        auth,
        appleProvider
    } = firebase;

    dispatch({
        type: USER_SIGN_IN,
        payload: null
    });
    
    if (credentialData) {
        const credential = appleProvider.credential(credentialData);
        auth.signInWithCredential(credential)
            .then((user) => {
                // Salvar o UID após autenticação bem-sucedida
                saveAuthUid(user.uid);
                // Dispatch com o UID ao invés do userCredential
                dispatch({
                    type: USER_SIGN_IN_SUCCESS,
                    payload: { uid: user.uid }
                });
            })
            .catch((error) => {
                console.error("Erro no login com Apple:", error);
                dispatch({
                    type: USER_SIGN_IN_FAILED,
                    payload: error
                });
            });
    } else {
        auth.signInWithPopup(appleProvider).then(function (result) {
            auth.signInWithCredential(result.credential)
                .then((user) => {
                    // Salvar o UID após autenticação bem-sucedida
                    saveAuthUid(user.uid);
                    // Dispatch com o UID ao invés do userCredential
                    dispatch({
                        type: USER_SIGN_IN_SUCCESS,
                        payload: { uid: user.uid }
                    });
                })
                .catch(error => {
                    console.error("Erro no login com Apple:", error);
                    dispatch({
                        type: USER_SIGN_IN_FAILED,
                        payload: error
                    });
                });
        }).catch(function (error) {
            console.error("Erro no login com Apple:", error);
            dispatch({
                type: USER_SIGN_IN_FAILED,
                payload: error
            });
        });
    }
};

export const signOff = () => (dispatch) => {
  const {
    auth,
    singleUserRef,
    walletHistoryRef,
    userNotificationsRef
  } = firebase;

  // Usar validateAuthentication para obter o UID de forma segura
  validateAuthentication(auth)
    .then(authResult => {
      const uid = authResult.uid;

      singleUserRef(uid).off();
      walletHistoryRef(uid).off();
      userNotificationsRef(uid).off();

      singleUserRef(uid).on('value', snapshot => {
          if(snapshot.val()){
            const profile = snapshot.val();
            if (profile && profile.usertype === 'driver') {
              singleUserRef(uid).update({driverActiveStatus:false});
            }
            setTimeout(()=>{
              auth.signOut()
              .then(() => {
                // Remover o UID do AsyncStorage ao fazer logout
                removeAuthUid();
                dispatch({
                  type: USER_SIGN_OUT,
                  payload: null
                });
              })
              .catch(error => {
                console.error('Erro ao fazer logout:', error);
              });
            }, 1000);
          }
      });
    })
    .catch(error => {
      console.error('Erro ao validar autenticação durante logout:', error);
      // Tentar logout mesmo assim
      auth.signOut()
        .then(() => {
          removeAuthUid();
          dispatch({
            type: USER_SIGN_OUT,
            payload: null
          });
        })
        .catch(signOutError => {
          console.error('Erro ao fazer logout:', signOutError);
        });
    });
};

export const updateProfile = (updateData) => async (dispatch) => {
  const {
    auth,
    singleUserRef,
    driverDocsRef,
    driverDocsRefBack,
    verifyIdImageRef,
    addressProofImageRef
  } = firebase;

  try {
    // Validar autenticação primeiro
    const authResult = await validateAuthentication(auth);
    const uid = authResult.uid;

    console.log("updateProfile: Firebase config:", { auth: !!auth, singleUserRef: !!singleUserRef, driverDocsRef: !!driverDocsRef, driverDocsRefBack: !!driverDocsRefBack, verifyIdImageRef: !!verifyIdImageRef, addressProofImageRef: !!addressProofImageRef });
    console.log("updateProfile: Iniciando para UID:", uid);
    console.log("updateProfile: Dados recebidos:", updateData);

    if (updateData.licenseImage) {
      console.log("updateProfile: Iniciando upload licenseImage...");
      await driverDocsRef(uid).put(updateData.licenseImage);
      console.log("updateProfile: Upload licenseImage concluído, obtendo URL...");
      updateData.licenseImage = await driverDocsRef(uid).getDownloadURL();
      console.log("updateProfile: URL licenseImage obtida.");
    }

    if (updateData.licenseImageBack) {
      console.log("updateProfile: Iniciando upload licenseImageBack...");
      await driverDocsRefBack(uid).put(updateData.licenseImageBack);
      console.log("updateProfile: Upload licenseImageBack concluído, obtendo URL...");
      updateData.licenseImageBack = await driverDocsRefBack(uid).getDownloadURL();
      console.log("updateProfile: URL licenseImageBack obtida.");
    }

    if (updateData.verifyIdImage) {
      console.log("updateProfile: Iniciando upload verifyIdImage...");
      await verifyIdImageRef(uid).put(updateData.verifyIdImage);
      console.log("updateProfile: Upload verifyIdImage concluído, obtendo URL...");
      updateData.verifyIdImage = await verifyIdImageRef(uid).getDownloadURL();
      console.log("updateProfile: URL verifyIdImage obtida.");
    }

    if (updateData.addressProofImage) {
      console.log("updateProfile: Iniciando upload addressProofImage...");
      await addressProofImageRef(uid).put(updateData.addressProofImage);
      console.log("updateProfile: Upload addressProofImage concluído, obtendo URL...");
      updateData.addressProofImage = await addressProofImageRef(uid).getDownloadURL();
      console.log("updateProfile: URL addressProofImage obtida.");
    }

    console.log("updateProfile: Atualizando banco de dados com dados:", updateData);
    singleUserRef(uid).update(updateData);
    console.log("updateProfile: Atualização do banco de dados concluída.");
  } catch (error) {
    console.error("updateProfile: Erro durante a execução:", error);
    throw error;
  }
};


// Função para validar autenticação antes de operações críticas
export const validateAuthentication = async (auth) => {
    if (!auth) throw new Error('AUTHENTICATION_REQUIRED');
    // Aguarda o auth estar pronto (no React Native, geralmente já está)
    const currentUser = auth.currentUser;
    if (currentUser && currentUser.uid) {
        return {
            uid: currentUser.uid,
            user: currentUser
        };
    }
    // Se não houver usuário autenticado, lançar erro
    throw new Error('AUTHENTICATION_REQUIRED');
};

export const updateProfileImage = async (imageBlob, imageUri = null) => {
  const {
    auth,
    profileImageRef,
    singleUserRef
  } = firebase;

  try {
    console.log('[updateProfileImage] Iniciando...');
    console.log('[updateProfileImage] Firebase auth:', !!auth);
    console.log('[updateProfileImage] Auth currentUser:', auth?.currentUser);

    // Validar autenticação primeiro
    const authResult = await validateAuthentication(auth);
    const uid = authResult.uid;
    console.log('[updateProfileImage] Autenticação validada para UID:', uid);

    const ref = profileImageRef(uid);
    console.log('[updateProfileImage] profileImageRef(uid):', ref);

    console.log('[updateProfileImage] Fazendo upload seguro...');
    console.log('[updateProfileImage] Tipo de imageBlob:', typeof imageBlob);

    let url;
    if (imageUri) {
      console.log('[updateProfileImage] Usando URI para upload:', imageUri);
      const uri = imageUri;
      console.log('[updateProfileImage] URI para upload:', uri);
      
      try {
        console.log('[updateProfileImage] Fazendo upload com putFile...');
        await ref.putFile(uri);
      } catch (putFileError) {
        console.log('[updateProfileImage] putFile falhou, tentando upload direto do blob...');
        console.log('[updateProfileImage] Fazendo upload direto do blob...');
        await ref.put(imageBlob);
      }
    } else {
      console.log('[updateProfileImage] Fazendo upload direto do blob...');
      await ref.put(imageBlob);
    }

    console.log('[updateProfileImage] Upload concluído!');
    url = await ref.getDownloadURL();
    console.log('[updateProfileImage] URL de download obtida:', url);

    await singleUserRef(uid).update({
      profile_image: url
    });
    console.log('[updateProfileImage] Perfil atualizado com sucesso!');
    return url;
  } catch (error) {
    console.error('[updateProfileImage] Erro no upload:', error);
    console.error('[updateProfileImage] Stack trace:', error.stack);
    throw error;
  }
};

export const updateWebProfileImage = async (imageBlob) => {
  const {
    auth,
    profileImageRef,
    singleUserRef
  } = firebase;

  try {
    const authResult = await validateAuthentication(auth);
    const uid = authResult.uid;
    
    const ref = profileImageRef(uid);
    await ref.put(imageBlob);
    let image = await ref.getDownloadURL();
    singleUserRef(uid).update({profile_image: image});
    return image;
  } catch (error) {
    console.error('[updateWebProfileImage] Erro:', error);
    throw error;
  }
};

export const updateCustomerProfileImage = async (imageBlob, id) => {
  const {
    auth,
    profileImageRef,
    singleUserRef
  } = firebase;

  try {
    let uid;
    if (id) {
      uid = id;
    } else {
      const authResult = await validateAuthentication(auth);
      uid = authResult.uid;
    }
    
    const ref = profileImageRef(uid);
    await ref.put(imageBlob);
    let image = await ref.getDownloadURL();
    singleUserRef(uid).update({profile_image: image});
    return image;
  } catch (error) {
    console.error('[updateCustomerProfileImage] Erro:', error);
    throw error;
  }
};

export const updatePushToken = (token, platform)  => {
  const {
    auth,
    singleUserRef
  } = firebase;

  validateAuthentication(auth)
    .then(authResult => {
      const uid = authResult.uid;
      singleUserRef(uid).update({
        pushToken: token,
        platform: platform
      });
    })
    .catch(error => {
      console.error('[updatePushToken] Erro ao validar autenticação:', error);
    });
};

export const clearLoginError = () => (dispatch) => {
    console.log("Limpando erro de login");
    dispatch({
        type: CLEAR_LOGIN_ERROR,
        payload: null
    });
};

export const fetchWalletHistory = () => (dispatch) => {
  const {
    auth,
    walletHistoryRef
  } = firebase;

  validateAuthentication(auth)
    .then(authResult => {
      const uid = authResult.uid;
      walletHistoryRef(uid).on('value', snapshot => {
        if (snapshot.val()) {
          dispatch({
            type: UPDATE_USER_WALLET_HISTORY,
            payload: snapshot.val()
          });
        }
      });
    })
    .catch(error => {
      console.error('[fetchWalletHistory] Erro ao validar autenticação:', error);
    });
};

export const fetchUserWalletHistory = (userId) => (dispatch) => {
  const {
    walletHistoryRef
  } = firebase;

  walletHistoryRef(userId).on('value', snapshot => {
    if (snapshot.val()) {
      dispatch({
        type: UPDATE_USER_WALLET_HISTORY,
        payload: snapshot.val()
      });
    } else {
      dispatch({
        type: UPDATE_USER_WALLET_HISTORY,
        payload: {}
      });
    }
  });
};

export const sendResetMail = (email) => async (dispatch) => {
  const {
    auth
  } = firebase;

  try {
    dispatch({
      type: SEND_RESET_EMAIL,
      payload: email
    });

    // Usando a implementação correta do Firebase React Native
    await auth().sendPasswordResetEmail(email);
    console.log('Email de recuperação enviado com sucesso');
    
    return { success: true };
  } catch (error) {
    console.error('Erro ao enviar email de recuperação:', error);
    
    let errorMessage = 'Não foi possível enviar o email de recuperação.';
    if (error.code === 'auth/user-not-found') {
      errorMessage = 'Não encontramos uma conta com este email.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'O email fornecido é inválido.';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = 'Muitas tentativas. Por favor, tente novamente mais tarde.';
    }

    dispatch({
      type: SEND_RESET_EMAIL_FAILED,
      payload: { code: error.code, message: errorMessage }
    });

    return { success: false, error: errorMessage };
  }
};

export const verifyEmailPassword = (email, pass) => async (dispatch) => {
    const {
        authRef
    } = firebase;

    signInWithEmailAndPassword(authRef(), email, pass)
        .then((user) => {
            // Salvar o UID após autenticação bem-sucedida
            saveAuthUid(user.uid);
            // Dispatch com o UID ao invés do userCredential
            dispatch({
                type: USER_SIGN_IN_SUCCESS,
                payload: { uid: user.uid }
            });
        })
        .catch((error) => {
            console.error("Erro no login com email/senha:", error);
            dispatch({
                type: USER_SIGN_IN_FAILED,
                payload: error
            });
        });
}

export const requestMobileOtp = (mobile) => async (dispatch) => {
  const config = getSafeConfig();
  dispatch({
    type: REQUEST_OTP,
    payload: true
  }); 

  const settings = store.getState().settingsdata.settings;
  let host = window && window.location && settings.CompanyWebsite === window.location.origin? window.location.origin : `https://${config.projectId}.web.app`
  let url = `${host}/request_mobile_otp`;
  try{
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mobile: mobile })
    });
    const result = await response.json();
    if(result.success){
      dispatch({
        type: REQUEST_OTP_SUCCESS,
        payload: true
      });
    }else{
      dispatch({
        type: REQUEST_OTP_FAILED,
        payload: result.error
      });
    }
  }catch(error){
    console.log(error);
  }
}

export const verifyMobileOtp = (mobile, otp) => async (dispatch) => {
  const {
    auth
  } = firebase;
  const config = getSafeConfig();
  const body = {
    mobile: mobile,
    otp: otp
  };
  try{
    const settings = store.getState().settingsdata.settings;
    let host = window && window.location && settings.CompanyWebsite === window.location.origin? window.location.origin : `https://${config.projectId}.web.app`
    let url = `${host}/verify_mobile_otp`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    })
    const result = await response.json();
    if(result.token){
      signInWithCustomToken(auth,result.token)
        .then((user) => {
          //OnAuthStateChange takes care of Navigation
        })
        .catch((error) => {
          dispatch({
            type: USER_SIGN_IN_FAILED,
            payload: error
          });
        });
    }else{
      dispatch({
        type: USER_SIGN_IN_FAILED,
        payload: result.error
      });
    }
  }catch(error){
    console.log(error);
    dispatch({
      type: USER_SIGN_IN_FAILED,
      payload: error
    });
  }
}

export const updateAuthMobile = async ( mobile, otp) => {
  const {
    auth,
    singleUserRef
  } = firebase;

  try {
    const authResult = await validateAuthentication(auth);
    const uid = authResult.uid;
    
    singleUserRef(uid).update({
      mobile: mobile,
      mobileVerified: true
    });
  } catch (error) {
    console.error('[updateAuthMobile] Erro:', error);
    throw error;
  }
};

export const updateUserType = (uid, documents) => async (dispatch) => {
    try {
        console.log('[updateUserType] Iniciando atualização do tipo de usuário:', {
            uid,
            documents
        });

        // Atualizar no Firebase
        await firebase.singleUserRef(uid).update({
            usertype: 'driver',
            documents: documents,
            approved: false,
            updatedAt: new Date().toISOString()
        });

        // Atualizar no AsyncStorage
        const storedUserData = await AsyncStorage.getItem('@user_data');
        if (storedUserData) {
            const userData = JSON.parse(storedUserData);
            const updatedUserData = {
                ...userData,
                usertype: 'driver',
                documents: documents,
                approved: false
            };
            await AsyncStorage.setItem('@user_data', JSON.stringify(updatedUserData));
        }

        // Atualizar no Redux
        dispatch({
            type: FETCH_USER_SUCCESS,
            payload: {
                ...store.getState().auth.profile,
                usertype: 'driver',
                documents: documents,
                approved: false
            }
        });

        console.log('[updateUserType] Atualização concluída com sucesso');
        return true;
    } catch (error) {
        console.error('[updateUserType] Erro ao atualizar tipo de usuário:', error);
        throw error;
    }
};
