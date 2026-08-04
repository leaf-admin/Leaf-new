const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../../..', relativePath), 'utf8');
}

describe('Ride lifecycle source contract audit', () => {
  it('keeps auth and driver activation entrypoints for the lifecycle bootstrap', () => {
    const authRoutes = read('leaf-websocket-backend/routes/auth-routes.js');
    const driverActivationRoutes = read('leaf-websocket-backend/routes/driver-activation.js');

    expect(authRoutes).toContain("router.post('/login'");
    expect(authRoutes).toContain("router.get('/verify'");
    expect(authRoutes).toContain("router.post('/verify'");
    expect(driverActivationRoutes).toContain("router.get('/api/drivers/me/activation/status'");
    expect(driverActivationRoutes).toContain("'/api/drivers/me/activation/documents/:type'");
  });

  it('keeps core backend socket handlers for the ride lifecycle registered', () => {
    const createBookingHandler = read('leaf-websocket-backend/bootstrap/register-socket-create-booking-handler.js');
    const acceptRideHandler = read('leaf-websocket-backend/bootstrap/register-socket-accept-ride-handler.js');
    const startTripHandler = read('leaf-websocket-backend/bootstrap/register-socket-start-trip-handler.js');
    const completeTripHandler = read('leaf-websocket-backend/bootstrap/register-socket-complete-trip-handler.js');
    const confirmPaymentHandler = read('leaf-websocket-backend/bootstrap/register-socket-confirm-payment-handler.js');
    const updateLocationHandler = read('leaf-websocket-backend/bootstrap/register-socket-update-location-handler.js');
    const server = read('leaf-websocket-backend/server.js');
    const websocketManager = read('mobile-app/src/services/WebSocketManager.js');

    expect(createBookingHandler).toContain("socket.on('createBooking'");
    expect(createBookingHandler).toContain("socket.emit('bookingError'");
    expect(acceptRideHandler).toContain("socket.on('acceptRide'");
    expect(acceptRideHandler).toContain("socket.emit('rideAccepted'");
    expect(startTripHandler).toContain("socket.on('startTrip'");
    expect(startTripHandler).toContain("emit('tripStarted'");
    expect(completeTripHandler).toContain("socket.on('completeTrip'");
    expect(completeTripHandler).toContain("emit('tripCompleted'");
    expect(completeTripHandler).toContain('paymentIntermediationFee: fareBreakdown.paymentIntermediationFee');
    expect(completeTripHandler).toContain('totalFees: fareBreakdown.totalFees');
    expect(completeTripHandler).toContain('driverNetAmount: fareBreakdown.driverNetAmount');
    expect(completeTripHandler).toContain("financialSnapshotSource: result.data?.financialSnapshotSource || 'backend_final'");
    expect(completeTripHandler).toContain('authoritativeSnapshot: result.data?.authoritativeSnapshot === true');
    expect(completeTripHandler).toContain("const firebaseConfig = require('../firebase-config');");
    expect(confirmPaymentHandler).toContain("socket.on('confirmPayment'");
    expect(confirmPaymentHandler).toContain("socket.emit('paymentConfirmed'");
    expect(updateLocationHandler).toContain("socket.on('updateLocation'");
    expect(updateLocationHandler).toContain("io.to(`customer_${customerId}`).emit('driverLocation'");
    expect(updateLocationHandler).toContain("'type', 'trip.location.v1'");
    expect(server).not.toContain('registerSocketUpdateTripLocationHandler');
    expect(server).not.toContain("socket.on('updateTripLocation'");
    expect(websocketManager).not.toContain('async updateTripLocation(');
    expect(websocketManager).not.toContain('this.socket.emit("updateTripLocation"');
  });

  it('keeps the prototype runtime subscribed to the canonical ride lifecycle events', () => {
    const runtime = read('mobile-app/src/screens/prototype/prototypeRideRuntime.js');

    [
      'bookingCreated',
      'bookingError',
      'noDriversFound',
      'newRideRequest',
      'rideAccepted',
      'driverArrived',
      'tripStarted',
      'driverLocation',
      'tripCompleted',
      'paymentConfirmed'
    ].forEach((eventName) => {
      expect(runtime).toContain(`socket.on("${eventName}"`);
    });
  });

  it('keeps navigation routes for every canonical passenger and driver ride surface', () => {
    const navigator = read('mobile-app/src/navigation/AppNavigator.js');

    [
      'RobotaxiPrototype',
      'RobotaxiPrototypeDestination',
      'RobotaxiPrototypeDriverSearch',
      'RobotaxiPrototypeTrip',
      'RobotaxiPrototypeReceipt',
      'RobotaxiPrototypeRating',
      'RobotaxiPrototypeCancellation',
      'RobotaxiPrototypeNoDrivers'
    ].forEach((routeName) => {
      expect(navigator).toContain(`name="${routeName}"`);
    });

    [
      'RobotaxiPrototypeBooking',
      'RobotaxiPrototypeDriverOffer',
      'RobotaxiPrototypeDriverTrip',
      'RobotaxiPrototypePayment'
    ].forEach((retiredRouteName) => {
      expect(navigator).not.toContain(`name="${retiredRouteName}"`);
    });
  });

  it('keeps passenger auto-routing aligned with the active lifecycle surfaces', () => {
    const homeScreen = read('mobile-app/src/screens/prototype/RobotaxiHomeScreen.js');
    const passengerRouting = read('mobile-app/src/screens/prototype/passengerFlowRouting.js');
    const lifecycleSurfaceMatrix = read('mobile-app/src/screens/prototype/rideLifecycleSurfaceMatrix.js');

    expect(homeScreen).toContain('resolvePassengerAutoRoute');
    expect(homeScreen).toContain('shouldAutoSyncPassengerRoute');
    expect(passengerRouting).toContain('getRideLifecycleSurface(RIDE_LIFECYCLE_ROLES.PASSENGER, rawStatus)?.routeName');
    expect(passengerRouting).toContain('getPassengerLifecycleSyncRoutes');
    expect(lifecycleSurfaceMatrix).toContain("routeName: 'RobotaxiPrototypeDriverSearch'");
    expect(lifecycleSurfaceMatrix).toContain("routeName: 'RobotaxiPrototypeTrip'");
    expect(lifecycleSurfaceMatrix).toContain("routeName: 'RobotaxiPrototypeReceipt'");
  });
});
