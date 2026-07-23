import {
  normalizeRuntimeRideStatus,
} from './rideLifecycleContract';
import {
  getPassengerLifecycleSyncRoutes,
  getRideLifecycleSurface,
  RIDE_LIFECYCLE_ROLES,
} from './rideLifecycleSurfaceMatrix';

export const PASSENGER_RUNTIME_SYNC_ROUTES = new Set(getPassengerLifecycleSyncRoutes());

export function normalizePassengerBookingStatus(rawStatus) {
  return normalizeRuntimeRideStatus(rawStatus);
}

export function resolvePassengerAutoRoute(rawStatus) {
  return getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.PASSENGER, rawStatus)?.routeName || null;
}

export function shouldAutoSyncPassengerRoute(routeName) {
  return PASSENGER_RUNTIME_SYNC_ROUTES.has(String(routeName || '').trim());
}
