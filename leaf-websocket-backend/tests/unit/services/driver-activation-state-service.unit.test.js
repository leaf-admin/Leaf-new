const {
  resolveDriverActivationState,
  DRIVER_ACTIVATION_STATES
} = require('../../../services/driver-activation-state-service');

function createMockDb(dataByPath = {}) {
  return {
    ref(path) {
      return {
        once: async () => ({
          val: () => dataByPath[path] || null
        })
      };
    }
  };
}

describe('driver-activation-state-service', () => {
  it('libera motorista aprovado no fluxo legado para ficar online', async () => {
    const driverId = 'driver_legacy_approved';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: {
          id: 'vehicleA',
          vehicleId: 'vehicleA',
          approved: true,
          status: 'approved',
          isActive: true
        }
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: {},
      userData: {
        approved: true,
        status: 'approved',
        kyc_status: 'approved',
        activeVehicleId: 'vehicleA'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.ACTIVE);
    expect(result.canGoOnline).toBe(true);
    expect(result.canAttemptOnline).toBe(true);
    expect(result.checklist.backgroundCheckConsent).toBe(true);
  });

  it('mantem bloqueio quando existe documento rejeitado mesmo com approved=true', async () => {
    const driverId = 'driver_rejected_doc';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: {
          id: 'vehicleA',
          vehicleId: 'vehicleA',
          approved: true,
          status: 'approved',
          isActive: true
        }
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: {
        documents: {
          cnh: { status: 'failed' }
        }
      },
      userData: {
        approved: true,
        status: 'approved',
        kyc_status: 'approved',
        activeVehicleId: 'vehicleA'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.DRIVER_DOCS_PENDING);
    expect(result.canGoOnline).toBe(false);
  });

  it('bloqueia online quando KYC esta reprovado mesmo com documentos e veiculo aprovados', async () => {
    const driverId = 'driver_kyc_rejected';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: {
          id: 'vehicleA',
          vehicleId: 'vehicleA',
          approved: true,
          status: 'approved',
          isActive: true
        }
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: {},
      userData: {
        approved: true,
        status: 'approved',
        kycStatus: 'rejected',
        kycFirstAccessVerifiedAt: '2026-05-14T10:00:00.000Z',
        activeVehicleId: 'vehicleA'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.REJECTED);
    expect(result.canGoOnline).toBe(false);
    expect(result.kyc).toEqual(
      expect.objectContaining({
        blocked: true,
        status: 'rejected'
      })
    );
  });
});
