import {
  buildHistoryStatement,
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

  it('starts the month tab on the first day of the current month', () => {
    expect(resolveHistoryFilterStartMs('month', now)).toBe(new Date(2026, 9, 1).getTime());
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

describe('activity statement', () => {
  const trips = [
    { id: 'a', status: 'COMPLETE', grossAmount: 46.8, driverNetAmount: 39.5, totalFees: 7.3, tollAmount: 6.2, distanceKm: 18.4 },
    { id: 'b', status: 'COMPLETE', grossAmount: 19.9, driverNetAmount: 17.9, totalFees: 2, distanceKm: 6 },
    { id: 'c', status: 'CANCELLED', grossAmount: 0, driverNetAmount: 0, totalFees: 0 },
  ];

  it('gives the passenger the gross total with trips, distance and tolls', () => {
    const statement = buildHistoryStatement(trips, false);
    expect(statement.amount).toBe(66.7);
    expect(statement.lines).toEqual([
      { key: 'rides', label: 'Viagens', value: '2' },
      { key: 'distance', label: 'Distância', value: '24 km' },
      { key: 'toll', label: 'Pedágios', value: 'R$ 6,20' },
    ]);
  });

  it('gives the driver the net total with rides, tolls and fees', () => {
    const statement = buildHistoryStatement(trips, true);
    expect(statement.amount).toBe(57.4);
    expect(statement.lines).toEqual([
      { key: 'rides', label: 'Corridas', value: '2' },
      { key: 'toll', label: 'Pedágios', value: 'R$ 6,20' },
      { key: 'fees', label: 'Taxas', value: '− R$ 9,30' },
    ]);
  });

  it('shows no total when a trip has no known amount', () => {
    expect(buildHistoryStatement([...trips, { id: 'd', status: 'COMPLETE' }], false).amount).toBeNull();
  });
});
