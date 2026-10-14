import apiClient from '../httpClient';

// The quote endpoint prices only a route the backend already cached. A quote
// fired right after the destination is chosen can reach the server before that
// route is stored; the server answers 503 CANONICAL_ROUTE_REQUIRED (retryable).
const ROUTE_NOT_READY_RETRY_DELAYS_MS = [600, 1200];

function isCanonicalRouteNotReady(error) {
  const response = error?.response || error?.originalError?.response;
  return response?.status === 503 && response?.data?.code === 'CANONICAL_ROUTE_REQUIRED';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// If the route is still missing after the retries (e.g. the passenger sat on the quote long
// enough for the cached route to expire), `options.refreshRoute` asks for the route again once
// and the quote is retried, instead of leaving the screen on "Tarifa indisponível".
export async function fetchDynamicPricingQuote(payload = {}, options = {}) {
  let routeRefreshed = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await apiClient.post('/api/pricing/quote', payload, {
        signal: options.signal,
        headers: options.headers
      });

      return response?.data || response;
    } catch (error) {
      const delayMs = ROUTE_NOT_READY_RETRY_DELAYS_MS[attempt];
      if (
        delayMs === undefined &&
        !routeRefreshed &&
        typeof options.refreshRoute === 'function' &&
        isCanonicalRouteNotReady(error) &&
        !options.signal?.aborted
      ) {
        routeRefreshed = true;
        await options.refreshRoute();
        attempt = -1;
        continue;
      }
      if (delayMs === undefined || !isCanonicalRouteNotReady(error) || options.signal?.aborted) {
        throw error;
      }
      await wait(delayMs);
      if (options.signal?.aborted) {
        throw error;
      }
    }
  }
}

export default {
  fetchDynamicPricingQuote
};
