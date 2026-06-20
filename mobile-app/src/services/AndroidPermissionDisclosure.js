import { Alert, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY = 'has_shown_background_location_modal';

const ANDROID_PERMISSION_RESULTS = PermissionsAndroid?.RESULTS || {
  GRANTED: 'granted',
  DENIED: 'denied',
};

const ANDROID_FOREGROUND_LOCATION_DISCLOSURE = {
  title: 'Localização do passageiro',
  message:
    'A Leaf coleta e envia sua localização precisa aos servidores da Leaf para mostrar sua posição no mapa, definir o ponto de partida, encontrar motoristas próximos, calcular rotas, estimar preço e acompanhar a corrida com segurança. Durante uma corrida, sua localização pode ser compartilhada com o motorista para facilitar o embarque e a viagem. A Leaf não usa sua localização para anúncios.',
  confirmText: 'Concordo e continuar',
  kind: 'foreground-location',
};

const ANDROID_BACKGROUND_LOCATION_DISCLOSURE = {
  title: 'Localização do motorista',
  message:
    'A Leaf coleta e envia sua localização precisa aos servidores da Leaf para permitir que motoristas online recebam corridas próximas, mantenham a navegação ativa, compartilhem a posição com o passageiro durante a viagem e viabilizem recursos de segurança. Quando você estiver online como motorista ou em uma corrida, essa coleta pode acontecer em segundo plano, mesmo quando o app estiver fechado ou não estiver em uso. A Leaf não usa sua localização para anúncios.',
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

export function setAndroidPermissionDisclosurePresenter(presenter) {
  androidPermissionDisclosurePresenter = typeof presenter === 'function' ? presenter : null;

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

function showAndroidDisclosure(disclosure) {
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
      { cancelable: true, onDismiss: () => settle(false) }
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

  const accepted = await showAndroidDisclosure(ANDROID_FOREGROUND_LOCATION_DISCLOSURE);
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

  const accepted = await showAndroidDisclosure(ANDROID_BACKGROUND_LOCATION_DISCLOSURE);
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
