import { resolveDriverFoundChips, resolveSearchFoundSeconds } from '../src/screens/prototype/driverFoundChips';

describe('driver found chips', () => {
  it('celebrates a match found in under 30 seconds and a pickup under 2 minutes', () => {
    expect(resolveDriverFoundChips({ foundSeconds: 12, pickupEtaMinutes: 1 })).toEqual([
      { key: 'fast_match', icon: 'flash', label: 'Encontrado em 12 s' },
      { key: 'quick_pickup', icon: 'walk', label: 'Embarque rápido' },
    ]);
    expect(resolveDriverFoundChips({ foundSeconds: 0 })[0].label).toBe('Encontrado em 1 s');
  });

  it('says nothing when it is not good news or the data is missing', () => {
    expect(resolveDriverFoundChips({ foundSeconds: 30, pickupEtaMinutes: 2 })).toEqual([]);
    expect(resolveDriverFoundChips({ foundSeconds: null, pickupEtaMinutes: null })).toEqual([]);
    expect(resolveDriverFoundChips()).toEqual([]);
  });

  it('measures the search from its start to the moment the card opens', () => {
    const start = Date.parse('2026-10-14T03:30:00.000Z');
    expect(resolveSearchFoundSeconds('2026-10-14T03:30:00.000Z', start + 17400)).toBe(17);
    expect(resolveSearchFoundSeconds(start, start + 5000)).toBe(5);
    expect(resolveSearchFoundSeconds(null, start)).toBeNull();
    expect(resolveSearchFoundSeconds('2026-10-14T03:30:00.000Z', start - 5000)).toBeNull();
  });
});
