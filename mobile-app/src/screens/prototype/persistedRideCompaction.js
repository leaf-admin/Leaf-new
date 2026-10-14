// Rotas no disco ficam simplificadas: cada corrida do histórico guardava a rota inteira (~30 KB)
// e a sessão inteira (~500 KB) era serializada a cada gravação. Na memória a rota segue completa;
// no disco, até 120 pontos com ~1 m de precisão, o bastante para desenhar a rota no recibo.
const PERSISTED_ROUTE_MAX_POINTS = 120;

export function compactPersistedRoute(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length <= PERSISTED_ROUTE_MAX_POINTS) {
    return coordinates;
  }
  const step = (coordinates.length - 1) / (PERSISTED_ROUTE_MAX_POINTS - 1);
  const out = [];
  for (let i = 0; i < PERSISTED_ROUTE_MAX_POINTS; i += 1) {
    const point = coordinates[Math.round(i * step)];
    if (!point) continue;
    const latitude = Number(point.latitude ?? point.lat);
    const longitude = Number(point.longitude ?? point.lng);
    out.push(Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude: Math.round(latitude * 1e5) / 1e5, longitude: Math.round(longitude * 1e5) / 1e5 }
      : point);
  }
  return out;
}

export function compactPersistedRideRecord(record) {
  if (!record || typeof record !== "object" || !Array.isArray(record.routeCoordinates)) {
    return record;
  }
  return { ...record, routeCoordinates: compactPersistedRoute(record.routeCoordinates) };
}
