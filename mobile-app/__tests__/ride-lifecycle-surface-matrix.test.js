const fs = require('fs');
const path = require('path');

const {
  ACTIVE_DRIVER_RIDE_STATUSES,
  ACTIVE_PASSENGER_RIDE_STATUSES,
  RUNTIME_RIDE_STATUSES,
  TERMINAL_RIDE_STATUSES,
} = require('../src/screens/prototype/rideLifecycleContract');
const {
  getPassengerLifecycleSyncRoutes,
  getRideLifecycleSurface,
  getRideLifecycleSurfaceMatrix,
  RIDE_LIFECYCLE_ROLES,
  RIDE_LIFECYCLE_SURFACES,
} = require('../src/screens/prototype/rideLifecycleSurfaceMatrix');
const {
  resolvePassengerAutoRoute,
  shouldAutoSyncPassengerRoute,
} = require('../src/screens/prototype/passengerFlowRouting');

const screenSourceByRoute = {
  RobotaxiPrototypeDriverSearch: 'RobotaxiDriverSearchScreen.js',
  RobotaxiPrototypeTrip: 'RobotaxiTripScreen.js',
  RobotaxiPrototypeReceipt: 'RobotaxiReceiptScreen.js',
  RobotaxiPrototypeCancellation: 'RobotaxiCancellationScreen.js',
  RobotaxiPrototypeNoDrivers: 'RobotaxiNoDriversScreen.js',
  RobotaxiPrototypeDriverOffer: 'RobotaxiDriverOfferScreen.js',
  RobotaxiPrototypeDriverTrip: 'RobotaxiDriverTripScreen.js',
};

const homeSurfaceSourceFiles = [
  'RobotaxiHomeScreen.js',
  path.join('home', 'PassengerHomeOverlay.js'),
  path.join('home', 'DriverHomeOverlay.js'),
];

function readPrototypeSource(relativeFile) {
  return fs.readFileSync(
    path.join(__dirname, '..', 'src', 'screens', 'prototype', relativeFile),
    'utf8',
  );
}

function readSurfaceSource(surface) {
  if (!surface.routeName) {
    return homeSurfaceSourceFiles.map(readPrototypeSource).join('\n');
  }

  const routeName = surface.routeName;
  const fileName = screenSourceByRoute[routeName];
  if (!fileName) return '';
  return readPrototypeSource(fileName);
}

describe('ride lifecycle surface matrix', () => {
  it('maps every canonical passenger lifecycle state to a non-empty surface contract', () => {
    Object.values(RUNTIME_RIDE_STATUSES).forEach((status) => {
      const surface = getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.PASSENGER, status);

      expect(surface).toEqual(expect.objectContaining({
        status,
        surface: expect.any(String),
        protected: expect.any(Boolean),
        terminal: expect.any(Boolean),
        requiredTestIDs: expect.any(Array),
      }));
      expect(resolvePassengerAutoRoute(status)).toBe(surface.routeName);
    });
  });

  it('maps every canonical driver lifecycle state to a deliberate surface or cleared terminal', () => {
    Object.values(RUNTIME_RIDE_STATUSES).forEach((status) => {
      const surface = getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.DRIVER, status);

      expect(surface).toEqual(expect.objectContaining({
        status,
        surface: expect.any(String),
        protected: expect.any(Boolean),
        terminal: expect.any(Boolean),
        requiredTestIDs: expect.any(Array),
      }));
    });

    expect(getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.DRIVER, 'completed')).toEqual(
      expect.objectContaining({
        surface: RIDE_LIFECYCLE_SURFACES.DRIVER_RECEIPT,
        routeName: 'RobotaxiPrototypeReceipt',
        terminal: true,
      }),
    );
    expect(getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.DRIVER, 'canceled')).toEqual(
      expect.objectContaining({
        surface: RIDE_LIFECYCLE_SURFACES.DRIVER_CLEARED,
        routeName: null,
        terminal: true,
        requiredTestIDs: ['driver-home-toggle-online'],
      }),
    );
  });

  it('marks active ride surfaces as protected and terminal surfaces as not protected', () => {
    ACTIVE_PASSENGER_RIDE_STATUSES.forEach((status) => {
      expect(getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.PASSENGER, status)).toEqual(
        expect.objectContaining({ protected: true, terminal: false }),
      );
    });
    ACTIVE_DRIVER_RIDE_STATUSES.forEach((status) => {
      expect(getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.DRIVER, status)).toEqual(
        expect.objectContaining({ protected: true, terminal: false }),
      );
    });
    TERMINAL_RIDE_STATUSES.forEach((status) => {
      expect(getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.PASSENGER, status)).toEqual(
        expect.objectContaining({ protected: false, terminal: true }),
      );
      expect(getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.DRIVER, status)).toEqual(
        expect.objectContaining({ protected: false, terminal: true }),
      );
    });
  });

  it('keeps passenger auto-sync routes derived from lifecycle surfaces', () => {
    getPassengerLifecycleSyncRoutes().forEach((routeName) => {
      expect(shouldAutoSyncPassengerRoute(routeName)).toBe(true);
    });

    expect(resolvePassengerAutoRoute('completed')).toBe('RobotaxiPrototypeReceipt');
    expect(shouldAutoSyncPassengerRoute('RobotaxiPrototypeReceipt')).toBe(false);
    expect(shouldAutoSyncPassengerRoute('RobotaxiPrototypeMenu')).toBe(false);
  });

  it('points required lifecycle surface testIDs at actual screen source', () => {
    [
      ...Object.values(getRideLifecycleSurfaceMatrix(RIDE_LIFECYCLE_ROLES.PASSENGER)),
      ...Object.values(getRideLifecycleSurfaceMatrix(RIDE_LIFECYCLE_ROLES.DRIVER)),
    ].forEach((surface) => {
      if (surface.requiredTestIDs.length === 0) {
        return;
      }

      const source = readSurfaceSource(surface);
      surface.requiredTestIDs.forEach((testID) => {
        expect(source).toContain(testID);
      });
    });
  });
});
