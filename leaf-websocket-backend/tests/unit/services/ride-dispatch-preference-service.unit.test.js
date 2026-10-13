const h3 = require('h3-js');
const {
  driverMatchesDestinationMode,
  driverMatchesLeafDelas,
  driverMatchesRidePreferences,
  normalizeGender
} = require('../../../services/ride-dispatch-preference-service');

describe('ride-dispatch-preference-service', () => {
  it('normalizes common gender values used by onboarding and dashboard data', () => {
    expect(normalizeGender('Feminino')).toBe('female');
    expect(normalizeGender('mulher')).toBe('female');
    expect(normalizeGender('M')).toBe('male');
    expect(normalizeGender('Masculino')).toBe('male');
  });

  it('allows Leaf Delas rides only for female drivers', () => {
    expect(
      driverMatchesLeafDelas(
        { driverId: 'driver_female_1', gender: 'female' },
        { preferences: { leafDelas: true } }
      )
    ).toMatchObject({ ok: true, reason: 'LEAF_DELAS_DRIVER_MATCH' });

    expect(
      driverMatchesLeafDelas(
        { driverId: 'driver_male_1', gender: 'male' },
        { preferences: { leafDelas: true } }
      )
    ).toMatchObject({
      ok: false,
      reason: 'LEAF_DELAS_DRIVER_GENDER_MISMATCH'
    });
  });

  it('matches destination-mode drivers when the ride moves them closer to their target', () => {
    const result = driverMatchesDestinationMode(
      {
        destinationModeActive: 'true',
        destinationModeLat: 0,
        destinationModeLng: 2,
        destinationModeMinProgressKm: 50,
        destinationModeArrivalRadiusKm: 5
      },
      {
        pickupLocation: { lat: 0, lng: 0 },
        destinationLocation: { lat: 0, lng: 1.4 }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      reason: 'DRIVER_DESTINATION_MATCH',
      meta: expect.objectContaining({
        progressKm: expect.any(Number)
      })
    });
    expect(result.meta.progressKm).toBeGreaterThanOrEqual(50);
  });

  it('rejects destination-mode drivers when the ride moves away from the target', () => {
    expect(
      driverMatchesRidePreferences(
        {
          gender: 'female',
          destinationModeActive: 'true',
          destinationModeLat: 0,
          destinationModeLng: 2,
          destinationModeMinProgressKm: 20
        },
        {
          preferences: { leafDelas: true },
          pickupLocation: { lat: 0, lng: 1.5 },
          destinationLocation: { lat: 0, lng: 0.5 }
        }
      )
    ).toMatchObject({
      ok: false,
      reason: 'DRIVER_DESTINATION_NO_PROGRESS'
    });
  });

  describe('avoided areas (hard filter)', () => {
    const DESTINATION = { lat: -22.9711, lng: -43.1822 };
    const DESTINATION_CELL = h3.latLngToCell(DESTINATION.lat, DESTINATION.lng, 8);
    const FAR_CELL = h3.latLngToCell(-23.0045, -43.3659, 8);

    it('does not match a driver whose avoided cells contain the destination', () => {
      expect(
        driverMatchesRidePreferences(
          { driverId: 'driver_1', avoidedH3Cells: JSON.stringify([DESTINATION_CELL]) },
          { pickupLocation: { lat: -22.95, lng: -43.2 }, destinationLocation: DESTINATION }
        )
      ).toMatchObject({ ok: false, reason: 'DRIVER_AVOIDED_AREA' });
    });

    it('matches a driver whose avoided cells are elsewhere', () => {
      expect(
        driverMatchesRidePreferences(
          { driverId: 'driver_1', avoidedH3Cells: JSON.stringify([FAR_CELL]) },
          { pickupLocation: { lat: -22.95, lng: -43.2 }, destinationLocation: DESTINATION }
        )
      ).toMatchObject({ ok: true });
    });

    it('matches when the ride has no destination', () => {
      expect(
        driverMatchesRidePreferences(
          { driverId: 'driver_1', avoidedH3Cells: JSON.stringify([DESTINATION_CELL]) },
          { pickupLocation: { lat: -22.95, lng: -43.2 } }
        )
      ).toMatchObject({ ok: true });
    });
  });
});
