import {
  PROTOTYPE_TRAFFIC_SEGMENT_COLORS,
  resolveTrafficBaseDurationSecs,
  resolveTrafficSegmentLevel,
} from '../src/screens/prototype/prototypeTrafficRoute';

describe('prototypeTrafficRoute', () => {
  it('uses the non-traffic duration as the visual congestion baseline', () => {
    const leg = {
      time_in_secs: 600,
      duration_without_traffic: 420,
      duration_in_traffic: 600,
    };

    expect(resolveTrafficBaseDurationSecs(leg)).toBe(420);
    expect(resolveTrafficSegmentLevel(
      resolveTrafficBaseDurationSecs(leg),
      leg.duration_in_traffic,
    )).toBe('heavy');
  });

  it.each([
    [420, 460, 'normal'],
    [420, 483, 'moderate'],
    [420, 567, 'heavy'],
  ])('classifies base=%s traffic=%s as %s', (baseDuration, trafficDuration, expected) => {
    expect(resolveTrafficSegmentLevel(baseDuration, trafficDuration)).toBe(expected);
  });

  it('exposes stable route colors for each traffic level', () => {
    expect(PROTOTYPE_TRAFFIC_SEGMENT_COLORS).toEqual({
      normal: '#198754',
      moderate: '#F59E0B',
      heavy: '#DC2626',
    });
  });
});
