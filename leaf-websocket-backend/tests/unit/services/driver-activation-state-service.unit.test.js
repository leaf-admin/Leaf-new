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
  it('nao libera motorista aprovado no fluxo legado sem documentos canonicos', async () => {
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

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.PRE_REGISTERED);
    expect(result.canGoOnline).toBe(false);
    expect(result.canAttemptOnline).toBe(false);
    expect(result.checklist.backgroundCheckConsent).toBe(false);
    expect(result.checklist.cnhEar).toBe(false);
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

  it('expõe a identidade normalizada do CRLV sem liberar operação sem veículo aprovado', async () => {
    const driverId = 'driver_crlv_identity';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {}
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: {
        documents: {
          cnh: { status: 'approved' },
          crlv: {
            status: 'approved',
            data: {
              placa: 'rja-2d41',
              modelo: 'Honda City',
              cor: 'branca',
              anoModelo: '2024',
              renavam: '12345678900'
            }
          }
        },
        consent: {
          backgroundCheck: { accepted: true }
        }
      },
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-06-21T10:00:00.000Z'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canGoOnline).toBe(false);
    expect(result.vehicle).toEqual(expect.objectContaining({
      approved: false,
      plate: 'RJA2D41',
      model: 'Honda City',
      color: 'BRANCO',
      year: '2024',
      documentStatus: 'approved',
      identitySource: 'crlv_pdf_ocr',
      identityComplete: true
    }));
  });
});
