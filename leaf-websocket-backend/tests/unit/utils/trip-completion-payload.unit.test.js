const { buildTripCompletedPayload } = require('../../../utils/trip-completion-payload');

describe('trip-completion-payload', () => {
  test('inclui reviewContext quando presente', () => {
    const payload = buildTripCompletedPayload({
      bookingId: 'booking_1',
      bookingData: {},
      endLocation: { lat: -22.9, lng: -43.1 },
      distance: 2,
      duration: 180,
      fareBreakdown: {
        totalFare: 12.5,
        operationalFee: 1,
        paymentIntermediationFee: 0.5,
        totalFees: 1.5,
        driverNetAmount: 11
      },
      completionType: 'EARLY_ENDED_REVIEW',
      reviewContext: {
        reviewStatus: 'PENDING_MANUAL_REVIEW',
        reviewCategory: 'SAFETY'
      }
    });

    expect(payload.reviewContext).toEqual(
      expect.objectContaining({
        reviewStatus: 'PENDING_MANUAL_REVIEW',
        reviewCategory: 'SAFETY'
      })
    );
  });

  test('mantem participantes no payload final para recibo e avaliacao', () => {
    const payload = buildTripCompletedPayload({
      bookingId: 'booking_2',
      bookingData: {
        customerId: 'passenger_1',
        customerName: 'Passageiro Leaf',
        driverId: 'driver_1',
        driverName: 'Carlos Motorista',
        vehicleMake: 'Toyota',
        vehicleModel: 'Corolla',
        vehiclePlate: 'RJA2D41',
        vehicleColor: 'PRETO'
      },
      endLocation: { lat: -22.9, lng: -43.1 },
      distance: 2,
      duration: 180,
      fareBreakdown: {
        totalFare: 12.5,
        operationalFee: 1,
        paymentIntermediationFee: 0.5,
        totalFees: 1.5,
        driverNetAmount: 11
      }
    });

    expect(payload).toEqual(
      expect.objectContaining({
        customerId: 'passenger_1',
        passengerId: 'passenger_1',
        customerName: 'Passageiro Leaf',
        passengerName: 'Passageiro Leaf',
        driverId: 'driver_1',
        driverName: 'Carlos Motorista',
        vehicleLabel: 'Toyota Corolla',
        vehicleModel: 'Toyota Corolla',
        vehiclePlate: 'RJA2D41',
        vehicleColor: 'PRETO',
        vehicle: expect.objectContaining({
          make: 'Toyota',
          model: 'Corolla',
          plate: 'RJA2D41',
          color: 'PRETO'
        })
      })
    );
  });

  test('inclui total pago, liquido do motorista e pedagio no contrato financeiro', () => {
    const payload = buildTripCompletedPayload({
      bookingId: 'booking_3',
      bookingData: {},
      endLocation: { lat: -22.9, lng: -43.1 },
      distance: 8,
      duration: 900,
      fareBreakdown: {
        totalFare: 27.5,
        tollFee: 4.9,
        operationalFee: 0.99,
        paymentIntermediationFee: 0.5,
        totalFees: 1.49,
        driverNetAmount: 26.01
      }
    });

    expect(payload).toEqual(
      expect.objectContaining({
        fare: 27.5,
        totalFare: 27.5,
        totalPaid: 27.5,
        grossAmount: 27.5,
        tollFee: 4.9,
        totalFees: 1.49,
        driverNetAmount: 26.01,
        fareBreakdown: expect.objectContaining({
          tollFee: 4.9,
          driverNetAmount: 26.01
        })
      })
    );
  });
});
