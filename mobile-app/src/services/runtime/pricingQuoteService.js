import apiClient from '../httpClient';

export async function fetchDynamicPricingQuote(payload = {}, options = {}) {
  const response = await apiClient.post('/api/pricing/quote', payload, {
    signal: options.signal
  });

  return response?.data || response;
}

export default {
  fetchDynamicPricingQuote
};
