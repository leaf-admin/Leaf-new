jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logStructured: jest.fn()
}));

const {
  buildDriverArrivedPush,
  buildPassengerStatusPayload,
  buildRideAcceptedPush,
  buildRideCancelledPush,
  buildTripCompletedPush,
  buildTripStartedPush,
  formatBoardingDeadline,
  loadAcceptedBookingData,
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
      data: { type: 'driver_arrived', bookingId: 'b1', screen: 'RobotaxiPrototypeTrip' }
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

  it('on trip start updates the status and shows the visible notice', async () => {
    const fcmService = {
      sendRideStatusUpdate: jest.fn().mockResolvedValue({ success: true }),
      sendNotificationToUser: jest.fn().mockResolvedValue({ success: true })
    };

    await notifyPassengerRideStatus({ fcmService, customerId: 'customer-1', bookingId: 'b1', status: 'started', bookingData: BOOKING });

    expect(fcmService.sendRideStatusUpdate).toHaveBeenCalledTimes(1);
    expect(fcmService.sendNotificationToUser).toHaveBeenCalledWith(
      'customer-1',
      expect.objectContaining({ title: 'Viagem iniciada', body: 'A caminho de Via Parque Shopping' })
    );
  });

  it('on completion sends only the visible notice when the handler already sent the silent push', async () => {
    const fcmService = {
      sendRideStatusUpdate: jest.fn(),
      sendNotificationToUser: jest.fn().mockResolvedValue({ success: true })
    };

    await notifyPassengerRideStatus({
      fcmService,
      customerId: 'customer-1',
      bookingId: 'b1',
      status: 'completed',
      sendStatusUpdate: false
    });

    expect(fcmService.sendRideStatusUpdate).not.toHaveBeenCalled();
    expect(fcmService.sendNotificationToUser).toHaveBeenCalledWith(
      'customer-1',
      expect.objectContaining({ title: 'Você chegou ao destino', body: 'Obrigado por viajar com a Leaf.' })
    );
  });

  it('on cancellation sends the cancelled notice', async () => {
    const fcmService = {
      sendRideStatusUpdate: jest.fn(),
      sendNotificationToUser: jest.fn().mockResolvedValue({ success: true })
    };

    await notifyPassengerRideStatus({
      fcmService,
      customerId: 'customer-1',
      bookingId: 'b1',
      status: 'cancelled',
      sendStatusUpdate: false
    });

    expect(fcmService.sendNotificationToUser).toHaveBeenCalledWith(
      'customer-1',
      expect.objectContaining({ title: 'Corrida cancelada', body: 'Veja os detalhes no app.' })
    );
  });

  it('a failing visible notice never breaks the status flow', async () => {
    const fcmService = {
      sendRideStatusUpdate: jest.fn().mockResolvedValue({ success: true }),
      sendNotificationToUser: jest.fn().mockRejectedValue(new Error('fcm down'))
    };

    await expect(
      notifyPassengerRideStatus({ fcmService, customerId: 'customer-1', bookingId: 'b1', status: 'started', bookingData: BOOKING })
    ).resolves.toMatchObject({ success: true, alert: null });
    expect(fcmService.sendRideStatusUpdate).toHaveBeenCalledTimes(1);
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

describe('passenger visible notices per ride state', () => {
  it('accepted: names the driver, car, plate and ETA, opening the trip screen', () => {
    expect(
      buildRideAcceptedPush({
        bookingId: 'b1',
        driverId: 'd1',
        bookingData: {
          driverName: 'Ana Lima',
          vehicleModel: 'Onix',
          vehicleColor: 'prata',
          vehiclePlate: 'ABC1D23',
          estimatedArrivalToPickupMin: '3.6'
        }
      })
    ).toEqual({
      title: 'Ana está a caminho',
      body: 'Onix prata · ABC1D23 · chega em ~4 min',
      collapseKey: 'leaf-ride-accepted-b1',
      data: { type: 'RIDE_ACCEPTED', bookingId: 'b1', driverId: 'd1', screen: 'RobotaxiPrototypeTrip' }
    });
  });

  it('accepted: drops the parts that are missing and falls back when there is nothing', () => {
    expect(buildRideAcceptedPush({ bookingId: 'b1', bookingData: { driverName: 'Ana', estimatedArrivalToPickupMin: '0' } }))
      .toMatchObject({ title: 'Ana está a caminho', body: 'Um motorista aceitou sua corrida.' });
    expect(buildRideAcceptedPush({ bookingId: 'b1', bookingData: { vehiclePlate: 'ABC1D23' } }))
      .toMatchObject({ title: 'Motorista a caminho', body: 'ABC1D23' });
    expect(buildRideAcceptedPush({ bookingId: 'b1', bookingData: {} }))
      .toMatchObject({ title: 'Motorista a caminho', body: 'Um motorista aceitou sua corrida.' });
  });

  it('arrived: adds the boarding deadline in Brasilia time', () => {
    expect(buildDriverArrivedPush({
      bookingId: 'b1',
      bookingData: { ...BOOKING, boardingDeadlineAt: '2026-10-22T17:05:00.000Z' }
    }).body).toBe('Ana está no local de embarque · Onix · ABC1D23 · Embarque até 14:05');
  });

  it('formats the boarding deadline in America/Sao_Paulo and ignores invalid dates', () => {
    expect(formatBoardingDeadline('2026-10-22T17:05:00.000Z')).toBe('14:05');
    expect(formatBoardingDeadline('2026-10-22T02:30:00.000Z')).toBe('23:30');
    expect(formatBoardingDeadline('not-a-date')).toBe('');
    expect(formatBoardingDeadline(undefined)).toBe('');
  });

  it('started: shows the short destination name', () => {
    expect(buildTripStartedPush({
      bookingId: 'b1',
      bookingData: { destinationLocation: JSON.stringify({ address: 'Av. Atlântica, 1702 - Copacabana, Rio' }) }
    })).toMatchObject({
      title: 'Viagem iniciada',
      body: 'A caminho de Av. Atlântica',
      collapseKey: 'leaf-ride-started-b1',
      data: { type: 'passenger_trip_started', bookingId: 'b1', screen: 'RobotaxiPrototypeTrip' }
    });
    expect(buildTripStartedPush({ bookingId: 'b1', bookingData: {} }).body).toBe('Sua corrida está em andamento.');
  });

  it('completed: thanks the passenger and carries no amount', () => {
    const push = buildTripCompletedPush({ bookingId: 'b1' });
    expect(push).toMatchObject({
      title: 'Você chegou ao destino',
      body: 'Obrigado por viajar com a Leaf.',
      collapseKey: 'leaf-ride-completed-b1'
    });
    expect(JSON.stringify(push)).not.toMatch(/R\$|fare|valor/i);
  });

  it('cancelled: does not promise a refund', () => {
    const push = buildRideCancelledPush({ bookingId: 'b1' });
    expect(push).toMatchObject({ title: 'Corrida cancelada', body: 'Veja os detalhes no app.', collapseKey: 'leaf-ride-cancelled-b1' });
    expect(JSON.stringify(push)).not.toMatch(/reembolso|refund/i);
  });
});

describe('loadAcceptedBookingData', () => {
  it('reads the booking hash saved at acceptance', async () => {
    const redis = { hgetall: jest.fn().mockResolvedValue({ driverName: 'Ana', vehicleModel: 'Onix' }) };
    await expect(loadAcceptedBookingData(redis, 'b1')).resolves.toEqual({ driverName: 'Ana', vehicleModel: 'Onix' });
    expect(redis.hgetall).toHaveBeenCalledWith('booking:b1');
  });

  it('retries while the acceptance state is not written yet', async () => {
    const redis = {
      hgetall: jest.fn()
        .mockResolvedValueOnce({ status: 'ACCEPTED' })
        .mockResolvedValueOnce({ status: 'ACCEPTED', driverName: 'Ana' })
    };
    await expect(loadAcceptedBookingData(redis, 'b1')).resolves.toMatchObject({ driverName: 'Ana' });
    expect(redis.hgetall).toHaveBeenCalledTimes(2);
  });

  it('returns an empty object without redis or booking id', async () => {
    await expect(loadAcceptedBookingData(null, 'b1')).resolves.toEqual({});
    await expect(loadAcceptedBookingData({ hgetall: jest.fn() }, '')).resolves.toEqual({});
  });
});
