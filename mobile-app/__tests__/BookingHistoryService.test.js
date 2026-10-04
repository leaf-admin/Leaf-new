jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: jest.fn(() => 'https://api.test/api')
}));

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('../src/utils/axiosInterceptor', () => ({
  createAxiosInstance: jest.fn(() => ({
    get: mockGet,
    post: mockPost
  })),
  setupAxiosInterceptor: jest.fn()
}));

describe('BookingHistoryService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('short-lived activity cache', () => {
    const response = { data: { success: true, receipts: [{ receiptId: 'receipt_cache', rideId: 'ride_cache', grossAmount: 22.4, driverNetAmount: 18.9 }], total: 1, hasMore: false } };

    it('distinguishes a backend lifetime total from a page-length fallback', async () => {
      mockGet.mockResolvedValueOnce({ data: { success: true, receipts: [], hasMore: false } }).mockResolvedValueOnce({ data: { success: true, receipts: [], total: 0, hasMore: false } });
      const service = require('../src/services/BookingHistoryService').default;
      expect((await service.getBookingHistory('u1', 'CUSTOMER')).totalCountKnown).toBe(false);
      expect((await service.getBookingHistory('u2', 'CUSTOMER')).totalCountKnown).toBe(true);
    });

    it('reuses a fresh snapshot and exposes it for immediate screen rendering', async () => {
      mockGet.mockResolvedValue(response);
      const service = require('../src/services/BookingHistoryService').default;
      const result = await service.getBookingHistory('user_cache', 'CUSTOMER', { first: 10 });
      expect(await service.getBookingHistory('user_cache', 'customer', { first: 10, after: null })).toBe(result);
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(service.getCachedBookingHistory('user_cache', 'CUSTOMER', { first: 10 })).toEqual(expect.objectContaining({ result, fresh: true }));
    });

    it('deduplicates concurrent requests including a forced refresh', async () => {
      let finish;
      mockGet.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
      const service = require('../src/services/BookingHistoryService').default;
      const first = service.getBookingHistory('user_cache', 'CUSTOMER');
      const second = service.getBookingHistory('user_cache', 'CUSTOMER', { forceRefresh: true });
      expect(mockGet).toHaveBeenCalledTimes(1);
      finish(response);
      const [a, b] = await Promise.all([first, second]);
      expect(a).toBe(b);
    });

    it('revalidates after 30 seconds while retaining the stale snapshot for at most five minutes', async () => {
      let now = 1000000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      mockGet.mockResolvedValue(response);
      const service = require('../src/services/BookingHistoryService').default;
      await service.getBookingHistory('user_cache', 'CUSTOMER');
      now += 30000;
      expect(service.getCachedBookingHistory('user_cache', 'CUSTOMER').fresh).toBe(false);
      await service.getBookingHistory('user_cache', 'CUSTOMER');
      expect(mockGet).toHaveBeenCalledTimes(2);
      now += 300000;
      expect(service.getCachedBookingHistory('user_cache', 'CUSTOMER')).toBeNull();
    });

    it('isolates user, role, page, filters and receipt revision and allows explicit refresh', async () => {
      mockGet.mockResolvedValue(response);
      const service = require('../src/services/BookingHistoryService').default;
      for (const [uid, role, options] of [
        ['user_cache', 'CUSTOMER', {}], ['another_user', 'CUSTOMER', {}],
        ['user_cache', 'DRIVER', {}], ['user_cache', 'CUSTOMER', { after: '10' }],
        ['user_cache', 'CUSTOMER', { first: 10 }], ['user_cache', 'CUSTOMER', { status: 'COMPLETE' }],
        ['user_cache', 'CUSTOMER', { dateRange: { start: '2026-01-01' } }],
        ['user_cache', 'CUSTOMER', { revision: 'receipt_new' }],
        ['user_cache', 'CUSTOMER', { forceRefresh: true }],
      ]) await service.getBookingHistory(uid, role, options);
      expect(mockGet).toHaveBeenCalledTimes(9);
      expect(mockGet).toHaveBeenLastCalledWith('/receipts/user/user_cache', { params: { role: 'customer', limit: 50, offset: 0 } });
    });

    it('does not cache failures and releases the pending request for retry', async () => {
      mockGet.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(response);
      const service = require('../src/services/BookingHistoryService').default;
      expect((await service.getBookingHistory('user_cache', 'CUSTOMER')).success).toBe(false);
      expect(service.getCachedBookingHistory('user_cache', 'CUSTOMER')).toBeNull();
      expect((await service.getBookingHistory('user_cache', 'CUSTOMER')).success).toBe(true);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('does not turn a provider-declared failure into an empty successful history', async () => {
      mockGet.mockResolvedValueOnce({ data: { success: false, error: 'Histórico indisponível' } });
      const service = require('../src/services/BookingHistoryService').default;
      expect(await service.getBookingHistory('user_cache', 'CUSTOMER')).toEqual({ success: false, error: 'Histórico indisponível' });
      expect(service.getCachedBookingHistory('user_cache', 'CUSTOMER')).toBeNull();
    });

    it('bounds the cache to twenty entries', async () => {
      mockGet.mockResolvedValue(response);
      const service = require('../src/services/BookingHistoryService').default;
      for (let i = 0; i < 21; i += 1) await service.getBookingHistory(`user_${i}`, 'CUSTOMER');
      expect(service.getCachedBookingHistory('user_0', 'CUSTOMER')).toBeNull();
      expect(service.getCachedBookingHistory('user_20', 'CUSTOMER')).not.toBeNull();
    });
  });

  it('maps receipt read-model payloads into booking cards', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        receipts: [
          {
            receiptId: 'receipt_1',
            rideId: 'booking_1',
            date: '2026-04-07T12:00:00.000Z',
            totalAmount: 'R$ 18,90',
            totalAmountValue: 18.9,
            grossAmount: 18.9,
            operationalFee: 2.5,
            paymentIntermediationFee: 0.4,
            tollAmount: 1.2,
            pickup: 'Rua A, 10',
            dropoff: 'Rua B, 20',
            distanceKm: 7.4,
            durationMinutes: 18,
            status: 'completed',
            authoritativeSnapshot: true,
            financialSnapshotSource: 'backend_final'
          }
        ],
        total: 1,
        hasMore: false
      }
    });

    const service = require('../src/services/BookingHistoryService').default;
    const result = await service.getBookingHistory('user_1', 'CUSTOMER', { first: 20 });

    expect(mockGet).toHaveBeenCalledWith('/receipts/user/user_1', {
      params: {
        role: 'customer',
        limit: 20,
        offset: 0
      }
    });
    expect(result.success).toBe(true);
    expect(result.totalCount).toBe(1);
    expect(result.bookings).toEqual([
      expect.objectContaining({
        id: 'booking_1',
        receiptId: 'receipt_1',
        status: 'COMPLETE',
        trip_cost: 18.9,
        estimate: 18.9,
        distance: 7.4,
        duration: 18,
        grossAmount: 18.9,
        operationalFee: 2.5,
        paymentIntermediationFee: 0.4,
        tollAmount: 1.2,
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        pickup: expect.objectContaining({ add: 'Rua A, 10' }),
        drop: expect.objectContaining({ add: 'Rua B, 20' })
      })
    ]);
  });

  it('preserves missing financial amounts as unknown rather than zero', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        receipts: [
          {
            receiptId: 'receipt_incomplete',
            rideId: 'booking_incomplete',
            grossAmount: 25,
            status: 'completed',
            authoritativeSnapshot: true,
            financialSnapshotSource: 'backend_final'
          }
        ],
        total: 1,
        hasMore: false
      }
    });

    const service = require('../src/services/BookingHistoryService').default;
    const result = await service.getBookingHistory('driver_1', 'DRIVER');

    expect(result.bookings[0]).toEqual(expect.objectContaining({
      grossAmount: 25,
      driverNetAmount: null,
      operationalFee: null,
      paymentIntermediationFee: null,
      totalFees: null,
      tollAmount: null,
      trip_cost: 25,
      estimate: 25
    }));
  });

  it('preserves explicit zero financial amounts', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        receipts: [
          {
            receiptId: 'receipt_zero',
            rideId: 'booking_zero',
            grossAmount: 'R$ 25,00',
            driverNetAmount: 'R$ 0,00',
            operationalFee: 0,
            paymentIntermediationFee: 0,
            totalFees: 0,
            tollAmount: 0,
            status: 'completed'
          }
        ],
        total: 1,
        hasMore: false
      }
    });

    const service = require('../src/services/BookingHistoryService').default;
    const result = await service.getBookingHistory('driver_1', 'DRIVER');

    expect(result.bookings[0]).toEqual(expect.objectContaining({
      grossAmount: 25,
      driverNetAmount: 0,
      operationalFee: 0,
      paymentIntermediationFee: 0,
      totalFees: 0,
      tollAmount: 0
    }));
  });

  it('applies client-side status and date filters on top of the REST read-model', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        receipts: [
          {
            receiptId: 'receipt_1',
            rideId: 'booking_1',
            date: '2026-04-01T12:00:00.000Z',
            totalAmountValue: 10,
            pickup: 'Origem 1',
            dropoff: 'Destino 1',
            status: 'completed'
          },
          {
            receiptId: 'receipt_2',
            rideId: 'booking_2',
            date: '2026-04-06T12:00:00.000Z',
            totalAmountValue: 12,
            pickup: 'Origem 2',
            dropoff: 'Destino 2',
            status: 'cancelled'
          }
        ],
        total: 2,
        hasMore: true,
        nextOffset: 12
      }
    });

    const service = require('../src/services/BookingHistoryService').default;
    const result = await service.getBookingHistory('driver_1', 'DRIVER', {
      first: 50,
      after: '10',
      status: 'CANCELLED',
      dateRange: {
        start: '2026-04-05T00:00:00.000Z',
        end: '2026-04-07T00:00:00.000Z'
      }
    });

    expect(mockGet).toHaveBeenCalledWith('/receipts/user/driver_1', {
      params: {
        role: 'driver',
        limit: 50,
        offset: 10
      }
    });
    expect(result.success).toBe(true);
    expect(result.pageInfo).toEqual({
      hasNextPage: true,
      hasPreviousPage: true,
      startCursor: '10',
      endCursor: '12'
    });
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]).toEqual(
      expect.objectContaining({
        id: 'booking_2',
        status: 'CANCELLED'
      })
    );
  });
});
