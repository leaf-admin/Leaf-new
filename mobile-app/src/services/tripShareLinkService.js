import apiClient from './httpClient';

// Link público de acompanhamento (backend: POST /api/rides/:bookingId/share-link).
// O backend reaproveita o mesmo link para a corrida; aqui só evitamos repetir a chamada.

const cache = new Map();

export async function requestTripShareLink(bookingId, { client = apiClient } = {}) {
  const id = String(bookingId || '').trim();
  if (!id) {
    return { ok: false, code: 'NO_ACTIVE_RIDE' };
  }
  if (cache.has(id)) {
    return { ok: true, url: cache.get(id) };
  }
  try {
    const response = await client.post(`/api/rides/${encodeURIComponent(id)}/share-link`, {});
    const url = response?.data?.url;
    if (!url) return { ok: false, code: 'NO_URL' };
    cache.set(id, url);
    return { ok: true, url };
  } catch (error) {
    const code = error?.response?.data?.code || (error?.response?.status === 409 ? 'BOOKING_ENDED' : 'REQUEST_FAILED');
    return { ok: false, code };
  }
}

export function clearTripShareLinkCache() {
  cache.clear();
}
