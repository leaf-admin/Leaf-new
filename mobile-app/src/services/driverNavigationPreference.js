// App de navegação do motorista. A Leaf não tem navegação própria (custo):
// a rota abre no Waze, no Google Maps ou nos Mapas da Apple. A escolha fica no
// aparelho; sem escolha, o app pergunta uma vez e guarda.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { showLeafChoiceSheet } from '../components/design-system/LeafChoiceSheet';
import { openDriverExternalNavigation } from './DriverExternalNavigationService';
import { rememberExternalNavigation } from './externalNavigationSession';

const APP_KEY = 'leaf:driver-navigation-app:v1';
const AUTO_KEY = 'leaf:driver-navigation-auto:v1';
const LAST_AUTO_OPEN_KEY = 'leaf:driver-navigation-last-auto-open:v1';

export const NAVIGATION_APP_LABELS = Object.freeze({
  waze: 'Waze',
  google_maps: 'Google Maps',
  apple_maps: 'Mapas da Apple',
});

export function navigationAppOptions(platform = Platform.OS) {
  return ['waze', 'google_maps', ...(platform === 'ios' ? ['apple_maps'] : [])]
    .map((key) => ({ key, label: NAVIGATION_APP_LABELS[key] }));
}

function isKnownApp(value, platform = Platform.OS) {
  return navigationAppOptions(platform).some((option) => option.key === value);
}

async function read(key) {
  try {
    return await AsyncStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

async function write(key, value) {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch (error) {
    // Sem armazenamento, a escolha vale só nesta sessão.
  }
}

export async function getPreferredNavigationApp() {
  const value = await read(APP_KEY);
  return isKnownApp(value) ? value : null;
}

export async function setPreferredNavigationApp(app) {
  await write(APP_KEY, isKnownApp(app) ? app : null);
  return getPreferredNavigationApp();
}

export async function isAutoNavigationEnabled() {
  return (await read(AUTO_KEY)) !== 'false';
}

export async function setAutoNavigationEnabled(enabled) {
  await write(AUTO_KEY, enabled ? 'true' : 'false');
  return isAutoNavigationEnabled();
}

export async function choosePreferredNavigationApp({ allowAskEveryTime = false } = {}) {
  const key = await showLeafChoiceSheet({
    title: 'Qual app você usa para navegar?',
    message: 'A rota da corrida abre nele. Dá para trocar em Configurações.',
    options: [
      ...navigationAppOptions(),
      ...(allowAskEveryTime ? [{ key: 'ask', label: 'Perguntar toda vez', tone: 'secondary' }] : []),
    ],
    dismissible: true,
  });
  if (key === 'ask') {
    await setPreferredNavigationApp(null);
    return null;
  }
  return isKnownApp(key) ? setPreferredNavigationApp(key) : undefined;
}

// Abre a rota no app preferido. Sem preferência, pergunta uma vez e guarda.
// A caminho do embarque, o Google Maps recebe as duas pernas de uma vez
// (embarque como parada, destino no fim); Waze e Mapas da Apple só aceitam um
// destino por link, então recebem o embarque e, ao iniciar, o destino.
export async function openPreferredDriverNavigation({
  coordinate,
  destinationLabel = '',
  phase = 'pickup',
  finalDestinationCoordinate = null,
}) {
  let app = await getPreferredNavigationApp();
  if (!app) {
    app = await choosePreferredNavigationApp();
    if (!app) return null;
  }
  const bothLegs = app === 'google_maps' && phase === 'pickup' && hasCoordinate(finalDestinationCoordinate);
  const openedApp = await openDriverExternalNavigation({
    coordinate: bothLegs ? finalDestinationCoordinate : coordinate,
    stopover: bothLegs ? coordinate : null,
    destinationLabel,
    phase,
    app,
  });
  // Lembra o app aberto: no fim da corrida o recibo oferece fechar a navegação.
  if (openedApp) await rememberExternalNavigation(openedApp);
  return openedApp;
}

function hasCoordinate(value) {
  return Boolean(
    value
      && Number.isFinite(Number(value.latitude ?? value.lat))
      && Number.isFinite(Number(value.longitude ?? value.lng))
  );
}

// Abertura automática: uma vez por corrida e fase (embarque, destino), também
// depois de o app ser reaberto no meio da corrida.
export async function claimAutoNavigationOpen(bookingId, phase) {
  const key = `${String(bookingId || '').trim()}:${String(phase || '').trim()}`;
  if (!bookingId || !phase || (await read(LAST_AUTO_OPEN_KEY)) === key) return false;
  if (!(await isAutoNavigationEnabled())) return false;
  await write(LAST_AUTO_OPEN_KEY, key);
  return true;
}
