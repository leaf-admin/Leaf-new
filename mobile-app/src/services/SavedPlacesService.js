import AsyncStorage from '@react-native-async-storage/async-storage';
import authService from './AuthService';

const key = uid => {
  if (!String(uid || '').trim()) throw new Error('Entre na sua conta para salvar um endereço.');
  return `@leaf_saved_places_${uid}`;
};
function validatePlaces(places) {
  if (!Array.isArray(places) || places.some(place => !place || typeof place.id !== 'string' || typeof place.name !== 'string' || !Number.isFinite(place.coordinate?.latitude) || !Number.isFinite(place.coordinate?.longitude) || Math.abs(place.coordinate.latitude) > 90 || Math.abs(place.coordinate.longitude) > 180)) throw new Error('Não foi possível ler seus endereços salvos.');
  return places;
}
async function request(uid, suffix = '', options = {}) {
  key(uid);
  if ((await authService.getCurrentUser())?.uid !== uid) throw new Error('A sessão mudou. Abra novamente seus endereços.');
  const response = await authService.authenticatedRequest(`/account/places${suffix}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw Object.assign(new Error(payload.message || 'Não foi possível sincronizar seus endereços.'), { status: response.status });
  if (payload.uid !== uid || (await authService.getCurrentUser())?.uid !== uid) throw new Error('A sessão mudou. Abra novamente seus endereços.');
  const places = validatePlaces(payload.places);
  await AsyncStorage.setItem(`${key(uid)}_cloud`, JSON.stringify(places));
  return places;
}
async function getLegacyPlaces(uid) {
  const stored = await AsyncStorage.getItem(key(uid));
  return stored ? validatePlaces(JSON.parse(stored)) : [];
}
export async function getLocalSavedPlaces(uid) {
  const legacy = await getLegacyPlaces(uid);
  const stored = await AsyncStorage.getItem(`${key(uid)}_cloud`);
  const cloud = stored ? validatePlaces(JSON.parse(stored)) : [];
  return [...cloud, ...legacy.filter(place => !cloud.some(item => item.id === place.id))];
}
async function acknowledgeLegacy(uid, id) {
  const legacy = await getLegacyPlaces(uid);
  await AsyncStorage.setItem(key(uid), JSON.stringify(legacy.filter(place => place.id !== id)));
}
export async function getSavedPlacesSnapshot(uid) {
  const local = await getLocalSavedPlaces(uid);
  const legacy = await getLegacyPlaces(uid);
  try {
    const remote = await request(uid, '', { method: 'GET' });
    // Preserve old device-only entries until the user explicitly synchronizes them.
    const localOnly = legacy.filter(place => !remote.some(item => item.id === place.id));
    // A confirmed remote copy retires the device-only entry, preventing an old
    // local copy from reappearing after deletion on another device.
    await AsyncStorage.setItem(key(uid), JSON.stringify(localOnly));
    return { places: [...remote, ...localOnly], localOnly, synced: true, error: '' };
  } catch (error) { return { places: local, localOnly: local, synced: false, error: error.status === 404 ? 'Sincronização ainda indisponível. Seus endereços deste aparelho foram preservados.' : 'Sem sincronização. Mostrando os endereços deste aparelho.' }; }
}
export async function getSavedPlaces(uid) { return (await getSavedPlacesSnapshot(uid)).places; }
export async function savePlace(uid, place, label, { id = null } = {}) {
  const latitude = place?.coordinate?.latitude;
  const longitude = place?.coordinate?.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Escolha um endereço com localização confirmada.');
  const name = String(label || place.name || '').trim();
  if (!name || name.length > 80) throw new Error('Dê um nome de até 80 caracteres ao endereço.');
  const saved = { name, address: place.address || place.name || '', coordinate: { latitude, longitude } };
  await request(uid, id ? `/${encodeURIComponent(id)}` : '', { method: id ? 'PATCH' : 'POST', body: JSON.stringify({ place: saved }) });
  await acknowledgeLegacy(uid, id || place?.id || `${latitude},${longitude}`);
  return getLocalSavedPlaces(uid);

}
export async function removeSavedPlace(uid, id) {
  await request(uid, `/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await acknowledgeLegacy(uid, id);
  return getLocalSavedPlaces(uid);
}
export async function syncLocalSavedPlaces(uid) {
  const snapshot = await getSavedPlacesSnapshot(uid);
  if (!snapshot.synced) throw new Error(snapshot.error);
  let places = snapshot.places;
  for (const place of snapshot.localOnly) places = await savePlace(uid, place, place.name);
  return places;
}
