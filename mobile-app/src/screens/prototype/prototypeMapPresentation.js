const DEFAULT_MANUAL_CAMERA_HOLD_MS = 8000;

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ['driver', 'motorista', 'partner', 'parceiro'].includes(role)
    ? 'driver'
    : 'passenger';
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

export const MAP_PRESENTATION_EVENTS = Object.freeze({
  PASSENGER_ROUTE_PREVIEW: 'passenger_route_preview',
  PASSENGER_PICKUP_APPROACH: 'passenger_pickup_approach',
  PASSENGER_PICKUP_READY: 'passenger_pickup_ready',
  PASSENGER_TRIP_NAVIGATION: 'passenger_trip_navigation',
  PASSENGER_INTERRUPTED: 'passenger_interrupted',
  DRIVER_OFFER_OVERVIEW: 'driver_offer_overview',
  DRIVER_PICKUP_NAVIGATION: 'driver_pickup_navigation',
  DRIVER_TRIP_NAVIGATION: 'driver_trip_navigation',
  DRIVER_INTERRUPTED: 'driver_interrupted',
});

export function resolvePrototypeMapPresentation({ role, status } = {}) {
  const normalizedRole = normalizeRole(role);
  const normalizedStatus = normalizeStatus(status);

  if (normalizedRole === 'driver') {
    if (normalizedStatus === 'searching' || normalizedStatus === 'offered') {
      return Object.freeze({
        event: MAP_PRESENTATION_EVENTS.DRIVER_OFFER_OVERVIEW,
        interactionEnabled: false,
        animateRoute: true,
        manualCameraHoldMs: 0,
      });
    }

    if (normalizedStatus === 'started') {
      return Object.freeze({
        event: MAP_PRESENTATION_EVENTS.DRIVER_TRIP_NAVIGATION,
        interactionEnabled: true,
        animateRoute: false,
        manualCameraHoldMs: DEFAULT_MANUAL_CAMERA_HOLD_MS,
      });
    }

    if (normalizedStatus === 'operational_interrupted') {
      return Object.freeze({
        event: MAP_PRESENTATION_EVENTS.DRIVER_INTERRUPTED,
        interactionEnabled: true,
        animateRoute: false,
        manualCameraHoldMs: DEFAULT_MANUAL_CAMERA_HOLD_MS,
      });
    }

    return Object.freeze({
      event: MAP_PRESENTATION_EVENTS.DRIVER_PICKUP_NAVIGATION,
      interactionEnabled: true,
      animateRoute: true,
      manualCameraHoldMs: DEFAULT_MANUAL_CAMERA_HOLD_MS,
    });
  }

  if (normalizedStatus === 'accepted') {
    return Object.freeze({
      event: MAP_PRESENTATION_EVENTS.PASSENGER_PICKUP_APPROACH,
      interactionEnabled: true,
      animateRoute: true,
      manualCameraHoldMs: DEFAULT_MANUAL_CAMERA_HOLD_MS,
    });
  }

  if (normalizedStatus === 'arrived') {
    return Object.freeze({
      event: MAP_PRESENTATION_EVENTS.PASSENGER_PICKUP_READY,
      interactionEnabled: true,
      animateRoute: false,
      manualCameraHoldMs: DEFAULT_MANUAL_CAMERA_HOLD_MS,
    });
  }

  if (normalizedStatus === 'started') {
    return Object.freeze({
      event: MAP_PRESENTATION_EVENTS.PASSENGER_TRIP_NAVIGATION,
      interactionEnabled: true,
      // Live location heartbeats replace route-array identities frequently.
      // Navigation must render the complete sealed route immediately instead
      // of restarting a progressive draw on every heartbeat.
      animateRoute: false,
      manualCameraHoldMs: DEFAULT_MANUAL_CAMERA_HOLD_MS,
    });
  }

  if (normalizedStatus === 'operational_interrupted') {
    return Object.freeze({
      event: MAP_PRESENTATION_EVENTS.PASSENGER_INTERRUPTED,
      interactionEnabled: true,
      animateRoute: false,
      manualCameraHoldMs: DEFAULT_MANUAL_CAMERA_HOLD_MS,
    });
  }

  return Object.freeze({
    event: MAP_PRESENTATION_EVENTS.PASSENGER_ROUTE_PREVIEW,
    interactionEnabled: true,
    animateRoute: true,
    manualCameraHoldMs: DEFAULT_MANUAL_CAMERA_HOLD_MS,
  });
}

export { DEFAULT_MANUAL_CAMERA_HOLD_MS };
