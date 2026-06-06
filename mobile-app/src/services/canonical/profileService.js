import AsyncStorage from '@react-native-async-storage/async-storage';
import base64 from 'react-native-base64';

import { FirebaseConfig } from '../../../config/FirebaseConfig';
import { store } from '../../state/appStore';
import Logger from '../../utils/Logger';
import AccessKey from './functionAccessKey';
import { firebase } from './firebaseConfig';
import { checkUserExists } from './registrationService';
import { storeAddresses } from './locationService';

const USER_SIGN_OUT = 'USER_SIGN_OUT';
const AUTH_UID_KEY = '@auth_uid';

const getSafeConfig = () => firebase.config || FirebaseConfig;

const getConfiguredHost = () => {
  const config = getSafeConfig();
  const settings = store.getState()?.settingsdata?.settings || {};
  const browserOrigin = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : null;

  if (browserOrigin && settings.CompanyWebsite === browserOrigin) {
    return browserOrigin;
  }

  return `https://${config.projectId}.web.app`;
};

const getUserDataFromStorage = async () => {
  try {
    const userDataStr = await AsyncStorage.getItem('@user_data');
    return userDataStr ? JSON.parse(userDataStr) : null;
  } catch (error) {
    Logger.warn('[profileService] Erro ao ler dados locais do usuário:', error);
    return null;
  }
};

const isQaTestUid = (uid) => Boolean(
  uid && (uid.includes('test-user-dev') || uid.includes('test-customer-dev')),
);

export const validateAuthentication = async (auth = firebase.auth) => {
  if (auth?.currentUser?.uid) {
    return {
      uid: auth.currentUser.uid,
      user: auth.currentUser,
    };
  }

  const userData = await getUserDataFromStorage();
  if (isQaTestUid(userData?.uid)) {
    Logger.log('[profileService] Usuário de teste detectado via AsyncStorage');
    return {
      uid: userData.uid,
      user: { uid: userData.uid },
    };
  }

  throw new Error('AUTHENTICATION_REQUIRED');
};

const removeAuthUid = async () => {
  try {
    await AsyncStorage.removeItem(AUTH_UID_KEY);
  } catch (error) {
    Logger.warn('[profileService] Erro ao remover UID local:', error);
  }
};

const maybeOff = (ref) => {
  if (ref && typeof ref.off === 'function') {
    ref.off();
  }
};

const maybeUpdateDriverOffline = async (uid) => {
  const { singleUserRef } = firebase;
  const userRef = singleUserRef(uid);
  const snapshot = await userRef.once('value');
  const profile = snapshot?.val?.();

  if (profile?.usertype === 'driver') {
    await userRef.update({ driverActiveStatus: false });
  }
};

export const signOff = () => (dispatch) => {
  const {
    auth,
    singleUserRef,
    walletHistoryRef,
    userNotificationsRef,
  } = firebase;
  const currentUser = auth?.currentUser;
  const uid = currentUser?.uid;

  const clearRemoteState = uid
    ? Promise.resolve()
        .then(() => {
          maybeOff(singleUserRef(uid));
          maybeOff(walletHistoryRef(uid));
          maybeOff(userNotificationsRef(uid));
          return maybeUpdateDriverOffline(uid);
        })
        .catch((error) => {
          Logger.warn('[profileService] Erro ao limpar estado remoto no logout:', error);
        })
    : Promise.resolve();

  const signOut = currentUser
    ? auth.signOut().catch((error) => {
        if (error?.code === 'auth/no-current-user') {
          return;
        }
        Logger.warn('[profileService] Erro ao sair do Firebase Auth:', error);
      })
    : Promise.resolve();

  return Promise.all([clearRemoteState, signOut])
    .then(async () => {
      await removeAuthUid();
      await AsyncStorage.multiRemove([
        '@user_data',
        '@auth_token',
        '@auth_uid',
        'fcmToken',
      ]).catch((error) => {
        Logger.warn('[profileService] Erro ao limpar AsyncStorage:', error);
      });

      dispatch({
        type: USER_SIGN_OUT,
        payload: null,
      });
    })
    .catch(async (error) => {
      Logger.error('[profileService] Erro durante logout:', error);
      await removeAuthUid();
      dispatch({
        type: USER_SIGN_OUT,
        payload: null,
      });
    });
};

export const logOut = signOff;

export const saveAddresses = async (uid, location, name) => {
  const { singleUserRef } = firebase;
  const savedRef = singleUserRef(uid).child('savedAddresses');
  const savedSnapshot = await savedRef.once('value');
  const addresses = savedSnapshot?.val?.();
  const payload = {
    description: location.add,
    lat: location.lat,
    lng: location.lng,
    count: 1,
    name,
  };

  if (!addresses) {
    await savedRef.push(payload);
    return;
  }

  const existingKey = Object.keys(addresses).find((key) => addresses[key]?.name === name);
  if (existingKey) {
    await savedRef.child(existingKey).update(payload);
    return;
  }

  await savedRef.push(payload);
};

const uploadAndReplace = async (updateData, key, refFactory, uid) => {
  if (!updateData[key]) {
    return;
  }

  const ref = refFactory(uid);
  await ref.put(updateData[key]);
  updateData[key] = await ref.getDownloadURL();
};

const getAddressProofImageRef = (uid) => {
  if (firebase.addressProofImageRef) {
    return firebase.addressProofImageRef(uid);
  }

  return firebase.storage.ref(`users/${uid}/addressProofImage`);
};

export const updateProfile = (updateData) => async () => {
  const {
    auth,
    singleUserRef,
    driverDocsRef,
    driverDocsRefBack,
    verifyIdImageRef,
  } = firebase;
  const { uid } = await validateAuthentication(auth);

  await uploadAndReplace(updateData, 'licenseImage', driverDocsRef, uid);
  await uploadAndReplace(updateData, 'licenseImageBack', driverDocsRefBack, uid);
  await uploadAndReplace(updateData, 'verifyIdImage', verifyIdImageRef, uid);
  await uploadAndReplace(updateData, 'addressProofImage', getAddressProofImageRef, uid);

  await singleUserRef(uid).update(updateData);
};

const assertProfileImageCanChange = async (uid) => {
  const userSnapshot = await firebase.singleUserRef(uid).once('value');
  const userData = userSnapshot?.val?.() || {};
  const isDriver = userData.usertype === 'driver' || userData.userType === 'driver';

  if (isDriver) {
    throw new Error('PROFILE_IMAGE_LOCKED_FOR_DRIVER');
  }
};

export const updateProfileImage = async (imageBlob, imageUri = null) => {
  const { uid } = await validateAuthentication(firebase.auth);
  await assertProfileImageCanChange(uid);

  const ref = firebase.profileImageRef(uid);
  if (imageUri) {
    try {
      await ref.putFile(imageUri);
    } catch (error) {
      Logger.log('[profileService] putFile falhou, tentando upload por blob:', error);
      await ref.put(imageBlob);
    }
  } else {
    await ref.put(imageBlob);
  }

  const url = await ref.getDownloadURL();
  await firebase.singleUserRef(uid).update({ profile_image: url });
  return url;
};

export const updateProfileWithEmail = (profileData) => async () => {
  const config = getSafeConfig();

  try {
    const response = await fetch(`${getConfiguredHost()}/update_user_email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${base64.encode(`${config.projectId}:${AccessKey}`)}`,
      },
      body: JSON.stringify(profileData),
    });
    const result = await response.json();

    if (result.error) {
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
};

export {
  checkUserExists,
  storeAddresses,
};
