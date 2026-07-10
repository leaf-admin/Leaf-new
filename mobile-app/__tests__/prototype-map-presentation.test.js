import {
  MAP_PRESENTATION_EVENTS,
  resolvePrototypeMapPresentation,
} from '../src/screens/prototype/prototypeMapPresentation';

describe('prototype map presentation contract', () => {
  it.each([
    ['passenger', 'accepted', MAP_PRESENTATION_EVENTS.PASSENGER_PICKUP_APPROACH, true, true],
    ['passenger', 'arrived', MAP_PRESENTATION_EVENTS.PASSENGER_PICKUP_READY, true, false],
    ['passenger', 'started', MAP_PRESENTATION_EVENTS.PASSENGER_TRIP_NAVIGATION, true, true],
    ['passenger', 'operational_interrupted', MAP_PRESENTATION_EVENTS.PASSENGER_INTERRUPTED, true, false],
    ['driver', 'offered', MAP_PRESENTATION_EVENTS.DRIVER_OFFER_OVERVIEW, false, true],
    ['driver', 'started', MAP_PRESENTATION_EVENTS.DRIVER_TRIP_NAVIGATION, true, true],
  ])(
    'maps %s/%s to a distinct presentation event',
    (role, status, event, interactionEnabled, animateRoute) => {
      expect(resolvePrototypeMapPresentation({ role, status })).toEqual(
        expect.objectContaining({ event, interactionEnabled, animateRoute }),
      );
    },
  );

  it('gives manual camera control to an active trip, but not to the driver offer overview', () => {
    expect(
      resolvePrototypeMapPresentation({ role: 'passenger', status: 'started' })
        .manualCameraHoldMs,
    ).toBeGreaterThan(0);
    expect(
      resolvePrototypeMapPresentation({ role: 'driver', status: 'offered' })
        .manualCameraHoldMs,
    ).toBe(0);
  });
});
