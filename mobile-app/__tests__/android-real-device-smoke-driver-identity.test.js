const {
  compareRenderedVehicleIdentity,
  evaluateManagedDriverVehicleIdentity,
  managedDriverBlockFailure,
  managedDriverPaymentBlockStatus,
} = require('../scripts/qa/real-smoke-driver-identity.cjs');

describe('android real-device smoke driver identity guard', () => {
  it('accepts complete canonical CRLV identity', () => {
    expect(evaluateManagedDriverVehicleIdentity({
      vehicleIdentity: {
        activeVehicleId: 'vehicle_1',
        plate: 'RJA2D41',
        make: 'Honda',
        model: 'City',
        color: 'BRANCO',
        source: 'crlv_pdf_ocr',
        canonical: true,
      },
    })).toEqual(expect.objectContaining({
      ok: true,
      code: 'driver_vehicle_identity_ready',
      missingFields: [],
    }));
  });

  it('accepts an explicitly labeled QA CRLV fixture for managed test users', () => {
    expect(evaluateManagedDriverVehicleIdentity({
      vehicleIdentity: {
        plate: 'TES6789',
        model: 'Prius',
        color: 'PRETO',
        source: 'qa_crlv_fixture',
        canonical: true,
      },
    })).toEqual(expect.objectContaining({
      ok: true,
      code: 'driver_vehicle_identity_ready',
    }));
  });

  it('blocks before payment when CRLV color is missing', () => {
    const result = evaluateManagedDriverVehicleIdentity({
      vehicleIdentity: {
        plate: 'RJA2D41',
        model: 'City',
        source: 'crlv_pdf_ocr',
        canonical: true,
      },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: 'driver_vehicle_identity_incomplete',
      missingFields: ['color'],
    }));
    expect(managedDriverBlockFailure(result.code)).toBe(
      'blocked_precondition:driver_vehicle_identity_incomplete'
    );
    expect(managedDriverPaymentBlockStatus(result.code)).toBe(
      'blocked_precondition_driver_vehicle_identity_incomplete'
    );
  });

  it('rejects a complete legacy identity when CRLV provenance is required', () => {
    expect(evaluateManagedDriverVehicleIdentity({
      vehicleIdentity: {
        plate: 'RJA2D41',
        model: 'City',
        color: 'BRANCO',
        source: 'user_profile_legacy',
        canonical: false,
      },
    })).toEqual(expect.objectContaining({
      ok: false,
      code: 'driver_vehicle_identity_not_canonical',
    }));
  });

  it('detects vehicle identity drift between the canonical driver and UI stages', () => {
    const result = compareRenderedVehicleIdentity(
      { plate: 'RJA2D41', model: 'Honda City', color: 'BRANCO' },
      [
        {
          step: '10-active-trip',
          screen: 'passenger_active_trip',
          plate: 'RJA-2D41',
          model: 'Honda City',
          color: 'Prata',
        },
      ],
    );

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      expect.objectContaining({ field: 'color', expected: 'BRANCO', actual: 'Prata' }),
    ]);
  });
});
