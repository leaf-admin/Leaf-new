import apiClient from '../src/services/httpClient';
import { fetchDynamicPricingQuote } from '../src/services/runtime/pricingQuoteService';

jest.mock('../src/services/httpClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

function routeNotReadyError() {
  const axiosError = Object.assign(new Error('Request failed with status code 503'), {
    response: { status: 503, data: { code: 'CANONICAL_ROUTE_REQUIRED', retryable: true } },
  });
  return Object.assign(new Error('Erro do servidor'), { originalError: axiosError });
}

describe('pricing quote route-not-ready retry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    apiClient.post.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries when the canonical route is not cached yet and returns the quote', async () => {
    apiClient.post
      .mockRejectedValueOnce(routeNotReadyError())
      .mockResolvedValueOnce({ data: { finalFare: 49.27 } });

    const pending = fetchDynamicPricingQuote({ carType: 'Leaf_Plus' });
    await jest.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toEqual({ finalFare: 49.27 });
    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });

  it('gives up after the bounded retries', async () => {
    apiClient.post.mockRejectedValue(routeNotReadyError());

    const pending = fetchDynamicPricingQuote({});
    const assertion = expect(pending).rejects.toThrow('Erro do servidor');
    await jest.advanceTimersByTimeAsync(600 + 1200);

    await assertion;
    expect(apiClient.post).toHaveBeenCalledTimes(3);
  });

  it('does not retry other failures', async () => {
    const error = Object.assign(new Error('fora da área'), {
      response: { status: 422, data: { code: 'PICKUP_OUTSIDE_REGION' } },
    });
    apiClient.post.mockRejectedValueOnce(error);

    await expect(fetchDynamicPricingQuote({})).rejects.toBe(error);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the request was aborted', async () => {
    const controller = new AbortController();
    apiClient.post.mockRejectedValue(routeNotReadyError());

    const pending = fetchDynamicPricingQuote({}, { signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow('Erro do servidor');
    controller.abort();
    await jest.advanceTimersByTimeAsync(600);

    await assertion;
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });
});
