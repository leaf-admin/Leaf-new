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

export async function fetchDynamicPricingQuote(payload = {}, options = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await apiClient.post('/api/pricing/quote', payload, {
        signal: options.signal,
        headers: options.headers
      });

      return response?.data || response;
    } catch (error) {
      const delayMs = ROUTE_NOT_READY_RETRY_DELAYS_MS[attempt];
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
