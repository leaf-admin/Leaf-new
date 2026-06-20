import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildRidePaymentContextKey,
  buildRidePaymentRouteContextKey,
  clearRidePaymentSession,
  findRecoverableRidePaymentSession,
  getOrCreateRidePaymentSession,
  saveRidePaymentSessionData,
} from '../src/services/RidePaymentSessionService';

describe('RidePaymentSessionService', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('keeps one session for the same passenger and canonical ride context', async () => {
    const contextKey = buildRidePaymentContextKey({
      tripData: {
        pickup: { lat: -22.920775, lng: -43.406003 },
        drop: { lat: -22.9673111, lng: -43.1789541 },
        carType: 'Leaf Plus',
      },
      amountInCents: 7690,
      grossAmountInCents: 7690,
    });

    const first = await getOrCreateRidePaymentSession({
      passengerId: 'passenger_1',
      contextKey,
    });
    const second = await getOrCreateRidePaymentSession({
      passengerId: 'passenger_1',
      contextKey,
    });

    expect(second.paymentSessionId).toBe(first.paymentSessionId);
  });

  it('persists charge data until the booking consumes the session', async () => {
    const session = await getOrCreateRidePaymentSession({
      passengerId: 'passenger_2',
      contextKey: 'route-context-2',
    });
    await saveRidePaymentSessionData({
      passengerId: 'passenger_2',
      contextKey: 'route-context-2',
      paymentSessionId: session.paymentSessionId,
      paymentData: {
        chargeId: 'charge_2',
        rideId: 'temp_ride_2',
        amountInCents: 7690,
      },
    });

    const recovered = await getOrCreateRidePaymentSession({
      passengerId: 'passenger_2',
      contextKey: 'route-context-2',
    });
    expect(recovered.paymentData).toMatchObject({
      chargeId: 'charge_2',
      rideId: 'temp_ride_2',
      amountInCents: 7690,
    });

    await clearRidePaymentSession({
      passengerId: 'passenger_2',
      paymentSessionId: session.paymentSessionId,
      chargeId: 'charge_2',
    });
    const next = await getOrCreateRidePaymentSession({
      passengerId: 'passenger_2',
      contextKey: 'route-context-2',
    });
    expect(next.paymentSessionId).not.toBe(session.paymentSessionId);
    expect(next.paymentData).toBeNull();
  });

  it('recovers the paid quote for the route even if a refreshed quote has another amount', async () => {
    const tripData = {
      pickup: { lat: -22.920775, lng: -43.406003 },
      drop: { lat: -22.9673111, lng: -43.1789541 },
      carType: 'Leaf Plus',
    };
    const originalContextKey = buildRidePaymentContextKey({
      tripData,
      amountInCents: 7690,
      grossAmountInCents: 7690,
    });
    const session = await getOrCreateRidePaymentSession({
      passengerId: 'passenger_3',
      contextKey: originalContextKey,
    });
    await saveRidePaymentSessionData({
      passengerId: 'passenger_3',
      contextKey: originalContextKey,
      paymentSessionId: session.paymentSessionId,
      paymentData: {
        chargeId: 'charge_original_quote',
        rideId: 'temp_ride_original_quote',
        amountInCents: 7690,
      },
    });

    const recovered = await findRecoverableRidePaymentSession({
      passengerId: 'passenger_3',
      routeContextKey: buildRidePaymentRouteContextKey({ tripData }),
    });

    expect(recovered).toMatchObject({
      paymentSessionId: session.paymentSessionId,
      paymentData: {
        chargeId: 'charge_original_quote',
        amountInCents: 7690,
      },
    });
  });
});
