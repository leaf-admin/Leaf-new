// Navegação aberta no Waze ou no Google Maps durante a corrida. O Android não deixa
// um app encerrar a navegação de outro: no fim da corrida o recibo oferece um toque
// que leva o motorista até o app de navegação para ele encerrar a rota.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import Logger from '../utils/Logger';

const LAST_KEY = 'leaf:driver-external-navigation:last:v1';
// Uma navegação aberta há mais tempo que isso não é desta corrida.
const RECENT_MS = 6 * 60 * 60 * 1000;
const GOOGLE_MAPS_PACKAGE = 'com.google.android.apps.maps';

export const EXTERNAL_NAVIGATION_APP_LABELS = {
  google_maps: 'Google Maps',
  waze: 'Waze',
  apple_maps: 'Mapas da Apple',
};

export async function rememberExternalNavigation(app, now = Date.now()) {
  if (!EXTERNAL_NAVIGATION_APP_LABELS[app]) return;
  try {
    await AsyncStorage.setItem(LAST_KEY, JSON.stringify({ app, at: now }));
  } catch (_error) {
    // só perde a oferta de fechar no recibo
  }
}

export async function getRecentExternalNavigation(now = Date.now()) {
  try {
    const value = JSON.parse((await AsyncStorage.getItem(LAST_KEY)) || 'null');
    if (!value || !EXTERNAL_NAVIGATION_APP_LABELS[value.app]) return null;
    if (!(now - Number(value.at) <= RECENT_MS)) return null;
    return { app: value.app, label: EXTERNAL_NAVIGATION_APP_LABELS[value.app] };
  } catch (_error) {
    return null;
  }
}

export async function forgetExternalNavigation() {
  try {
    await AsyncStorage.removeItem(LAST_KEY);
  } catch (_error) {
    // nada a fazer
  }
}

function coordinateParam(coordinate) {
  const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
  const longitude = Number(coordinate?.longitude ?? coordinate?.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude},${longitude}` : '0,0';
}

/**
 * Leva o motorista ao app de navegação para encerrar a rota. No Google Maps (Android)
 * abrir um ponto no mapa durante a navegação faz o próprio Maps perguntar "Sair da
 * navegação?"; no Waze e no iOS o app abre e o motorista encerra por lá.
 */
export async function closeExternalNavigation({ app, coordinate = null } = {}) {
  const position = coordinateParam(coordinate);
  try {
    if (app === 'google_maps' && Platform.OS === 'android') {
      // Carregado só aqui: o módulo nativo não existe nos testes.
      const IntentLauncher = require('expo-intent-launcher');
      // Sem esperar o resultado: a activity do Maps só termina quando ele sai.
      IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: `geo:${position}?z=16`,
        packageName: GOOGLE_MAPS_PACKAGE,
      }).catch(() => Linking.openURL(`geo:${position}?z=16`).catch(() => {}));
    } else if (app === 'google_maps') {
      await Linking.openURL(`comgooglemaps://?center=${position}`);
    } else if (app === 'waze') {
      await Linking.openURL('waze://');
    } else if (app === 'apple_maps') {
      await Linking.openURL('maps://');
    } else {
      return false;
    }
  } catch (error) {
    Logger.warn('⚠️ [ExternalNavigation] Falha ao abrir o app de navegação:', error?.message || error);
    return false;
  } finally {
    await forgetExternalNavigation();
  }
  return true;
}
