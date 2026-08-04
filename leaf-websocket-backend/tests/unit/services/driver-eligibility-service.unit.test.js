jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

function createSnapshot(value) {
  return {
    val: () => value,
    exists: () => value !== null && value !== undefined
  };
}

function createRealtimeDB(dataByPath) {
  return {
    ref: jest.fn((path) => ({
      once: jest.fn(async () => createSnapshot(dataByPath[path]))
    }))
  };
}

describe('driver-eligibility-service', () => {
  const originalEnv = { ...process.env };
  let redis;
  let driverEligibilityService;
  let redisPool;
  let firebaseConfig;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      LEAF_LAUNCH_PROFILE: 'full',
      LEAF_PILOT_CONTROLLED: 'false'
    };

    redis = {
      hgetall: jest.fn().mockResolvedValue({}),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      hincrby: jest.fn().mockResolvedValue(1)
    };

    redisPool = require('../../../utils/redis-pool');
    firebaseConfig = require('../../../firebase-config');

    redisPool.getConnection.mockReturnValue(redis);
    firebaseConfig.getRealtimeDB.mockReturnValue(createRealtimeDB({}));

    driverEligibilityService = require('../../../services/driver-eligibility-service');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects dispatch eligibility for a driver outside the assisted-launch cohort', async () => {
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';
    process.env.PILOT_ALLOWED_DRIVER_IDS = 'driver-allowed';

    const eligibility = await driverEligibilityService.isDriverEligibleForRide(
      'driver-outside',
      'Leaf Plus'
    );

    expect(eligibility).toEqual(expect.objectContaining({
      eligible: false,
      code: 'PILOT_COHORT_ACCESS_DENIED',
      profile: null
    }));
    expect(firebaseConfig.getRealtimeDB).not.toHaveBeenCalled();
  });

  it('prefers the approved active vehicle category over stale user carType', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'users/driver_1': {
          approved: true,
          kycStatus: 'approved',
          carType: 'Model 3',
          carPlate: 'TES8888'
        },
        'user_vehicles/driver_1': {
          uv_1: {
            vehicleId: 'vehicle_1',
            isActive: true,
            status: 'active',
            approved: true
          }
        },
        'vehicles/vehicle_1': {
          approved: true,
          carType: 'Leaf Plus',
          plate: 'LEF1234',
          make: 'Nissan',
          model: 'Leaf',
          color: 'Branco',
          ocrData: { source: 'crlv_pdf_ocr' }
        },
        'vehicle_active_assignment/vehicle_1': {
          driverId: 'driver_1',
          userId: 'driver_1',
          status: 'active'
        }
      })
    );

    const profile = await driverEligibilityService.resolveDriverProfile('driver_1', {
      carType: 'Model 3'
    });

    expect(profile.driverApproved).toBe(true);
    expect(profile.vehicleApproved).toBe(true);
    expect(profile.assignmentConflict).toBe(false);
    expect(profile.activeVehicleId).toBe('vehicle_1');
    expect(profile.carType).toBe('Leaf Plus');
    expect(profile.vehicleCategory).toBe('plus');
    expect(profile.vehiclePlate).toBe('LEF1234');
    expect(profile.vehicleMake).toBe('Nissan');
    expect(profile.vehicleModel).toBe('Leaf');
    expect(profile.vehicleColor).toBe('Branco');
    expect(profile.vehicleIdentitySource).toBe('crlv_pdf_ocr');
    expect(profile.vehicleIdentityCanonical).toBe(true);
    expect(profile.vehicleIdentityComplete).toBe(true);
  });

  it('normalizes visual vehicle models into operational carType labels', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'users/driver_3': {
          approved: true,
          kycStatus: 'approved',
          carType: 'Model 3'
        },
        'user_vehicles/driver_3': {
          uv_1: {
            vehicleId: 'vehicle_3',
            isActive: true,
            status: 'active',
            approved: true
          }
        },
        'vehicles/vehicle_3': {
          approved: true,
          carType: 'Model 3',
          category: 'plus',
          plate: 'TES3003'
        },
        'vehicle_active_assignment/vehicle_3': {
          driverId: 'driver_3',
          userId: 'driver_3',
          status: 'active'
        }
      })
    );

    const profile = await driverEligibilityService.resolveDriverProfile('driver_3', {
      carType: 'Model 3'
    });

    expect(profile.vehicleCategory).toBe('plus');
    expect(profile.carType).toBe('Leaf Plus');
    expect(profile.vehiclePlate).toBe('TES3003');
  });

  it('allows the same approved vehicle to be selected in another profile before the online lock', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'driver_activation/driver_2': {
          documents: {
            cnh: { status: 'approved' },
            crlv: {
              status: 'approved',
              data: {
                plate: 'LEF9999',
                renavam: '12345678901',
                model: 'Leaf Plus',
                color: 'PRETO'
              }
            }
          },
          consent: {
            backgroundCheck: { acceptedAt: '2026-06-24T12:00:00.000Z' }
          }
        },
        'users/driver_2': {
          approved: true,
          kycStatus: 'approved',
          kycFirstAccessVerifiedAt: '2026-06-24T12:00:00.000Z',
          carType: 'Leaf Plus'
        },
        'user_vehicles/driver_2': {
          uv_1: {
            vehicleId: 'vehicle_2',
            isActive: true,
            status: 'active',
            approved: true
          }
        },
        'vehicles/vehicle_2': {
          approved: true,
          carType: 'Leaf Plus',
          plate: 'LEF9999'
        },
        'vehicle_active_assignment/vehicle_2': {
          driverId: 'driver_other',
          userId: 'driver_other',
          status: 'active'
        }
      })
    );

    const eligibility = await driverEligibilityService.isDriverEligibleForRide(
      'driver_2',
      'Leaf Plus',
      { carType: 'Leaf Plus' }
    );

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.code).toBe('PLUS_MATCH');
    expect(eligibility.profile.assignmentConflict).toBe(false);
  });

  it('falls back to user_vehicles plate when vehicles document is missing or incomplete', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'users/driver_4': {
          approved: true,
          kycStatus: 'approved',
          carType: 'Leaf Plus'
        },
        'user_vehicles/driver_4': {
          uv_1: {
            vehicleId: 'vehicle_4',
            isActive: true,
            status: 'approved',
            approved: true,
            plate: 'TES4444'
          }
        },
        'vehicles/vehicle_4': {
          approved: true,
          carType: 'Leaf Plus'
        },
        'vehicle_active_assignment/vehicle_4': {
          driverId: 'driver_4',
          userId: 'driver_4',
          status: 'active'
        }
      })
    );

    const profile = await driverEligibilityService.resolveDriverProfile('driver_4', {
      carType: 'Leaf Plus'
    });

    expect(profile.driverApproved).toBe(true);
    expect(profile.vehicleApproved).toBe(true);
    expect(profile.assignmentConflict).toBe(false);
    expect(profile.activeVehicleId).toBe('vehicle_4');
    expect(profile.vehiclePlate).toBe('TES4444');
  });

  it('does not infer driver or vehicle approval from a missing canonical profile', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(createRealtimeDB({}));

    const profile = await driverEligibilityService.resolveDriverProfile('driver_missing_profile', {
      carType: 'Leaf Plus',
      vehiclePlate: 'MISS1234'
    });

    expect(profile.driverApproved).toBe(false);
    expect(profile.vehicleApproved).toBe(false);
    expect(profile.vehicleIdentitySource).toBe('runtime_fallback');
    expect(profile.vehiclePlate).toBe('MISS1234');
    expect(redis.hset).toHaveBeenCalledWith(
      'driver_eligibility_profile:driver_missing_profile',
      expect.objectContaining({
        driverApproved: 'false',
        vehicleApproved: 'false',
        vehicleIdentitySource: 'runtime_fallback'
      })
    );
  });

  it('treats legacy cache entries without explicit approval flags as blocked', async () => {
    redis.hgetall.mockResolvedValueOnce({
      driverId: 'driver_legacy_cache',
      vehicleCategory: 'plus',
      carType: 'Leaf Plus',
      vehiclePlate: 'CACHE123'
    });

    const profile = await driverEligibilityService.resolveDriverProfile('driver_legacy_cache');

    expect(profile.driverApproved).toBe(false);
    expect(profile.vehicleApproved).toBe(false);
    expect(profile.vehicleCategory).toBe('plus');
    expect(profile.vehiclePlate).toBe('CACHE123');
  });

  it('blocks ride eligibility during manual KYC review without classifying the driver as rejected', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'driver_activation/driver_kyc_review': {
          documents: {
            cnh: { status: 'approved' },
            crlv: { status: 'approved' }
          },
          consent: {
            backgroundCheck: { accepted: true }
          }
        },
        'users/driver_kyc_review': {
          approved: true,
          kycStatus: 'pending_review',
          kycFirstAccessVerifiedAt: '2026-07-21T20:00:00.000Z',
          carType: 'Leaf Plus'
        },
        'driver_activation/driver_kyc_review': {
          documents: {
            cnh: { status: 'approved' }
          },
          consent: {
            backgroundCheck: { acceptedAt: '2026-07-14T12:00:00.000Z' }
          }
        },
        'user_vehicles/driver_kyc_review': {
          uv_1: {
            vehicleId: 'vehicle_review',
            isActive: true,
            status: 'approved',
            approved: true
          }
        },
        'vehicles/vehicle_review': {
          approved: true,
          carType: 'Leaf Plus',
          plate: 'REV1234'
        },
        'vehicle_active_assignment/vehicle_review': {
          driverId: 'driver_kyc_review',
          userId: 'driver_kyc_review',
          status: 'active'
        }
      })
    );

    const eligibility = await driverEligibilityService.isDriverEligibleForRide(
      'driver_kyc_review',
      'Leaf Plus',
      { carType: 'Leaf Plus' }
    );

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.code).toBe('DRIVER_ACTIVATION_PRE_REGISTERED');
    expect(eligibility.activationState).toEqual(
      expect.objectContaining({
        canGoOnline: false,
        canAttemptOnline: false,
        kyc: expect.objectContaining({
          approved: false,
          blocked: false,
          pending: true,
          status: 'pending_review'
        })
      })
    );
  });

  it('allows the online attempt gate for reverification while keeping ride eligibility blocked', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'driver_activation/driver_reverify': {
          documents: {
            cnh: { status: 'approved' },
            crlv: {
              status: 'approved',
              data: {
                plate: 'REV2026',
                model: 'Leaf Plus',
                color: 'Branco'
              }
            }
          },
          consent: {
            backgroundCheck: { acceptedAt: '2026-07-25T12:00:00.000Z' }
          }
        },
        'users/driver_reverify': {
          approved: true,
          kycStatus: 'pending_reverify',
          kycReverifyRequired: true,
          kycFirstAccessVerifiedAt: '2026-07-21T20:00:00.000Z',
          carType: 'Leaf Plus'
        },
        'user_vehicles/driver_reverify': {
          uv_1: {
            vehicleId: 'vehicle_reverify',
            isActive: true,
            status: 'approved',
            approved: true
          }
        },
        'vehicles/vehicle_reverify': {
          approved: true,
          status: 'approved',
          carType: 'Leaf Plus',
          plate: 'REV2026',
          model: 'Leaf Plus',
          color: 'Branco'
        },
        'vehicle_active_assignment/vehicle_reverify': {
          driverId: 'driver_reverify',
          userId: 'driver_reverify',
          status: 'active'
        }
      })
    );

    const eligibility = await driverEligibilityService.isDriverEligibleForRide(
      'driver_reverify',
      'Leaf Plus',
      { carType: 'Leaf Plus' }
    );

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.code).toBe('KYC_LIVENESS_REQUIRED');
    expect(eligibility.activationState).toEqual(
      expect.objectContaining({
        state: 'APPROVED_NEEDS_LIVENESS',
        canGoOnline: false,
        canAttemptOnline: true,
        requiresLiveness: true
      })
    );
    expect(eligibility.profile).toBeNull();
  });

  it('blocks ride eligibility when an activation document is rejected', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(
      createRealtimeDB({
        'driver_activation/driver_doc_failed': {
          documents: {
            cnh: { status: 'failed' }
          }
        },
        'users/driver_doc_failed': {
          approved: true,
          kycStatus: 'approved',
          carType: 'Leaf Plus'
        },
        'user_vehicles/driver_doc_failed': {
          uv_1: {
            vehicleId: 'vehicle_doc_failed',
            isActive: true,
            status: 'approved',
            approved: true
          }
        },
        'vehicles/vehicle_doc_failed': {
          approved: true,
          carType: 'Leaf Plus',
          plate: 'DOC1234'
        },
        'vehicle_active_assignment/vehicle_doc_failed': {
          driverId: 'driver_doc_failed',
          userId: 'driver_doc_failed',
          status: 'active'
        }
      })
    );

    const eligibility = await driverEligibilityService.isDriverEligibleForRide(
      'driver_doc_failed',
      'Leaf Plus',
      { carType: 'Leaf Plus' }
    );

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.code).toBe('DRIVER_ACTIVATION_DRIVER_DOCS_PENDING');
    expect(eligibility.activationState).toEqual(
      expect.objectContaining({
        canGoOnline: false,
        documents: expect.objectContaining({
          cnh: 'failed'
        })
      })
    );
  });

  it('fails closed when the canonical activation state cannot be resolved', async () => {
    firebaseConfig.getRealtimeDB.mockReturnValue(null);

    const eligibility = await driverEligibilityService.isDriverEligibleForRide(
      'driver_unavailable_state',
      'Leaf Plus',
      { carType: 'Leaf Plus' }
    );

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.code).toBe('DRIVER_ACTIVATION_STATE_UNAVAILABLE');
    expect(eligibility.activationState).toEqual(
      expect.objectContaining({
        canGoOnline: false,
        blockingReason: 'Nao foi possivel validar cadastro, documentos e KYC agora.'
      })
    );
  });
});
