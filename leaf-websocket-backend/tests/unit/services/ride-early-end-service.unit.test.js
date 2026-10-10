const { resolveRideEarlyEnd } = require('../../../services/ride-early-end-service');

describe('ride-early-end-service', () => {
  const destination = { lat: -22.9827, lng: -43.3642 };
  const pickup = { lat: -22.9208, lng: -43.4061 };

  it('detects a ride ended far from the destination', () => {
    const result = resolveRideEarlyEnd({ endLocation: pickup, destinationLocation: destination, env: {} });

    expect(result).toEqual(expect.objectContaining({ detected: true, thresholdMeters: 500, driverReason: null }));
    expect(result.remainingMeters).toBeGreaterThan(7000);
    expect(result.remainingMeters).toBeLessThan(9000);
  });

  it('does not flag a ride ended at the destination', () => {
    expect(
      resolveRideEarlyEnd({
        endLocation: { lat: destination.lat + 0.001, lng: destination.lng },
        destinationLocation: destination,
        env: {}
      })
    ).toBeNull();
  });

  it('reads the destination stored as JSON on the booking hash', () => {
    const result = resolveRideEarlyEnd({
      endLocation: pickup,
      destinationLocation: JSON.stringify({ lat: destination.lat, lng: destination.lng, add: 'Destino' }),
      env: {}
    });

    expect(result.detected).toBe(true);
  });

  it('keeps only known driver reasons', () => {
    expect(
      resolveRideEarlyEnd({
        endLocation: pickup,
        destinationLocation: destination,
        driverStatement: { reason: 'passenger_request' },
        env: {}
      }).driverReason
    ).toBe('passenger_request');
    expect(
      resolveRideEarlyEnd({
        endLocation: pickup,
        destinationLocation: destination,
        driverStatement: { reason: '<script>' },
        env: {}
      }).driverReason
    ).toBeNull();
  });

  it('honours the configured threshold', () => {
    expect(
      resolveRideEarlyEnd({
        endLocation: pickup,
        destinationLocation: destination,
        env: { RIDE_EARLY_END_DISTANCE_METERS: '20000' }
      })
    ).toBeNull();
  });

  it('cannot decide without both locations', () => {
    expect(resolveRideEarlyEnd({ endLocation: pickup, destinationLocation: null, env: {} })).toBeNull();
    expect(resolveRideEarlyEnd({ endLocation: { lat: 0, lng: 0 }, destinationLocation: destination, env: {} })).toBeNull();
    expect(resolveRideEarlyEnd({ endLocation: 'not-json', destinationLocation: destination, env: {} })).toBeNull();
  });
});
