import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firebaseAuth from '@react-native-firebase/auth';
import { CommonActions } from '@react-navigation/native';
import { useDispatch } from 'react-redux';

import { USER_SIGN_OUT } from '../services/runtime/authTypesBridge';
import WebSocketManager from '../services/WebSocketManager';
import Logger from '../utils/Logger';

const BASE_SESSION_STORAGE_KEYS = [
  '@user_data',
  '@auth_uid',
  '@auth_token',
  '@qa_socket_id_token',
  'fcmToken',
];

function buildSessionStorageKeys(userId) {
  const keys = new Set(BASE_SESSION_STORAGE_KEYS);
  const safeUid = String(userId || '').trim();

  if (safeUid) {
    keys.add(`@prototype_runtime_session_${safeUid}`);
    keys.add(`@prototype_runtime_qa_seed_${safeUid}`);
  }

  return Array.from(keys);
}

function scheduleNavigationReset(navigation) {
  const resetAction = CommonActions.reset({
    index: 0,
    routes: [{ name: 'Splash' }],
  });

  const tryReset = () => {
    const rootNavigation = globalThis?.navigationRef;

    if (rootNavigation?.isReady?.()) {
      rootNavigation.dispatch(resetAction);
      return true;
    }

    if (navigation?.reset) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Splash' }],
      });
      return true;
    }

    if (navigation?.replace) {
      navigation.replace('Splash');
      return true;
    }

    return false;
  };

  setTimeout(() => {
    if (!tryReset()) {
      setTimeout(tryReset, 150);
    }
  }, 50);
}

export function useAccountSessionReset({ navigation, profile } = {}) {
  const dispatch = useDispatch();

  const resetSessionToStart = useCallback(async ({ signOutFirebase = true } = {}) => {
    const authUser = firebaseAuth().currentUser;
    const uid =
      profile?.uid ||
      profile?.id ||
      authUser?.uid ||
      '';

    try {
      const webSocketManager = WebSocketManager.getInstance();
      if (typeof webSocketManager.clearAuthenticationState === 'function') {
        webSocketManager.clearAuthenticationState({ disconnect: true });
      } else if (typeof webSocketManager.disconnect === 'function') {
        webSocketManager.disconnect();
      }
    } catch (socketError) {
      Logger.warn('Falha ao encerrar socket durante saída da conta:', socketError);
    }

    if (signOutFirebase) {
      try {
        if (authUser) {
          await firebaseAuth().signOut();
        }
      } catch (authError) {
        if (authError?.code !== 'auth/no-current-user') {
          Logger.warn('Falha ao encerrar sessão Firebase:', authError);
        }
      }
    }

    try {
      await AsyncStorage.multiRemove(buildSessionStorageKeys(uid));
    } catch (storageError) {
      Logger.warn('Falha ao limpar sessão local:', storageError);
    }

    dispatch({ type: USER_SIGN_OUT, payload: null });
    scheduleNavigationReset(navigation);
  }, [dispatch, navigation, profile?.id, profile?.uid]);

  return { resetSessionToStart };
}
