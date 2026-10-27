const { createTreeFirestore } = require('../../helpers/rtdb-tree-firestore');
const { writesFor, commitPaths } = require('../../../scripts/lib/native-path-writes.cjs');

describe('scripts native path writes (RTDB retired)', () => {
  it('maps RTDB-style paths to the native collections', () => {
    expect(writesFor({
      'users/u1/documents/cnh': { status: 'approved' },
      'driver_activation/u1/consent/backgroundCheck': { accepted: true },
      'vehicles/v1': { id: 'v1' },
      'user_vehicles/u1/link1/isActive': true,
      'vehicle_plate_index/ABC1D23': 'v1'
    })).toEqual(expect.arrayContaining([
      { collection: 'users', id: 'u1', field: ['documents', 'cnh'], value: { status: 'approved' } },
      { collection: 'driver_activation', id: 'u1', field: ['consent', 'backgroundCheck'], value: { accepted: true } },
      { collection: 'vehicle_catalog', id: 'v1', field: [], value: { id: 'v1' } },
      { collection: 'driver_vehicle_links', id: 'u1', field: ['link1', 'isActive'], value: true },
      { collection: 'vehicle_plate_index', id: 'ABC1D23', field: [], value: 'v1' }
    ]));
  });

  it('refuses roots that no longer exist', () => {
    expect(() => writesFor({ 'vehicle_active_assignment/v1': { userId: 'u1' } })).toThrow();
    expect(() => writesFor({ 'driver_activation': { x: 1 } })).toThrow();
  });

  it('applies the update in one commit with RTDB update semantics', async () => {
    const state = {
      users: { u1: { name: 'Driver', documents: { cnh: { status: 'pending', stale: true }, crlv: { status: 'pending' } } } }
    };
    const firestore = createTreeFirestore(state);

    await expect(commitPaths(firestore, {
      'users/u1/documents/cnh': { status: 'approved' },
      'users/u1/kycStatus': 'approved',
      'driver_activation/u1/status/canGoOnline': true,
      'vehicles/v1': { id: 'v1', plate: 'ABC1D23' }
    })).resolves.toBe(4);

    expect(firestore.commits).toHaveLength(1);
    expect(state.users.u1).toEqual({
      name: 'Driver',
      kycStatus: 'approved',
      documents: { cnh: { status: 'approved' }, crlv: { status: 'pending' } }
    });
    expect(state.driver_activation.u1).toEqual({ status: { canGoOnline: true } });
    expect(state.vehicles.v1).toEqual({ id: 'v1', plate: 'ABC1D23' });
    await expect(commitPaths(firestore, {})).resolves.toBe(0);
  });
});
