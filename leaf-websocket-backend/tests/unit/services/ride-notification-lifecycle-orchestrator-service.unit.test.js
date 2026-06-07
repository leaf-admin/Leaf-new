const rideNotificationLifecycleOrchestrator = require('../../../services/ride-notification-lifecycle-orchestrator-service');

describe('ride-notification-lifecycle-orchestrator-service', () => {
  function createFcmMock(overrides = {}) {
    return {
      setRedis: jest.fn(),
      initialize: jest.fn().mockResolvedValue(undefined),
      isServiceAvailable: jest.fn(() => true),
      sendRideStatusUpdate: jest.fn().mockResolvedValue({ success: true, count: 1 }),
      ...overrides
    };
  }

  it('builds a complete accepted ride payload from existing booking data', () => {
    const payload = rideNotificationLifecycleOrchestrator.buildRideStatusPayload({
      bookingId: 'booking-1',
      status: 'accepted',
      bookingData: {
        pickupLocation: JSON.stringify({ address: 'Rua das Palmeiras, 10', lat: -22.9, lng: -43.2 }),
        destinationLocation: JSON.stringify({ address: 'Leblon', lat: -22.98, lng: -43.22 }),
        estimatedArrivalToPickupMin: '4',
        tripEstimatedTime: '18',
        estimatedFare: '35.28',
        driverName: 'Carlos Motorista',
        customerName: 'Leaf Passageiro',
        vehicleModel: 'Toyota Prius',
        vehiclePlate: 'TES8888'
      }
    });

    expect(payload).toEqual(expect.objectContaining({
      bookingId: 'booking-1',
      status: 'accepted',
      estimatedTime: '4',
      pickupEstimatedTime: '4',
      tripEstimatedTime: '18',
      fare: '35.28',
      driverName: 'Carlos Motorista',
      customerName: 'Leaf Passageiro',
      vehicleModel: 'Toyota Prius',
      vehiclePlate: 'TES8888'
    }));
    expect(payload.pickup).toEqual(expect.objectContaining({ address: 'Rua das Palmeiras, 10' }));
    expect(payload.destination).toEqual(expect.objectContaining({ address: 'Leblon' }));
  });

  it('dispatches persistent ride status updates to passenger and driver without external API calls', async () => {
    const fcmService = createFcmMock();
    const redis = { status: 'ready' };

    const result = await rideNotificationLifecycleOrchestrator.dispatchRideStatusUpdate({
      fcmService,
      redis,
      bookingId: 'booking-1',
      status: 'started',
      passengerId: 'customer-1',
      driverId: 'driver-1',
      bookingData: {
        pickupLocation: { address: 'Copacabana' },
        destinationLocation: { address: 'Leblon' },
        tripEstimatedTime: 12,
        estimatedFare: 42,
        driverName: 'Carlos',
        customerName: 'Izaak',
        vehicleModel: 'Toyota Prius',
        vehiclePlate: 'TES8888'
      }
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      status: 'sent',
      bookingId: 'booking-1',
      rideStatus: 'started'
    }));
    expect(fcmService.setRedis).toHaveBeenCalledWith(redis);
    expect(fcmService.sendRideStatusUpdate).toHaveBeenCalledTimes(2);
    expect(fcmService.sendRideStatusUpdate).toHaveBeenNthCalledWith(1, 'customer-1', expect.objectContaining({
      bookingId: 'booking-1',
      status: 'started',
      userType: 'customer',
      driverName: 'Carlos',
      vehicleModel: 'Toyota Prius',
      vehiclePlate: 'TES8888'
    }));
    expect(fcmService.sendRideStatusUpdate).toHaveBeenNthCalledWith(2, 'driver-1', expect.objectContaining({
      bookingId: 'booking-1',
      status: 'started',
      userType: 'driver',
      customerName: 'Izaak'
    }));
  });

  it('fails closed when FCM is unavailable without throwing into ride lifecycle', async () => {
    const fcmService = createFcmMock({
      isServiceAvailable: jest.fn(() => false),
      initialize: jest.fn().mockResolvedValue(undefined)
    });

    const result = await rideNotificationLifecycleOrchestrator.dispatchRideStatusUpdate({
      fcmService,
      bookingId: 'booking-1',
      status: 'cancelled',
      passengerId: 'customer-1',
      bookingData: {}
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      status: 'skipped',
      reason: 'fcm_unavailable',
      rideStatus: 'canceled'
    }));
    expect(fcmService.sendRideStatusUpdate).not.toHaveBeenCalled();
  });
});
