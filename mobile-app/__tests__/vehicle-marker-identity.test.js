import { resolveRegisteredVehicleColor } from '../src/components/prototype/vehicleMarkerIdentity';

describe('Registered map vehicle identity', () => {
  it('uses the server active catalog vehicle over stale profile and route data', () => {
    const identity = { role: 'driver', profile: { vehicleColor: 'Preto' }, routeParams: { vehicleColor: 'Azul' } };
    expect(resolveRegisteredVehicleColor({ ...identity, driverActivationRemote: { vehicle: { color: 'Prata' } } })).toBe('Prata');
    expect(resolveRegisteredVehicleColor({ ...identity, driverActivationRemote: { vehicle: { color: 'Branco' } } })).toBe('Branco');
  });
  it('preserves the active ride vehicle before a new catalog selection', () => {
    expect(resolveRegisteredVehicleColor({ role: 'driver', driverActiveRide: { status: 'started', vehicleColor: 'Vermelho' },
      driverActivationRemote: { vehicle: { color: 'Azul' } } })).toBe('Vermelho');
  });
  it('does not reuse a completed trip color after switching vehicles', () => {
    expect(resolveRegisteredVehicleColor({ role: 'driver', activeBooking: { status: 'completed', vehicleColor: 'Preto' },
      driverTripMeta: { vehicleColor: 'Preto' }, driverActivationRemote: { vehicle: { color: 'Bege' } } })).toBe('Bege');
  });
  it('takes passenger identity from the current Leaf driver payload before old route params', () => {
    expect(resolveRegisteredVehicleColor({ operationalDriverInfo: { vehicle: { color: 'Marrom' } },
      routeParams: { vehicleColor: 'Branco' } })).toBe('Marrom');
    expect(resolveRegisteredVehicleColor({ driverInfo: { color: '—', vehicleColor: 'Verde' } })).toBe('Verde');
    expect(resolveRegisteredVehicleColor({ profile: { vehicleColor: 'Azul' } })).toBe('');
  });
});
