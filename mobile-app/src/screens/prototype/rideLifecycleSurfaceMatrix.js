import {
  normalizeRuntimeRideStatus,
  RUNTIME_RIDE_STATUSES,
} from './rideLifecycleContract';

export const RIDE_LIFECYCLE_ROLES = Object.freeze({
  PASSENGER: 'passenger',
  DRIVER: 'driver',
});

export const RIDE_LIFECYCLE_SURFACES = Object.freeze({
  IDLE_MAP: 'idle_map',
  PASSENGER_SEARCH: 'passenger_search',
  PASSENGER_TRIP: 'passenger_trip',
  PASSENGER_RECEIPT: 'passenger_receipt',
  PASSENGER_CANCELLATION: 'passenger_cancellation',
  PASSENGER_NO_DRIVERS: 'passenger_no_drivers',
  DRIVER_OFFER: 'driver_offer',
  DRIVER_TRIP: 'driver_trip',
  DRIVER_RECEIPT: 'driver_receipt',
  DRIVER_CLEARED: 'driver_cleared',
});

const PASSENGER_STATUS_SURFACES = Object.freeze({
  [RUNTIME_RIDE_STATUSES.IDLE]: {
    surface: RIDE_LIFECYCLE_SURFACES.IDLE_MAP,
    routeName: null,
    protected: false,
    terminal: false,
    requiredTestIDs: ['passenger-home-destination-input'],
  },
  [RUNTIME_RIDE_STATUSES.REQUESTING]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_SEARCH,
    routeName: 'RobotaxiPrototypeDriverSearch',
    protected: true,
    terminal: false,
    requiredTestIDs: ['passenger-driver-search-sheet'],
  },
  [RUNTIME_RIDE_STATUSES.SEARCHING]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_SEARCH,
    routeName: 'RobotaxiPrototypeDriverSearch',
    protected: true,
    terminal: false,
    requiredTestIDs: ['passenger-driver-search-sheet'],
  },
  [RUNTIME_RIDE_STATUSES.ACCEPTED]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_TRIP,
    routeName: 'RobotaxiPrototypeTrip',
    protected: true,
    terminal: false,
    requiredTestIDs: ['passenger-trip-screen', 'passenger-trip-driver-identity'],
  },
  [RUNTIME_RIDE_STATUSES.ARRIVED]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_TRIP,
    routeName: 'RobotaxiPrototypeTrip',
    protected: true,
    terminal: false,
    requiredTestIDs: ['passenger-trip-screen', 'passenger-trip-driver-identity'],
  },
  [RUNTIME_RIDE_STATUSES.STARTED]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_TRIP,
    routeName: 'RobotaxiPrototypeTrip',
    protected: true,
    terminal: false,
    requiredTestIDs: ['passenger-trip-screen', 'passenger-trip-started-action-dock'],
  },
  [RUNTIME_RIDE_STATUSES.OPERATIONAL_INTERRUPTED]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_TRIP,
    routeName: 'RobotaxiPrototypeTrip',
    protected: true,
    terminal: false,
    requiredTestIDs: ['passenger-trip-screen', 'passenger-trip-operational-continue-button'],
  },
  [RUNTIME_RIDE_STATUSES.SEARCHING_REPLACEMENT]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_TRIP,
    routeName: 'RobotaxiPrototypeTrip',
    protected: true,
    terminal: false,
    requiredTestIDs: ['passenger-trip-screen'],
  },
  [RUNTIME_RIDE_STATUSES.COMPLETED]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_RECEIPT,
    routeName: 'RobotaxiPrototypeReceipt',
    protected: false,
    terminal: true,
    requiredTestIDs: ['passenger-receipt-rate-trip-button'],
  },
  [RUNTIME_RIDE_STATUSES.CANCELED]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_CANCELLATION,
    routeName: 'RobotaxiPrototypeCancellation',
    protected: false,
    terminal: true,
    requiredTestIDs: ['passenger-cancellation-keep-button'],
  },
  [RUNTIME_RIDE_STATUSES.NO_DRIVERS]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_NO_DRIVERS,
    routeName: 'RobotaxiPrototypeNoDrivers',
    protected: false,
    terminal: true,
    requiredTestIDs: ['passenger-no-drivers-screen'],
  },
  [RUNTIME_RIDE_STATUSES.REJECTED]: {
    surface: RIDE_LIFECYCLE_SURFACES.PASSENGER_NO_DRIVERS,
    routeName: 'RobotaxiPrototypeNoDrivers',
    protected: false,
    terminal: true,
    requiredTestIDs: ['passenger-no-drivers-screen'],
  },
});

const DRIVER_STATUS_SURFACES = Object.freeze({
  [RUNTIME_RIDE_STATUSES.IDLE]: {
    surface: RIDE_LIFECYCLE_SURFACES.IDLE_MAP,
    routeName: null,
    protected: false,
    terminal: false,
    requiredTestIDs: ['driver-home-toggle-online'],
  },
  [RUNTIME_RIDE_STATUSES.REQUESTING]: {
    surface: RIDE_LIFECYCLE_SURFACES.IDLE_MAP,
    routeName: null,
    protected: false,
    terminal: false,
    requiredTestIDs: ['driver-home-toggle-online'],
  },
  [RUNTIME_RIDE_STATUSES.SEARCHING]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_OFFER,
    routeName: null,
    protected: true,
    terminal: false,
    requiredTestIDs: [
      'driver-live-ride-overlay-wrap',
      'driver-live-offer-card',
      'driver-live-offer-accept-button',
    ],
  },
  [RUNTIME_RIDE_STATUSES.ACCEPTED]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_TRIP,
    routeName: null,
    protected: true,
    terminal: false,
    requiredTestIDs: [
      'driver-live-ride-overlay-wrap',
      'driver-live-trip-card',
      'driver-live-trip-compact-summary',
      'driver-live-passenger-identity',
      'driver-live-primary-action-arrive-button',
    ],
  },
  [RUNTIME_RIDE_STATUSES.ARRIVED]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_TRIP,
    routeName: null,
    protected: true,
    terminal: false,
    requiredTestIDs: [
      'driver-live-ride-overlay-wrap',
      'driver-live-trip-card',
      'driver-live-trip-compact-summary',
      'driver-live-passenger-identity',
      'driver-live-primary-action-start-button',
    ],
  },
  [RUNTIME_RIDE_STATUSES.STARTED]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_TRIP,
    routeName: null,
    protected: true,
    terminal: false,
    requiredTestIDs: [
      'driver-live-ride-overlay-wrap',
      'driver-live-trip-card',
      'driver-live-trip-compact-summary',
      'driver-live-passenger-identity',
      'driver-live-primary-action-complete-button',
    ],
  },
  [RUNTIME_RIDE_STATUSES.OPERATIONAL_INTERRUPTED]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_TRIP,
    routeName: null,
    protected: true,
    terminal: false,
    requiredTestIDs: [
      'driver-live-ride-overlay-wrap',
      'driver-live-operational-hold-title',
      'driver-live-passenger-identity',
    ],
  },
  [RUNTIME_RIDE_STATUSES.SEARCHING_REPLACEMENT]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_TRIP,
    routeName: null,
    protected: true,
    terminal: false,
    requiredTestIDs: [
      'driver-live-ride-overlay-wrap',
      'driver-live-operational-hold-title',
      'driver-live-passenger-identity',
    ],
  },
  [RUNTIME_RIDE_STATUSES.COMPLETED]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_RECEIPT,
    routeName: 'RobotaxiPrototypeReceipt',
    protected: false,
    terminal: true,
    requiredTestIDs: ['driver-receipt-rate-passenger-button'],
  },
  [RUNTIME_RIDE_STATUSES.CANCELED]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_CLEARED,
    routeName: null,
    protected: false,
    terminal: true,
    requiredTestIDs: ['driver-home-toggle-online'],
  },
  [RUNTIME_RIDE_STATUSES.NO_DRIVERS]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_CLEARED,
    routeName: null,
    protected: false,
    terminal: true,
    requiredTestIDs: ['driver-home-toggle-online'],
  },
  [RUNTIME_RIDE_STATUSES.REJECTED]: {
    surface: RIDE_LIFECYCLE_SURFACES.DRIVER_CLEARED,
    routeName: null,
    protected: false,
    terminal: true,
    requiredTestIDs: ['driver-home-toggle-online'],
  },
});

const MATRIX_BY_ROLE = Object.freeze({
  [RIDE_LIFECYCLE_ROLES.PASSENGER]: PASSENGER_STATUS_SURFACES,
  [RIDE_LIFECYCLE_ROLES.DRIVER]: DRIVER_STATUS_SURFACES,
});

function cloneSurface(status, config) {
  return {
    status,
    surface: config.surface,
    routeName: config.routeName,
    protected: config.protected,
    terminal: config.terminal,
    requiredTestIDs: [...config.requiredTestIDs],
  };
}

export function getRideLifecycleSurface(role, rawStatus) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedStatus = normalizeRuntimeRideStatus(rawStatus);
  const matrix = MATRIX_BY_ROLE[normalizedRole];
  const config = matrix?.[normalizedStatus] || null;

  return config ? cloneSurface(normalizedStatus, config) : null;
}

export function getRideLifecycleSurfaceMatrix(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const matrix = MATRIX_BY_ROLE[normalizedRole] || {};

  return Object.fromEntries(
    Object.entries(matrix).map(([status, config]) => [status, cloneSurface(status, config)]),
  );
}

export function getPassengerLifecycleSyncRoutes() {
  const routeNames = Object.values(PASSENGER_STATUS_SURFACES)
    .filter((config) => config.surface !== RIDE_LIFECYCLE_SURFACES.PASSENGER_RECEIPT)
    .map((config) => config.routeName)
    .filter(Boolean);

  return [
    'RobotaxiPrototype',
    'Map',
    'MapScreen',
    'TabRoot',
    'RobotaxiPrototypeDestination',
    'RobotaxiPrototypePaymentSuccess',
    'RobotaxiPrototypePaymentFailed',
    ...routeNames,
  ];
}
