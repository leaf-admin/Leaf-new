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
