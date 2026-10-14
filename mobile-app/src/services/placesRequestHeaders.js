import auth from '@react-native-firebase/auth';

// /api/places/* passa a exigir login (PLACES_REQUIRE_AUTH) e limita por usuário.
// O token do Firebase fica em cache no SDK; sem sessão, segue sem ele.
export async function getPlacesRequestHeaders(extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  try {
    const token = await auth().currentUser?.getIdToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch (_error) {
    // Sem token a consulta ainda é atendida enquanto o servidor não exigir login.
  }
  return headers;
}

export default getPlacesRequestHeaders;
