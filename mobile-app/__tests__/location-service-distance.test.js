import { GetDistance } from '../src/services/canonical/locationService';

describe('locationService GetDistance', () => {
  it('returns zero for equal coordinates', () => {
    expect(GetDistance(-22.984, -43.203, -22.984, -43.203)).toBe(0);
  });

  it('keeps the legacy distance calculation in kilometers', () => {
    const copacabanaToLeblon = GetDistance(-22.9711, -43.1822, -22.9837, -43.2232);
    expect(copacabanaToLeblon).toBeCloseTo(4.42, 1);
  });
});
