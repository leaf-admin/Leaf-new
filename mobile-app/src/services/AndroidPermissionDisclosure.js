import { Alert, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY = 'has_shown_background_location_modal';
const ANDROID_PERMISSION_RESULTS = PermissionsAndroid?.RESULTS || {
  GRANTED: 'granted',
  DENIED: 'denied',
};

const ANDROID_FOREGROUND_LOCATION_DISCLOSURE = {
  title: 'Localização da Leaf',
  message:
    'A Leaf acessa, coleta e envia sua localização aos serviços da Leaf para mostrar sua posição no mapa, encontrar motoristas próximos, calcular rotas e acompanhar viagens com segurança. A Leaf não usa essa permissão para anúncios.',
  confirmText: 'Concordo e continuar',
  kind: 'foreground-location',
};

const ANDROID_BACKGROUND_LOCATION_DISCLOSURE = {
  title: 'Localização em segundo plano',
  message:
    'A Leaf coleta e envia sua localização em segundo plano, inclusive quando o app não está aberto, somente enquanto você estiver online como motorista ou durante uma viagem, para receber corridas, orientar a navegação e manter a operação segura. A Leaf não usa essa permissão para anúncios.',
  confirmText: 'Concordo e continuar',
  kind: 'background-location',
};

const ANDROID_NOTIFICATIONS_DISCLOSURE = {
  title: 'Notificações da Leaf',
  message:
    'A Leaf usa notificações para avisar sobre corridas, pagamentos, segurança e suporte. A permissão será solicitada agora pelo Android.',
  confirmText: 'Concordo e continuar',
  kind: 'notifications',
};

const ANDROID_PHONE_STATE_DISCLOSURE = {
  title: 'Telefone da Leaf',
  message:
    'A Leaf acessa o estado do telefone somente quando você escolhe detectar seu número automaticamente, para preencher o cadastro. Você também pode digitar o número manualmente. A Leaf não usa essa permissão para anúncios.',
  confirmText: 'Concordo e continuar',
  kind: 'phone-state',
};

let androidPermissionDisclosurePresenter = null;
const pendingPresenterResolvers = new Set();
const FRIENDLY_ALERT_PATCH_BYPASS_OPTION_KEY = '__skipFriendlyAlertPatch';
const ANDROID_DISCLOSURE_PRESENTER_WAIT_MS = process.env.NODE_ENV === 'test' ? 1 : 1200;

export function setAndroidPermissionDisclosurePresenter(presenter) {
  androidPermissionDisclosurePresenter = typeof presenter === 'function' ? presenter : null;
  if (androidPermissionDisclosurePresenter) {
    pendingPresenterResolvers.forEach(resolve => resolve(androidPermissionDisclosurePresenter));
    pendingPresenterResolvers.clear();
  }

  return () => {
    if (androidPermissionDisclosurePresenter === presenter) {
      androidPermissionDisclosurePresenter = null;
    }
  };
}

function deniedPermissionResponse(permission = {}) {
  return {
    ...permission,
    status: 'denied',
    granted: false,
    canAskAgain: permission.canAskAgain ?? true,
    expires: permission.expires ?? 'never',
  };
}

function waitForAndroidPermissionDisclosurePresenter(timeoutMs = ANDROID_DISCLOSURE_PRESENTER_WAIT_MS) {
  if (typeof androidPermissionDisclosurePresenter === 'function') {
    return Promise.resolve(androidPermissionDisclosurePresenter);
  }

  return new Promise(resolve => {
    const resolver = presenter => {
      clearTimeout(timeoutId);
      pendingPresenterResolvers.delete(resolver);
      resolve(typeof presenter === 'function' ? presenter : null);
    };
    const timeoutId = setTimeout(() => resolver(null), timeoutMs);
    pendingPresenterResolvers.add(resolver);
  });
}

async function showAndroidDisclosure(disclosure, options = {}) {
  if (Platform.OS !== 'android') {
    return Promise.resolve(true);
  }

  const { title, message, confirmText, kind } = disclosure || {};

  if (typeof androidPermissionDisclosurePresenter === 'function') {
    return androidPermissionDisclosurePresenter({
      title,
      message,
      confirmText,
      cancelText: 'Agora não',
      kind,
    });
  }

  if (options.requirePresenter) {
    const presenter = await waitForAndroidPermissionDisclosurePresenter();
    if (typeof presenter === 'function') {
      return presenter({
        title,
        message,
        confirmText,
        cancelText: 'Agora não',
        kind,
      });
    }

    return false;
  }

  return new Promise(resolve => {
    let settled = false;
    const settle = value => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    Alert.alert(
      title,
      message,
      [
        { text: 'Agora não', style: 'cancel', onPress: () => settle(false) },
        { text: confirmText, onPress: () => settle(true) },
      ],
      {
        cancelable: true,
        onDismiss: () => settle(false),
        [FRIENDLY_ALERT_PATCH_BYPASS_OPTION_KEY]: true,
      }
    );
  });
}

function getLocationModule() {
  return require('expo-location');
}

export async function requestForegroundLocationPermissionWithDisclosure() {
  const Location = getLocationModule();

  if (Platform.OS !== 'android') {
    return Location.requestForegroundPermissionsAsync();
  }

  const currentPermission = await Location.getForegroundPermissionsAsync();
  if (currentPermission.status === 'granted' || currentPermission.canAskAgain === false) {
    return currentPermission;
  }

  const accepted = await showAndroidDisclosure(ANDROID_FOREGROUND_LOCATION_DISCLOSURE, {
    requirePresenter: true,
  });
  if (!accepted) {
    return deniedPermissionResponse(currentPermission);
  }

  return Location.requestForegroundPermissionsAsync();
}

export async function requestBackgroundLocationPermissionWithDisclosure() {
  const Location = getLocationModule();

  if (Platform.OS !== 'android') {
    return Location.requestBackgroundPermissionsAsync();
  }

  const currentPermission = await Location.getBackgroundPermissionsAsync();
  if (currentPermission.status === 'granted') {
    return currentPermission;
  }

  const accepted = await showAndroidDisclosure(ANDROID_BACKGROUND_LOCATION_DISCLOSURE, {
    requirePresenter: true,
  });
  if (!accepted) {
    return deniedPermissionResponse(currentPermission);
  }

  await AsyncStorage.setItem(BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY, 'true');
  return Location.requestBackgroundPermissionsAsync();
}

export async function requestPostNotificationsPermissionWithDisclosure(
  permission = PermissionsAndroid?.PERMISSIONS?.POST_NOTIFICATIONS || 'android.permission.POST_NOTIFICATIONS'
) {
  if (Platform.OS !== 'android') {
    return ANDROID_PERMISSION_RESULTS.GRANTED;
  }

  const accepted = await showAndroidDisclosure(ANDROID_NOTIFICATIONS_DISCLOSURE);
  if (!accepted) {
    return ANDROID_PERMISSION_RESULTS.DENIED;
  }

  return PermissionsAndroid.request(permission);
}

export async function requestPhoneStatePermissionWithDisclosure(
  permission = PermissionsAndroid?.PERMISSIONS?.READ_PHONE_STATE || 'android.permission.READ_PHONE_STATE'
) {
  if (Platform.OS !== 'android') {
    return ANDROID_PERMISSION_RESULTS.GRANTED;
  }

  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) {
    return ANDROID_PERMISSION_RESULTS.GRANTED;
  }

  const accepted = await showAndroidDisclosure(ANDROID_PHONE_STATE_DISCLOSURE);
  if (!accepted) {
    return ANDROID_PERMISSION_RESULTS.DENIED;
  }

  return PermissionsAndroid.request(permission);
}

export async function requestExpoNotificationsPermissionWithDisclosure(Notifications, options) {
  if (Platform.OS !== 'android') {
    return Notifications.requestPermissionsAsync(options);
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  if (currentPermission.status === 'granted') {
    return currentPermission;
  }

  const accepted = await showAndroidDisclosure(ANDROID_NOTIFICATIONS_DISCLOSURE);
  if (!accepted) {
    return deniedPermissionResponse(currentPermission);
  }

  return Notifications.requestPermissionsAsync(options);
}
