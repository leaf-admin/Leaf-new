import { resolveScreenRelativeVehicleHeading } from '../src/components/prototype/PrototypeMapLayer';

describe('prototype map vehicle heading', () => {
  it('keeps a projected vehicle aligned with the route when navigation rotates the map', () => {
    expect(resolveScreenRelativeVehicleHeading(128, 128)).toBe(0);
    expect(resolveScreenRelativeVehicleHeading(188, 128)).toBe(60);
  });

  it('normalizes turn wrap-around and safely handles missing vehicle heading', () => {
    expect(resolveScreenRelativeVehicleHeading(12, 348)).toBe(24);
    expect(resolveScreenRelativeVehicleHeading(null, 90)).toBe(0);
  });
});
