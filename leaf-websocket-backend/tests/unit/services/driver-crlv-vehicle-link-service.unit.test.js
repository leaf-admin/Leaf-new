'use strict';

const {
  buildApprovedCrlvVehicleLinkUpdates,
  materializeApprovedCrlvVehicleLink
} = require('../../../services/driver-crlv-vehicle-link-service');
const { createTreeFirestore } = require('../../helpers/rtdb-tree-firestore');

// Firestore over an RTDB-shaped tree built from { 'root/key': value } fixtures;
// `reads` lists each document (or whole collection) read, by RTDB path.
function createDb(dataByPath = {}) {
  const tree = {};
  for (const [path, value] of Object.entries(dataByPath)) {
    const parts = path.split('/');
    let cursor = tree;
    parts.slice(0, -1).forEach((part) => { cursor = cursor[part] || (cursor[part] = {}); });
    cursor[parts[parts.length - 1]] = value;
  }
  const reads = [];
  const access = {
    read(path) {
      reads.push(path);
      const value = path.split('/').reduce((cursor, part) => cursor?.[part], tree);
      return value === undefined ? null : JSON.parse(JSON.stringify(value));
    },
    write(path, value) {
      const parts = path.split('/');
      let cursor = tree;
      parts.slice(0, -1).forEach((part) => { cursor = cursor[part] || (cursor[part] = {}); });
      if (value === null) delete cursor[parts[parts.length - 1]];
      else cursor[parts[parts.length - 1]] = value;
    }
  };
  return Object.assign(createTreeFirestore(access), { reads, tree });
}

const approvedCrlv = {
  placa: 'rja-2d41',
  modelo: 'Honda City',
  cor: 'branca',
  anoModelo: '2024',
  renavam: '123.456.789-00'
};

describe('driver-crlv-vehicle-link-service', () => {
  it('creates a deterministic canonical catalog and a pending inactive driver link', async () => {
    const db = createDb();

    const result = await buildApprovedCrlvVehicleLinkUpdates({
      firestore: db,
      driverId: 'driver_1',
      crlvData: approvedCrlv,
      submissionId: 'submission_1',
      extractionSource: 'pdf_text',
      model: 'test-model',
      updatedAt: '2026-07-15T01:00:00.000Z'
    });

    expect(result).toMatchObject({
      vehicleId: 'vehicle_crlv_RJA2D41',
      userVehicleId: 'crlv_RJA2D41',
      createdCatalog: true,
      createdLink: true
    });
    expect(result.updates).toEqual(expect.objectContaining({
      'vehicle_plate_index/RJA2D41': 'vehicle_crlv_RJA2D41',
      'vehicles/vehicle_crlv_RJA2D41/plate': 'RJA2D41',
      'vehicles/vehicle_crlv_RJA2D41/model': 'Honda City',
      'vehicles/vehicle_crlv_RJA2D41/color': 'BRANCO',
      'vehicles/vehicle_crlv_RJA2D41/status': 'idle',
      'user_vehicles/driver_1/crlv_RJA2D41/vehicleId': 'vehicle_crlv_RJA2D41',
      'user_vehicles/driver_1/crlv_RJA2D41/status': 'pending',
      'user_vehicles/driver_1/crlv_RJA2D41/approved': false,
      'user_vehicles/driver_1/crlv_RJA2D41/isActive': false
    }));
  });

  it('materializes only the canonical vehicle patch for backfill callers', async () => {
    const db = createDb();

    const result = await materializeApprovedCrlvVehicleLink({
      firestore: db,
      driverId: 'driver_1',
      crlvData: approvedCrlv,
      submissionId: 'submission_1'
    });

    expect(db.commits).toHaveLength(1);
    expect(db.commits[0]).toEqual(result.updates);
    expect(Object.keys(result.updates).some((path) => path.startsWith('driver_activation/'))).toBe(false);
    expect(Object.keys(result.updates).some((path) => path.startsWith('users/driver_1/documents/'))).toBe(false);
  });

  it('reuses a shared indexed catalog but creates a fresh pending link for this driver', async () => {
    const db = createDb({
      'vehicle_plate_index/RJA2D41': 'shared_vehicle_1',
      'user_vehicles/driver_2': {},
      'vehicles/shared_vehicle_1': {
        id: 'shared_vehicle_1',
        plate: 'RJA2D41',
        model: 'Honda City',
        color: 'BRANCO'
      }
    });

    const result = await buildApprovedCrlvVehicleLinkUpdates({
      firestore: db,
      driverId: 'driver_2',
      crlvData: approvedCrlv
    });

    expect(result).toMatchObject({
      vehicleId: 'shared_vehicle_1',
      createdCatalog: false,
      createdLink: true
    });
    expect(result.updates).toEqual(expect.objectContaining({
      'user_vehicles/driver_2/crlv_RJA2D41/status': 'pending',
      'user_vehicles/driver_2/crlv_RJA2D41/isActive': false
    }));
    expect(Object.keys(result.updates)).not.toContain('vehicles/shared_vehicle_1/createdAt');
    expect(db.reads).not.toContain('vehicles');
  });

  it('preserves approved and active flags when the same driver resends the same plate', async () => {
    const db = createDb({
      'vehicle_plate_index/RJA2D41': 'vehicle_1',
      'user_vehicles/driver_1': {
        link_1: {
          id: 'link_1',
          vehicleId: 'vehicle_1',
          plate: 'RJA2D41',
          status: 'approved',
          approved: true,
          isActive: true
        }
      },
      'vehicles/vehicle_1': {
        id: 'vehicle_1',
        plate: 'RJA2D41',
        model: 'Honda City',
        color: 'BRANCO'
      }
    });

    const result = await buildApprovedCrlvVehicleLinkUpdates({
      firestore: db,
      driverId: 'driver_1',
      crlvData: approvedCrlv
    });

    expect(result).toMatchObject({
      vehicleId: 'vehicle_1',
      userVehicleId: 'link_1',
      createdCatalog: false,
      createdLink: false
    });
    expect(result.updates['user_vehicles/driver_1/link_1/status']).toBeUndefined();
    expect(result.updates['user_vehicles/driver_1/link_1/approved']).toBeUndefined();
    expect(result.updates['user_vehicles/driver_1/link_1/isActive']).toBeUndefined();
    expect(result.updates['user_vehicles/driver_1/link_1/model']).toBe('Honda City');
  });

  it('upgrades a same-plate legacy link that has no canonical vehicleId', async () => {
    const db = createDb({
      'user_vehicles/driver_1': {
        legacy_link: {
          id: 'legacy_link',
          plate: 'RJA2D41',
          status: 'approved',
          approved: true,
          isActive: true
        }
      }
    });

    const result = await buildApprovedCrlvVehicleLinkUpdates({
      firestore: db,
      driverId: 'driver_1',
      crlvData: approvedCrlv
    });

    expect(result).toMatchObject({
      vehicleId: 'vehicle_crlv_RJA2D41',
      userVehicleId: 'legacy_link',
      createdLink: false
    });
    expect(result.updates['user_vehicles/driver_1/legacy_link/vehicleId']).toBe('vehicle_crlv_RJA2D41');
    expect(result.updates['user_vehicles/driver_1/legacy_link/status']).toBeUndefined();
    expect(result.updates['user_vehicles/driver_1/legacy_link/isActive']).toBeUndefined();
  });

  it('fails closed when the plate index points to a catalog record with another plate', async () => {
    const db = createDb({
      'vehicle_plate_index/RJA2D41': 'vehicle_wrong',
      'user_vehicles/driver_1': {},
      'vehicles/vehicle_wrong': {
        plate: 'XYZ9Z99',
        model: 'Outro carro',
        color: 'PRETO'
      }
    });

    await expect(buildApprovedCrlvVehicleLinkUpdates({
      firestore: db,
      driverId: 'driver_1',
      crlvData: approvedCrlv
    })).rejects.toThrow('CRLV_VEHICLE_INDEX_CONFLICT');
    expect(db.reads).not.toContain('vehicles');
  });

  it('does not preserve an approved active link whose own plate differs from the CRLV', async () => {
    const db = createDb({
      'vehicle_plate_index/RJA2D41': 'vehicle_1',
      'user_vehicles/driver_1': {
        link_1: {
          vehicleId: 'vehicle_1',
          plate: 'XYZ9Z99',
          status: 'approved',
          approved: true,
          isActive: true
        }
      },
      'vehicles/vehicle_1': {
        plate: 'RJA2D41',
        model: 'Honda City',
        color: 'BRANCO'
      }
    });

    await expect(buildApprovedCrlvVehicleLinkUpdates({
      firestore: db,
      driverId: 'driver_1',
      crlvData: approvedCrlv
    })).rejects.toThrow('CRLV_VEHICLE_LINK_CONFLICT');
  });

  it('does not create a fifth link automatically', async () => {
    const db = createDb({
      'user_vehicles/driver_1': {
        link_1: { vehicleId: 'vehicle_1' },
        link_2: { vehicleId: 'vehicle_2' },
        link_3: { vehicleId: 'vehicle_3' },
        link_4: { vehicleId: 'vehicle_4' }
      }
    });

    await expect(buildApprovedCrlvVehicleLinkUpdates({
      firestore: db,
      driverId: 'driver_1',
      crlvData: approvedCrlv
    })).rejects.toThrow('CRLV_VEHICLE_PROFILE_LIMIT_REACHED');
  });
});
