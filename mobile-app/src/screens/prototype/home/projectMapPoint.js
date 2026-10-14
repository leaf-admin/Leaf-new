// Ponto na tela de uma coordenada, a partir da região visível do mapa (mapa em tela
// cheia, sem rotação nem inclinação). Feito em JS: chamar o pointForCoordinate nativo
// enquanto o mapa era recriado derrubava o app no iPhone ("expecting AIRMap, got: null").

function mercatorY(latitude) {
  const radians = (Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

export function projectMapPoint(region, coordinate, width, height) {
  const values = [
    region?.latitude, region?.longitude, region?.latitudeDelta, region?.longitudeDelta,
    coordinate?.latitude, coordinate?.longitude, width, height,
  ].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [lat, lng, latDelta, lngDelta, pointLat, pointLng, w, h] = values;
  if (latDelta <= 0 || lngDelta <= 0 || w <= 0 || h <= 0) return null;

  const north = mercatorY(lat + latDelta / 2);
  const south = mercatorY(lat - latDelta / 2);
  if (north === south) return null;
  return {
    x: ((pointLng - (lng - lngDelta / 2)) / lngDelta) * w,
    y: ((north - mercatorY(pointLat)) / (north - south)) * h,
  };
}
