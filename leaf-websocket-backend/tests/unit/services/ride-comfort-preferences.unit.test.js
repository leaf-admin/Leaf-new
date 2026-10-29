const {
  buildRideComfort,
  sanitizeRidePreferences,
} = require('../../../services/ride-comfort-preferences');

describe('ride-comfort-preferences', () => {
  it('builds the comfort the driver sees, with server-side labels', () => {
    expect(buildRideComfort({ temperature: 'cool', sound: { value: 'quiet', label: 'qualquer texto' } })).toEqual({
      temperature: { value: 'cool', label: 'Ar mais fresco' },
      sound: { value: 'quiet', label: 'Prefere silêncio' },
    });
    expect(buildRideComfort({ temperature: 'mild', sound: 'music' })).toEqual({
      temperature: { value: 'mild', label: 'Ar ameno' },
      sound: { value: 'music', label: 'Pode ter música' },
    });
  });

  it('drops "tanto faz" and unknown values', () => {
    expect(buildRideComfort({ temperature: 'any', sound: 'any' })).toBeNull();
    expect(buildRideComfort({ temperature: 'sauna', sound: '<b>' })).toBeNull();
    expect(buildRideComfort(null)).toBeNull();
  });

  it('keeps the other ride preferences and rewrites only the comfort', () => {
    expect(sanitizeRidePreferences({ femaleDriverOnly: true, comfort: { temperature: 'cool', sound: 'any' } })).toEqual({
      femaleDriverOnly: true,
      comfort: { temperature: { value: 'cool', label: 'Ar mais fresco' } },
    });
    expect(sanitizeRidePreferences({ comfort: { sound: 'x' } })).toEqual({});
    expect(sanitizeRidePreferences(undefined)).toEqual({});
  });
});
