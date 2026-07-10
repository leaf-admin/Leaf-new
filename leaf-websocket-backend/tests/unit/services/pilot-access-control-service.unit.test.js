describe('pilot-access-control-service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      LEAF_LAUNCH_PROFILE: 'pilot_controlled',
      PILOT_ALLOWED_PASSENGER_IDS: 'passenger-1, passenger-2',
      PILOT_ALLOWED_DRIVER_IDS: '["driver-1","driver-2"]',
      LEAF_ACCEPT_NEW_PIX: 'true',
      LEAF_ACCEPT_NEW_BOOKINGS: 'true'
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows only configured passengers and drivers in pilot mode', () => {
    const { evaluatePilotAccess } = require('../../../services/pilot-access-control-service');

    expect(evaluatePilotAccess({ userId: 'passenger-1', role: 'passenger', operation: 'booking' }))
      .toEqual(expect.objectContaining({ allowed: true, code: 'PILOT_COHORT_ALLOWED' }));
    expect(evaluatePilotAccess({ userId: 'passenger-3', role: 'passenger', operation: 'booking' }))
      .toEqual(expect.objectContaining({ allowed: false, code: 'PILOT_COHORT_ACCESS_DENIED' }));
    expect(evaluatePilotAccess({ userId: 'driver-2', role: 'driver', operation: 'driver_online' }))
      .toEqual(expect.objectContaining({ allowed: true }));
  });

  it('fails closed when a pilot cohort is absent', () => {
    delete process.env.PILOT_ALLOWED_DRIVER_IDS;
    const { evaluatePilotAccess } = require('../../../services/pilot-access-control-service');

    expect(evaluatePilotAccess({ userId: 'driver-1', role: 'driver', operation: 'driver_online' }))
      .toEqual(expect.objectContaining({ allowed: false, code: 'PILOT_COHORT_NOT_CONFIGURED' }));
  });

  it('pauses new Pix and bookings independently', () => {
    process.env.LEAF_ACCEPT_NEW_PIX = 'false';
    process.env.LEAF_ACCEPT_NEW_BOOKINGS = 'false';
    const { evaluatePilotAccess } = require('../../../services/pilot-access-control-service');

    expect(evaluatePilotAccess({ userId: 'passenger-1', role: 'passenger', operation: 'payment' }))
      .toEqual(expect.objectContaining({ allowed: false, code: 'NEW_PIX_PAUSED', retryable: true }));
    expect(evaluatePilotAccess({ userId: 'passenger-1', role: 'passenger', operation: 'booking' }))
      .toEqual(expect.objectContaining({ allowed: false, code: 'NEW_BOOKINGS_PAUSED', retryable: true }));
  });

  it('treats geofence validation as a controlled no-intake profile', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'geofence_validation';
    process.env.LEAF_PILOT_CONTROLLED = 'false';
    process.env.LEAF_ACCEPT_NEW_PIX = 'false';
    process.env.LEAF_ACCEPT_NEW_BOOKINGS = 'false';
    const { evaluatePilotAccess, getPublicPilotAccessSnapshot } = require('../../../services/pilot-access-control-service');

    expect(getPublicPilotAccessSnapshot()).toEqual(expect.objectContaining({
      pilotControlled: true,
      acceptNewPix: false,
      acceptNewBookings: false
    }));
    expect(evaluatePilotAccess({ userId: 'passenger-1', role: 'passenger', operation: 'payment' }))
      .toEqual(expect.objectContaining({ allowed: false, code: 'NEW_PIX_PAUSED' }));
    expect(evaluatePilotAccess({ userId: 'passenger-1', role: 'passenger', operation: 'booking' }))
      .toEqual(expect.objectContaining({ allowed: false, code: 'NEW_BOOKINGS_PAUSED' }));
  });

  it('does not restrict normal launch profiles', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'full';
    delete process.env.PILOT_ALLOWED_PASSENGER_IDS;
    const { evaluatePilotAccess } = require('../../../services/pilot-access-control-service');

    expect(evaluatePilotAccess({ userId: null, role: 'passenger', operation: 'payment' }))
      .toEqual({ allowed: true, code: 'PILOT_CONTROL_NOT_ACTIVE' });
  });

  it('publishes cohort counts without exposing user identifiers', () => {
    const { getPublicPilotAccessSnapshot } = require('../../../services/pilot-access-control-service');
    const snapshot = getPublicPilotAccessSnapshot();

    expect(snapshot).toEqual(expect.objectContaining({
      pilotControlled: true,
      passengerCohortSize: 2,
      driverCohortSize: 2
    }));
    expect(JSON.stringify(snapshot)).not.toContain('passenger-1');
    expect(JSON.stringify(snapshot)).not.toContain('driver-1');
  });
});
