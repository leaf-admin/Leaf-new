import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

const NAVIGATION_PROMPT_DEDUPE_MS = 1500;
let activeNavigationPromptKey = '';
let lastNavigationPromptKey = '';
let lastNavigationPromptAt = 0;

function isCoordinateValid(coordinate) {
  return Boolean(
    coordinate &&
      Number.isFinite(Number(coordinate.latitude ?? coordinate.lat)) &&
      Number.isFinite(Number(coordinate.longitude ?? coordinate.lng))
  );
}

function normalizeCoordinate(coordinate) {
  return {
    latitude: Number(coordinate.latitude ?? coordinate.lat),
    longitude: Number(coordinate.longitude ?? coordinate.lng)
  };
}

async function safeCanOpenURL(url) {
  try {
    return await Linking.canOpenURL(url);
  } catch (_error) {
    return false;
  }
}

function buildNavigationPromptKey({ coordinate, phase }) {
  const normalized = normalizeCoordinate(coordinate);
  return [
    String(phase || 'pickup').trim().toLowerCase(),
    normalized.latitude.toFixed(6),
    normalized.longitude.toFixed(6)
  ].join(':');
}

function shouldSkipDuplicatedPrompt(promptKey) {
  const now = Date.now();

  if (activeNavigationPromptKey && activeNavigationPromptKey === promptKey) {
    return true;
  }

  if (
    lastNavigationPromptKey === promptKey &&
    now - lastNavigationPromptAt <= NAVIGATION_PROMPT_DEDUPE_MS
  ) {
    return true;
  }

  return false;
}

function beginNavigationPrompt(promptKey) {
  activeNavigationPromptKey = promptKey;
}

function finishNavigationPrompt(promptKey) {
  activeNavigationPromptKey = '';
  lastNavigationPromptKey = promptKey;
  lastNavigationPromptAt = Date.now();
}

export async function openDriverExternalNavigation({
  coordinate,
  destinationLabel = '',
  phase = 'pickup'
}) {
  if (!isCoordinateValid(coordinate)) {
    throw new Error('Destino de navegação indisponível.');
  }

  const { latitude, longitude } = normalizeCoordinate(coordinate);
  const googleAppUrl = `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`;
  const googleWebUrl = `https://maps.google.com/?daddr=${latitude},${longitude}&directionsmode=driving`;
  const wazeAppUrl = `waze://?ll=${latitude},${longitude}&navigate=yes`;
  const wazeWebUrl = `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;
  const appleMapsUrl = `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d`;

  const openGoogleMaps = async () => {
    const canOpenNative = await safeCanOpenURL(googleAppUrl);
    await Linking.openURL(canOpenNative ? googleAppUrl : googleWebUrl);
    return 'google_maps';
  };

  const openAppleMaps = async () => {
    await Linking.openURL(appleMapsUrl);
    return 'apple_maps';
  };

  const openWaze = async () => {
    const canOpenNative = await safeCanOpenURL(wazeAppUrl);
    await Linking.openURL(canOpenNative ? wazeAppUrl : wazeWebUrl);
    return 'waze';
  };

  const phaseLabel = phase === 'destination' ? 'destino' : 'embarque';
  const targetLabel = String(destinationLabel || '').trim() || (phase === 'destination' ? 'Destino' : 'Local de embarque');
  const promptKey = buildNavigationPromptKey({ coordinate, phase });

  if (shouldSkipDuplicatedPrompt(promptKey)) {
    return null;
  }

  if (Platform.OS === 'ios') {
    return new Promise((resolve, reject) => {
      beginNavigationPrompt(promptKey);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancelar', 'Mapas da Apple', 'Google Maps', 'Waze'],
          cancelButtonIndex: 0,
          title: `Abrir rota para ${phaseLabel}`,
          message: targetLabel
        },
        async selectedIndex => {
          try {
            if (selectedIndex === 1) {
              resolve(await openAppleMaps());
              return;
            }
            if (selectedIndex === 2) {
              resolve(await openGoogleMaps());
              return;
            }
            if (selectedIndex === 3) {
              resolve(await openWaze());
              return;
            }
            resolve(null);
          } catch (error) {
            reject(error);
          } finally {
            finishNavigationPrompt(promptKey);
          }
        }
      );
    });
  }

  return new Promise(resolve => {
    beginNavigationPrompt(promptKey);
    Alert.alert(`Abrir rota para ${phaseLabel}`, targetLabel, [
      {
        text: 'Cancelar',
        style: 'cancel',
        onPress: () => {
          finishNavigationPrompt(promptKey);
          resolve(null);
        }
      },
      {
        text: 'Google Maps',
        onPress: () => {
          openGoogleMaps()
            .then(resolve)
            .catch(() => resolve(null))
            .finally(() => finishNavigationPrompt(promptKey));
        }
      },
      {
        text: 'Waze',
        onPress: () => {
          openWaze()
            .then(resolve)
            .catch(() => resolve(null))
            .finally(() => finishNavigationPrompt(promptKey));
        }
      }
    ]);
  });
}

export default {
  openDriverExternalNavigation
};
