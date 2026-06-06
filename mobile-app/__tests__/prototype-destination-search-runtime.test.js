import {
  buildRuntimeDestinationSearchCacheKey,
  getCachedRuntimeDestinationSearchResults,
  getRuntimeDestinationSearchSessionToken,
  normalizeDestinationItem,
  parseAddressFromDescription,
  parseNameFromDescription,
  resetRuntimeDestinationSearchSession,
  setCachedRuntimeDestinationSearchResults,
} from '../src/screens/prototype/prototypeDestinationSearchRuntime';

describe('prototype destination search runtime helpers', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetRuntimeDestinationSearchSession();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('splits place descriptions into name and address', () => {
    expect(parseNameFromDescription('Barra Shopping - Avenida das Americas, 4666')).toBe('Barra Shopping');
    expect(parseAddressFromDescription('Barra Shopping - Avenida das Americas, 4666')).toBe('Avenida das Americas, 4666');
    expect(parseNameFromDescription('Leblon, Rio de Janeiro')).toBe('Leblon');
    expect(parseAddressFromDescription('Leblon, Rio de Janeiro')).toBe('Rio de Janeiro');
  });

  it('normalizes destination payloads without leaking invalid coordinates', () => {
    expect(normalizeDestinationItem({
      description: 'Barra Shopping - Avenida das Americas, 4666',
      lat: -22.999,
      lng: -43.365,
      place_id: 'place_1',
      sessionToken: 'session_1',
    })).toEqual(expect.objectContaining({
      id: 'place_1',
      name: 'Barra Shopping',
      address: 'Avenida das Americas, 4666',
      place_id: 'place_1',
      searchSessionToken: 'session_1',
      coordinate: {
        latitude: -22.999,
        longitude: -43.365,
      },
    }));

    expect(normalizeDestinationItem({
      name: 'Destino sem coordenada',
      coordinate: { latitude: 'n/a', longitude: -43.1 },
    }).coordinate).toBeNull();
  });

  it('keeps a stable search session token during the idle window', () => {
    let now = Date.parse('2026-06-06T12:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const first = getRuntimeDestinationSearchSessionToken();
    now += 30000;
    const second = getRuntimeDestinationSearchSessionToken();
    now += 46000;
    const third = getRuntimeDestinationSearchSessionToken();

    expect(first).toBe(second);
    expect(third).toMatch(/^proto-/);
    expect(third).not.toBe(first);
  });

  it('caches search results by normalized query and coarse location for a short window', () => {
    let now = Date.parse('2026-06-06T12:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const location = { lat: -22.98391, lng: -43.21788 };
    const results = [{ id: '1', name: 'Leblon' }];

    expect(buildRuntimeDestinationSearchCacheKey(' Leblon ', location)).toBe('leblon:-22.984:-43.218');
    expect(getCachedRuntimeDestinationSearchResults({ query: 'Leblon', location })).toBeNull();

    setCachedRuntimeDestinationSearchResults({ query: 'Leblon', location, results });
    const cached = getCachedRuntimeDestinationSearchResults({ query: 'leblon', location });
    expect(cached).toEqual(results);
    expect(cached).not.toBe(results);

    now += 16000;
    expect(getCachedRuntimeDestinationSearchResults({ query: 'Leblon', location })).toBeNull();
  });
});
