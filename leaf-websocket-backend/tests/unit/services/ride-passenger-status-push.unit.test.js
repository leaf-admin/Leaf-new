jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logStructured: jest.fn()
}));

const {
  buildDriverArrivedPush,
  buildPassengerStatusPayload,
  notifyPassengerRideStatus
} = require('../../../services/ride-passenger-status-push');

const BOOKING = {
  driverName: 'Ana',
  vehicleModel: 'Onix',
  vehiclePlate: 'ABC1D23',
  pickupLocation: JSON.stringify({ address: 'R. das Pastorinhas, 4', lat: -22.92, lng: -43.4 }),
  destinationLocation: { add: 'Via Parque Shopping' },
  estimatedFare: '42.90'
};

describe('passenger ride status push', () => {
  it('tells the passenger who arrived and in which car', () => {
    expect(buildDriverArrivedPush({ bookingId: 'b1', bookingData: BOOKING })).toEqual({
      title: 'Seu motorista chegou',
      body: 'Ana está no local de embarque · Onix · ABC1D23',
      collapseKey: 'leaf-ride-arrived-b1',
      data: { type: 'driver_arrived', bookingId: 'b1', screen: 'RobotaxiPrototype' }
    });
    expect(buildDriverArrivedPush({ bookingId: 'b1', bookingData: {} }).body).toBe(
      'Seu motorista está no local de embarque.'
    );
  });

  it('builds the status payload from the stored booking, whatever shape the addresses have', () => {
    expect(buildPassengerStatusPayload({ bookingId: 'b1', status: 'started', bookingData: BOOKING })).toMatchObject({
      bookingId: 'b1',
      status: 'started',
      userType: 'customer',
      driverName: 'Ana',
      pickup: { address: 'R. das Pastorinhas, 4' },
      destination: { address: 'Via Parque Shopping' },
      fare: '42.90'
    });
    expect(buildPassengerStatusPayload({ bookingId: 'b1', status: 'arrived', bookingData: { pickupLocation: '{broken' } }).pickup)
      .toEqual({ address: '' });
  });

  it('on arrival updates the ride status and sends the visible notice', async () => {
    const fcmService = {
      sendRideStatusUpdate: jest.fn().mockResolvedValue({ success: true }),
      sendNotificationToUser: jest.fn().mockResolvedValue({ success: true })
    };

    const result = await notifyPassengerRideStatus({
      fcmService,
      customerId: 'customer-1',
      bookingId: 'b1',
      status: 'arrived',
      bookingData: BOOKING
    });

    expect(result.success).toBe(true);
    expect(fcmService.sendRideStatusUpdate).toHaveBeenCalledWith('customer-1', expect.objectContaining({ status: 'arrived' }));
    expect(fcmService.sendNotificationToUser).toHaveBeenCalledWith(
      'customer-1',
      expect.objectContaining({ title: 'Seu motorista chegou' })
    );
  });

  it('on trip start only updates the status', async () => {
    const fcmService = {
      sendRideStatusUpdate: jest.fn().mockResolvedValue({ success: true }),
      sendNotificationToUser: jest.fn()
    };

    await notifyPassengerRideStatus({ fcmService, customerId: 'customer-1', bookingId: 'b1', status: 'started', bookingData: BOOKING });

    expect(fcmService.sendRideStatusUpdate).toHaveBeenCalledTimes(1);
    expect(fcmService.sendNotificationToUser).not.toHaveBeenCalled();
  });

  it('never throws into the ride flow', async () => {
    const fcmService = { sendRideStatusUpdate: jest.fn().mockRejectedValue(new Error('down')) };

    await expect(
      notifyPassengerRideStatus({ fcmService, customerId: 'customer-1', bookingId: 'b1', status: 'arrived' })
    ).resolves.toEqual({ success: false, error: 'down' });
    await expect(notifyPassengerRideStatus({ fcmService, bookingId: 'b1', status: 'arrived' })).resolves.toEqual({
      success: false,
      skipped: true
    });
  });
});
