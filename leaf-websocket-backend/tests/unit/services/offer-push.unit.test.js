const { buildOfferPushNotification, isOfferPushEnabled } = require('../../../services/offer-push');

describe('new ride offer push', () => {
  it('shows the net fare and the pickup time', () => {
    expect(
      buildOfferPushNotification({
        bookingId: 'booking_1',
        estimatedDriverNetAmount: 38.43,
        estimatedArrivalToPickupMin: 3,
        estimatedTripDistanceKm: 15.04,
        destinationAddress: 'Via Parque Shopping, Av. Ayrton Senna - Barra',
        expiresAt: '2026-10-13T18:00:20.000Z'
      })
    ).toEqual({
      title: 'Nova corrida',
      channelId: 'driver_actions',
      collapseKey: 'leaf-ride-offer',
      ttlSeconds: 30,
      body: 'R$ 38,43 líquido · 3 min até o embarque',
      data: {
        type: 'ride_offer',
        bookingId: 'booking_1',
        screen: 'RobotaxiPrototype',
        expiresAt: '2026-10-13T18:00:20.000Z',
        netAmount: '38.43',
        pickupMinutes: '3',
        tripKm: '15.0',
        dropoff: 'Via Parque Shopping'
      }
    });
  });

  it('falls back to a generic body when amounts are missing', () => {
    expect(buildOfferPushNotification({ bookingId: 'booking_1' }).body).toBe('Toque para ver e aceitar.');
  });

  it('is on by default and can be switched off', () => {
    expect(isOfferPushEnabled({})).toBe(true);
    expect(isOfferPushEnabled({ ENABLE_NEW_OFFER_PUSH: 'false' })).toBe(false);
  });
  it('expires with the offer and replaces the previous offer notice', () => {
    const now = Date.now();
    const fromExpiry = buildOfferPushNotification({ bookingId: 'b1', expiresAt: now + 18000 });
    expect(fromExpiry.collapseKey).toBe('leaf-ride-offer');
    expect(fromExpiry.ttlSeconds).toBeGreaterThanOrEqual(17);
    expect(fromExpiry.ttlSeconds).toBeLessThanOrEqual(18);

    expect(buildOfferPushNotification({ bookingId: 'b1', timeout: 20 }).ttlSeconds).toBe(20);
    expect(buildOfferPushNotification({ bookingId: 'b1', expiresAt: now - 5000 }).ttlSeconds).toBe(30);
    expect(buildOfferPushNotification({ bookingId: 'b1', timeout: 900 }).ttlSeconds).toBe(120);
    expect(buildOfferPushNotification({ bookingId: 'b1' }).ttlSeconds).toBe(30);
  });
});
