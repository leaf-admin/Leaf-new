import {
  checkServiceAreaCoverage,
  coverageCacheKey,
  interpretCoverageResponse,
  resetServiceAreaCoverageCache,
} from '../src/services/serviceAreaCoverage';

jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: (path) => `https://api.test${path}`,
}));

const copacabana = { latitude: -22.9711, longitude: -43.1823 };

function jsonResponse(payload) {
  return { json: async () => payload };
}

describe('service area coverage', () => {
  beforeEach(() => resetServiceAreaCoverageCache());

  it('rounds the coordinate to about 100 m and ignores invalid points', () => {
    expect(coverageCacheKey(copacabana)).toBe('-22.971,-43.182');
    expect(coverageCacheKey({ latitude: -22.97114, longitude: -43.18234 })).toBe('-22.971,-43.182');
    expect(coverageCacheKey({ latitude: NaN, longitude: 1 })).toBeNull();
    expect(coverageCacheKey(null)).toBeNull();
  });

  it('only reports outside for an explicit outside answer', () => {
    expect(interpretCoverageResponse({ success: true, isAllowed: true, code: 'GEOFENCE_ALLOWED' })).toBe('inside');
    expect(interpretCoverageResponse({ success: true, isAllowed: false, code: 'GEOFENCE_OUTSIDE_REGION' })).toBe('outside');
    // Geofence indisponível ou desligada: não é "fora da área".
    expect(interpretCoverageResponse({ success: false, isAllowed: false, code: 'GEOFENCE_DISABLED' })).toBeNull();
    expect(interpretCoverageResponse(null)).toBeNull();
  });

  it('asks the Leaf polygon once per spot and caches the answer', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ success: true, isAllowed: false, code: 'GEOFENCE_OUTSIDE_REGION' }));

    expect(await checkServiceAreaCoverage(copacabana, { fetchImpl })).toBe('outside');
    expect(await checkServiceAreaCoverage({ latitude: -22.97112, longitude: -43.18231 }, { fetchImpl })).toBe('outside');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.test/api/geofence/check?lat=-22.9711&lng=-43.1823');
  });

  it('fails open on network errors', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('offline'); });
    expect(await checkServiceAreaCoverage(copacabana, { fetchImpl })).toBeNull();
  });
});
