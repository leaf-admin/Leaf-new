jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    IN_PROGRESS: 'IN_PROGRESS',
    REASSIGNED_IN_PROGRESS: 'REASSIGNED_IN_PROGRESS'
  },
  getBookingState: jest.fn()
}));

jest.mock('../../../services/event-sourcing', () => ({
  recordEvent: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../commands/ExtendRideCommand', () => {
  return jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: {
        chargeId: 'charge_1',
        diffFare: 11.23,
        newFare: 91.23,
        pixQRCode: 'pix',
        paymentLink: 'https://pay.test',
        brCode: '000201',
        expiresAt: '2026-06-23T23:00:00.000Z'
      }
    })
  }));
});

jest.mock('../../../services/ride-lifecycle-service', () => ({
  parseJsonMaybe: jest.fn((value) => {
    if (!value || typeof value === 'object') return value || null;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }),
  loadBookingContext: jest.fn(),
  persistBookingPatch: jest.fn().mockResolvedValue(undefined),
  appendJsonHistoryField: jest.fn().mockResolvedValue([]),
  buildRideExtensionExpiresAt: jest.fn(() => '2026-06-23T23:00:00.000Z')
}));

jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, fn) => fn())
}));

jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test')
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordCommand: jest.fn()
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

const redisPool = require('../../../utils/redis-pool');
const RideStateManager = require('../../../services/ride-state-manager');
const ExtendRideCommand = require('../../../commands/ExtendRideCommand');
const lifecycleService = require('../../../services/ride-lifecycle-service');
const RespondRideExtensionCommand = require('../../../commands/RespondRideExtensionCommand');

describe('RespondRideExtensionCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisPool.getConnection.mockReturnValue({});
    RideStateManager.getBookingState.mockResolvedValue('IN_PROGRESS');
  });

  function mockBookingContext(activeExtensionRequest) {
    lifecycleService.loadBookingContext.mockResolvedValue({
      bookingHash: {
        customerId: 'customer_1',
        driverId: 'driver_1',
        activeExtensionRequest: JSON.stringify(activeExtensionRequest)
      },
      activeBooking: {
        customerId: 'customer_1',
        driverId: 'driver_1'
      }
    });
  }

  it('rejects driver acceptance for extension requests without backend fare authority', async () => {
    mockBookingContext({
      requestId: 'ext_legacy',
      status: 'DRIVER_DECISION_PENDING',
      requestedBy: 'customer_1',
      newFare: 91.23,
      diffFare: 11.23,
      newEndLocation: { lat: -22.99, lng: -43.31 }
    });

    const command = new RespondRideExtensionCommand({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      accepted: true
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('sem cotação financeira backend');
    expect(ExtendRideCommand).not.toHaveBeenCalled();
    expect(lifecycleService.persistBookingPatch).not.toHaveBeenCalled();
  });

  it('allows driver acceptance for backend-authoritative extension requests', async () => {
    mockBookingContext({
      requestId: 'ext_backend',
      status: 'DRIVER_DECISION_PENDING',
      requestedBy: 'customer_1',
      newFare: 91.23,
      diffFare: 11.23,
      fareAuthority: 'backend_extension_estimate',
      newEndLocation: { lat: -22.99, lng: -43.31 }
    });

    const command = new RespondRideExtensionCommand({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      accepted: true
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(ExtendRideCommand).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking_1',
      customerId: 'customer_1',
      newFare: 91.23
    }));
    expect(lifecycleService.persistBookingPatch).toHaveBeenCalledWith(
      {},
      'booking_1',
      expect.objectContaining({
        extensionChargeId: 'charge_1',
        extensionPaymentStatus: 'pending'
      })
    );
  });
});
