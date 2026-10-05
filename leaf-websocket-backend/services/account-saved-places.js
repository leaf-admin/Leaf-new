const MAX_PLACES = 30;
function invalid(message, status = 400, code = 'SAVED_PLACE_INVALID') {
  return Object.assign(new Error(message), { status, code });
}
function validatePlaceId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:,-]{1,160}$/.test(id)) throw invalid('Identificador de endereço inválido.');
  return id;
}
function normalizePlace(input = {}, id = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Informe nome e endereço válidos.');
  const latitude = input.coordinate?.latitude;
  const longitude = input.coordinate?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw invalid('Escolha um endereço com localização confirmada.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const address = typeof input.address === 'string' ? input.address.trim() : '';
  if (!name || name.length > 80 || !address || address.length > 300) throw invalid('Informe nome e endereço válidos.');
  return { id: validatePlaceId(id || `${latitude},${longitude}`), name, address, coordinate: { latitude, longitude }, sourceType: 'saved_place' };
}
function readPlaces(profile = {}) {
  if (!Array.isArray(profile.savedPlaces)) return [];
  return profile.savedPlaces.map(place => normalizePlace(place, place.id));
}
function mutatePlaces(profile, operation, input, id = null) {
  const places = readPlaces(profile);
  if (operation === 'delete') {
    validatePlaceId(id);
    return places.filter(place => place.id !== id);
  }
  if (operation === 'update' && !places.some(place => place.id === id)) throw invalid('Endereço não encontrado.', 404, 'SAVED_PLACE_NOT_FOUND');
  const place = normalizePlace(input, id);
  const existing = places.findIndex(item => item.id === place.id);
  if (existing >= 0) return places.map((item, index) => index === existing ? place : item);
  if (places.length >= MAX_PLACES) throw invalid('Você pode salvar até 30 endereços.', 409, 'SAVED_PLACES_LIMIT');
  return [...places, place];
}
module.exports = { normalizePlace, readPlaces, mutatePlaces, validatePlaceId };
