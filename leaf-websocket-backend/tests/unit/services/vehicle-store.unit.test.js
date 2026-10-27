const { createTreeFirestore } = require('../../helpers/rtdb-tree-firestore');
const vehicleStore = require('../../../services/vehicle-store');

// Fixtures are the RTDB roots the router served (vehicles, user_vehicles,
// vehicle_plate_index, users); the tree adapter maps the native collections.
function seed() {
  return {
    vehicles: { v1: { plate: 'ABC1D23', model: 'Leaf', status: 'idle' } },
    user_vehicles: { d1: { l1: { vehicleId: 'v1', isActive: true }, l2: { vehicleId: 'v2', isActive: false } } },
    vehicle_plate_index: { ABC1D23: 'v1' },
    users: { d1: { usertype: 'driver', activeVehicleId: 'v1' } }
  };
}

describe('vehicle-store reads', () => {
  it('reads the catalog, the driver links and the plate index', async () => {
    const firestore = createTreeFirestore(seed());
    await expect(vehicleStore.readVehicle(firestore, 'v1')).resolves.toEqual({ plate: 'ABC1D23', model: 'Leaf', status: 'idle' });
    await expect(vehicleStore.readVehicle(firestore, 'missing')).resolves.toBeNull();
    await expect(vehicleStore.readVehicleLinks(firestore, 'd1')).resolves.toEqual({
      l1: { vehicleId: 'v1', isActive: true },
      l2: { vehicleId: 'v2', isActive: false }
    });
    await expect(vehicleStore.readPlateIndex(firestore, 'ABC1D23')).resolves.toBe('v1');
    await expect(vehicleStore.readPlateIndex(firestore, 'ZZZ9Z99')).resolves.toBeNull();
    await expect(vehicleStore.listVehicles(firestore)).resolves.toEqual({ v1: { plate: 'ABC1D23', model: 'Leaf', status: 'idle' } });
    await expect(vehicleStore.listVehicleLinks(firestore)).resolves.toEqual({ d1: seed().user_vehicles.d1 });
  });

  it('refuses to read without Firestore', async () => {
    await expect(vehicleStore.readVehicle(null, 'v1')).rejects.toMatchObject({ code: 'VEHICLE_STORE_UNAVAILABLE' });
  });
});

describe('vehicle-store commitUpdates', () => {
  it('applies a multi-root update in one transaction', async () => {
    const state = seed();
    const firestore = createTreeFirestore(state);
    await vehicleStore.commitUpdates(firestore, {
      'vehicles/v2': { id: 'v2', plate: 'DEF4G56', status: 'idle' },
      'vehicle_plate_index/DEF4G56': 'v2',
      'user_vehicles/d1/l1/isActive': false,
      'user_vehicles/d1/l2/isActive': true,
      'user_vehicles/d1/l3': { vehicleId: 'v3', status: 'pending' },
      'users/d1/activeVehicleId': 'v2'
    });
    expect(firestore.commits).toHaveLength(1);
    expect(state.vehicles.v2).toEqual({ id: 'v2', plate: 'DEF4G56', status: 'idle' });
    expect(state.vehicle_plate_index.DEF4G56).toBe('v2');
    expect(state.user_vehicles.d1).toEqual({
      l1: { vehicleId: 'v1', isActive: false },
      l2: { vehicleId: 'v2', isActive: true },
      l3: { vehicleId: 'v3', status: 'pending' }
    });
    expect(state.users.d1).toEqual({ usertype: 'driver', activeVehicleId: 'v2' });
  });

  it('replaces a whole catalog record and deletes a link with null', async () => {
    const state = seed();
    const firestore = createTreeFirestore(state);
    await vehicleStore.commitUpdates(firestore, {
      'vehicles/v1': { plate: 'ABC1D23', status: 'blocked' },
      'user_vehicles/d1/l2': null
    });
    expect(state.vehicles.v1).toEqual({ plate: 'ABC1D23', status: 'blocked' });
    expect(state.user_vehicles.d1).toEqual({ l1: { vehicleId: 'v1', isActive: true } });

    // The driver's last link gone: the record is deleted, as the router did.
    await vehicleStore.commitUpdates(firestore, { 'user_vehicles/d1/l1': null });
    expect(state.user_vehicles.d1).toBeUndefined();
    expect(firestore.commits[firestore.commits.length - 1]).toEqual({ 'user_vehicles/d1': null });
  });

  it('never replaces the canonical users record or writes an unknown root', async () => {
    const firestore = createTreeFirestore(seed());
    await expect(vehicleStore.commitUpdates(firestore, { 'users/d1': { usertype: 'driver' } }))
      .rejects.toMatchObject({ code: 'DRIVER_DOCUMENT_STORE_CANONICAL_SET' });
    await expect(vehicleStore.commitUpdates(firestore, { 'bookings/b1/status': 'x' }))
      .rejects.toMatchObject({ code: 'DRIVER_DOCUMENT_STORE_INVALID_FIELD' });
    expect(firestore.commits).toHaveLength(0);
  });
});
