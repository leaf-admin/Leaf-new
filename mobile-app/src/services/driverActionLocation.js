import * as Location from 'expo-location';

// Posição mandada junto com Cheguei, Iniciar e Encerrar quando a ação vem da
// notificação ou do balão. O servidor valida a chegada por ela. A sessão do assistente
// podia ter ficado com a posição do aceite (a sincronização em primeiro plano a
// reaproveitava), e o servidor recusava: "Aproxime-se do embarque… 680 m" com o carro
// parado na porta (QA, 2026-10-20). A última leitura do aparelho é a fonte certa.
const FRESH_FIX_MAX_AGE_MS = 30000;

function toCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

export async function resolveDriverActionLocation(
  context = null,
  { getLastKnownPosition = Location.getLastKnownPositionAsync, now = Date.now() } = {},
) {
  try {
    const fix = await getLastKnownPosition({ maxAge: FRESH_FIX_MAX_AGE_MS });
    const coordinate = toCoordinate(fix?.coords);
    const at = Number(fix?.timestamp);
    if (coordinate && (!Number.isFinite(at) || now - at <= FRESH_FIX_MAX_AGE_MS)) {
      return coordinate;
    }
  } catch (_error) {
    // sem leitura recente: segue com a sessão
  }
  return toCoordinate(context?.lastDriverLocation) || toCoordinate(context?.currentDriverLocation);
}
