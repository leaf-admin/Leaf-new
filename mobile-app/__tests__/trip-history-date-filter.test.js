import {
  filterHistoryByStart,
  resolveHistoryFilterStartMs,
} from '../src/screens/prototype/RobotaxiTripHistoryScreen';

jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({
  usePrototypeRideRuntime: jest.fn(() => ({})),
}));

describe('receipts period filter', () => {
  const now = new Date(2026, 9, 13, 15, 30).getTime();

  it('has no start for "all"', () => {
    expect(resolveHistoryFilterStartMs('all', now)).toBeNull();
  });

  it('starts today at local midnight', () => {
    expect(resolveHistoryFilterStartMs('today', now)).toBe(new Date(2026, 9, 13).getTime());
  });

  it('covers seven calendar days including today', () => {
    expect(resolveHistoryFilterStartMs('7d', now)).toBe(new Date(2026, 9, 7).getTime());
  });

  it('keeps only rides inside the period and ignores undated ones', () => {
    const history = [
      { id: 'a', completedAt: new Date(2026, 9, 13, 9).toISOString() },
      { id: 'b', date: new Date(2026, 9, 12, 23).getTime() },
      { id: 'c' },
    ];

    expect(filterHistoryByStart(history, new Date(2026, 9, 13).getTime()).map((item) => item.id)).toEqual(['a']);
    expect(filterHistoryByStart(history, null)).toHaveLength(3);
  });
});
