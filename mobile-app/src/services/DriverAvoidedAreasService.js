import auth from '@react-native-firebase/auth';
import { getSelfHostedApiUrl } from '../config/ApiConfig';

const REQUEST_TIMEOUT_MS = 10000;

async function request(method, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const user = auth().currentUser;
    const token = user ? await user.getIdToken() : null;
    if (!token) {
      return { success: false, code: 'AUTH_REQUIRED' };
    }
    const response = await fetch(getSelfHostedApiUrl('/api/drivers/me/avoided-areas'), {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) {
      return {
        success: false,
        code: payload?.code || `HTTP_${response.status}`,
        error: payload?.error || '',
      };
    }
    return payload;
  } catch (error) {
    return { success: false, code: 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timeoutId);
  }
}

// O servidor calcula as células e devolve o contorno de cada área; o app só envia
// centro e tamanho.
export function fetchDriverAvoidedAreas() {
  return request('GET');
}

export function saveDriverAvoidedAreas(areas = []) {
  return request('PUT', {
    areas: areas.map((area) => ({
      id: area.id,
      label: area.label,
      center: area.center,
      ringSize: area.ringSize,
    })),
  });
}
