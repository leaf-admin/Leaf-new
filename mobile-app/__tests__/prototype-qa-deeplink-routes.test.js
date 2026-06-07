const fs = require('fs');
const path = require('path');

const appNavigatorSource = fs.readFileSync(
  path.join(__dirname, '../src/navigation/AppNavigator.js'),
  'utf8'
);
const passengerFlowRoutingSource = fs.readFileSync(
  path.join(__dirname, '../src/screens/prototype/passengerFlowRouting.js'),
  'utf8'
);

describe('prototype QA deep link routes', () => {
  it('opens the driver in-trip state on the driver trip route', () => {
    expect(appNavigatorSource).toContain("'robotaxi/driver/trip': 'RobotaxiPrototypeDriverTrip'");
    expect(appNavigatorSource).not.toContain("'robotaxi/driver/trip': 'RobotaxiPrototype',");
  });

  it('opens ride lifecycle satellite states through the QA deep link guard', () => {
    [
      ["'robotaxi/payment/success'", "'RobotaxiPrototypePaymentSuccess'"],
      ["'robotaxi/payment/failed'", "'RobotaxiPrototypePaymentFailed'"],
      ["'robotaxi/no-drivers'", "'RobotaxiPrototypeNoDrivers'"],
      ["'robotaxi/cancellation'", "'RobotaxiPrototypeCancellation'"],
      ["'robotaxi/rating'", "'RobotaxiPrototypeRating'"],
      ["'robotaxi/complain'", "'RobotaxiPrototypeComplain'"],
      ["'robotaxi/trip/share'", "'RobotaxiPrototypeShareTrip'"],
    ].forEach(([pathFragment, routeFragment]) => {
      expect(appNavigatorSource).toContain(`${pathFragment}: ${routeFragment}`);
    });
    expect(appNavigatorSource).toContain("normalizedPath.startsWith('viagem/')");
    expect(appNavigatorSource).toContain("routeName = 'RobotaxiPrototypePublicTracking'");
  });

  it('keeps cancellation as a satellite decision screen instead of auto-syncing to trip', () => {
    expect(passengerFlowRoutingSource).not.toContain("'RobotaxiPrototypeCancellation'");
  });
});
