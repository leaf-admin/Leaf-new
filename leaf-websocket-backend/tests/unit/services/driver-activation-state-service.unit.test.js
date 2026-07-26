const {
  resolveDriverActivationState,
  DRIVER_ACTIVATION_STATES
} = require('../../../services/driver-activation-state-service');

function createMockDb(dataByPath = {}, errorPaths = []) {
  const failingPaths = new Set(errorPaths);

  return {
    ref(path) {
      return {
        once: async () => {
          if (failingPaths.has(path)) {
            throw new Error(`read_failed:${path}`);
          }

          return {
            val: () => dataByPath[path] || null
          };
        }
      };
    }
  };
}

function createApprovedVehicle(overrides = {}) {
  return {
    id: 'vehicleA',
    vehicleId: 'vehicleA',
    approved: true,
    status: 'approved',
    isActive: true,
    plate: 'RJA2D41',
    model: 'Honda City',
    color: 'BRANCO',
    ...overrides
  };
}

function createCatalogVehicle(overrides = {}) {
  return {
    plate: 'RJA2D41',
    model: 'Honda City',
    color: 'BRANCO',
    ...overrides
  };
}

function createApprovedActivation(overrides = {}) {
  const { documents: documentOverrides = {}, ...activationOverrides } = overrides;

  return {
    documents: {
      cnh: { status: 'approved' },
      crlv: {
        status: 'approved',
        data: {
          placa: 'RJA2D41',
          modelo: 'Honda City',
          cor: 'branca'
        }
      },
      ...documentOverrides
    },
    consent: {
      backgroundCheck: { accepted: true }
    },
    ...activationOverrides
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

  it('classifica conta nova sem KYC como pre-cadastro, sem confundir ausencia com rejeicao', async () => {
    const driverId = 'driver_auth_only';
    const result = await resolveDriverActivationState({
      driverId,
      db: createMockDb(),
      activationNode: {},
      userData: {}
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.PRE_REGISTERED);
    expect(result.canGoOnline).toBe(false);
    expect(result.canAttemptOnline).toBe(false);
    expect(result.vehicle.documentStatus).toBeNull();
    expect(result.kyc).toEqual(
      expect.objectContaining({
        approved: false,
        blocked: false,
        pending: true,
        status: 'missing'
      })
    );
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

  it.each([
    ['blocked', { kycStatus: 'blocked' }, 'blocked'],
    ['rejected', { kycStatus: 'rejected' }, 'rejected'],
    ['failed', { kycStatus: 'failed' }, 'failed'],
    ['denied', { kycStatus: 'denied' }, 'denied'],
    ['flag kycBlocked', { kycStatus: 'approved', kycBlocked: true }, 'blocked']
  ])(
    'mantem KYC terminal %s como rejeicao mesmo com documentos e veiculo aprovados',
    async (_label, kycData, expectedStatus) => {
      const driverId = `driver_kyc_${expectedStatus}`;
      const db = createMockDb({
        [`user_vehicles/${driverId}`]: {
          vehicleA: createApprovedVehicle()
        },
        'vehicles/vehicleA': createCatalogVehicle()
      });

      const result = await resolveDriverActivationState({
        driverId,
        db,
        activationNode: createApprovedActivation(),
        userData: {
          approved: true,
          status: 'approved',
          kycFirstAccessVerifiedAt: '2026-05-14T10:00:00.000Z',
          activeVehicleId: 'vehicleA',
          ...kycData
        }
      });

      expect(result.state).toBe(DRIVER_ACTIVATION_STATES.REJECTED);
      expect(result.canGoOnline).toBe(false);
      expect(result.kyc).toEqual(
        expect.objectContaining({
          blocked: true,
          pending: false,
          status: expectedStatus
        })
      );
    }
  );

  it.each([
    ['ausente', {}, 'missing'],
    ['pending', { kycStatus: 'pending' }, 'pending'],
    ['pending_review', { kycStatus: 'pending_review' }, 'pending_review'],
    ['in_review', { kycStatus: 'in_review' }, 'in_review'],
    ['review', { kycStatus: 'review' }, 'review'],
    ['pending_reverify sem flag canonica', { kycStatus: 'pending_reverify' }, 'pending_reverify'],
    ['pending contraditorio', { kycStatus: 'pending', kyc: { approved: true } }, 'pending'],
  ])(
    'mantem KYC nao terminal %s em analise e impede veiculo, liveness ou ACTIVE',
    async (_label, kycData, expectedStatus) => {
      const driverId = `driver_kyc_non_terminal_${expectedStatus}`;
      const db = createMockDb({
        [`user_vehicles/${driverId}`]: {
          vehicleA: createApprovedVehicle()
        },
        'vehicles/vehicleA': createCatalogVehicle()
      });

      const result = await resolveDriverActivationState({
        driverId,
        db,
        activationNode: createApprovedActivation(),
        userData: {
          status: 'approved',
          kycFirstAccessVerifiedAt: '2026-05-14T10:00:00.000Z',
          ...kycData
        }
      });

      expect(result.state).toBe(DRIVER_ACTIVATION_STATES.DRIVER_DOCS_IN_REVIEW);
      expect(result.canGoOnline).toBe(false);
      expect(result.canAttemptOnline).toBe(false);
      expect(result.requiresLiveness).toBe(false);
      expect(result.kyc).toEqual(
        expect.objectContaining({
          approved: false,
          blocked: false,
          pending: true,
          status: expectedStatus
        })
      );
    }
  );

  it('permite iniciar somente a revalidacao facial com flag canonica e gates anteriores aprovados', async () => {
    const driverId = 'driver_kyc_reverification_required';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle()
      },
      'vehicles/vehicleA': createCatalogVehicle()
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        status: 'approved',
        kycStatus: 'pending_reverify',
        kycReverifyRequired: true,
        kycFirstAccessVerifiedAt: '2026-05-14T10:00:00.000Z'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.APPROVED_NEEDS_LIVENESS);
    expect(result.canGoOnline).toBe(false);
    expect(result.canAttemptOnline).toBe(true);
    expect(result.requiresLiveness).toBe(true);
    expect(result.blockingReason).toBe(
      'Revalidacao facial obrigatoria antes de ficar online.'
    );
    expect(result.kyc).toEqual(
      expect.objectContaining({
        approved: false,
        blocked: false,
        pending: true,
        status: 'pending_reverify',
        reverifyRequired: true
      })
    );
  });

  it('nao permite iniciar a revalidacao antes da aprovacao canonica do veiculo', async () => {
    const driverId = 'driver_kyc_reverification_vehicle_pending';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {}
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        status: 'approved',
        kycStatus: 'pending_reverify',
        kycReverifyRequired: true,
        kycFirstAccessVerifiedAt: '2026-05-14T10:00:00.000Z'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canGoOnline).toBe(false);
    expect(result.canAttemptOnline).toBe(false);
    expect(result.requiresLiveness).toBe(false);
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
      identityComplete: false,
      displayIdentityComplete: true,
      canonicalPlate: '',
      crlvPlateMatch: false
    }));
  });

  it('nao avanca para liveness enquanto o CRLV nao estiver aprovado', async () => {
    const driverId = 'driver_crlv_in_review';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle()
      },
      'vehicles/vehicleA': createCatalogVehicle()
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation({
        documents: {
          crlv: {
            status: 'in_review',
            data: {
              placa: 'RJA2D41',
              modelo: 'Honda City',
              cor: 'branca'
            }
          }
        }
      }),
      userData: { kycStatus: 'approved' }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_IN_REVIEW);
    expect(result.canAttemptOnline).toBe(false);
    expect(result.checklist.vehicleRegistration).toBe(false);
    expect(result.vehicle).toEqual(expect.objectContaining({
      approved: true,
      active: true,
      identityComplete: true
    }));
  });

  it('nao avanca para liveness com veiculo aprovado mas inativo', async () => {
    const driverId = 'driver_vehicle_inactive';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle({ isActive: false })
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: { kycStatus: 'approved' }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canAttemptOnline).toBe(false);
    expect(result.checklist.vehicleRegistration).toBe(false);
    expect(result.vehicle).toEqual(expect.objectContaining({
      approved: true,
      active: false,
      identityComplete: false,
      canonicalRecordReady: false
    }));
  });

  it('nao avanca para liveness sem identidade completa do veiculo', async () => {
    const driverId = 'driver_vehicle_identity_incomplete';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle({ color: undefined })
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation({
        documents: {
          crlv: {
            status: 'approved',
            data: {
              placa: 'RJA2D41',
              modelo: 'Honda City'
            }
          }
        }
      }),
      userData: { kycStatus: 'approved' }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canAttemptOnline).toBe(false);
    expect(result.checklist.vehicleRegistration).toBe(false);
    expect(result.vehicle).toEqual(expect.objectContaining({
      approved: true,
      active: true,
      identityComplete: false
    }));
  });

  it('nao presume aprovacao de veiculo legado apenas por existir placa no perfil', async () => {
    const driverId = 'driver_legacy_vehicle_without_approval';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {}
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        kycStatus: 'approved',
        activeVehicleId: 'legacyVehicle',
        vehiclePlate: 'RJA2D41',
        vehicleModel: 'Honda City',
        vehicleColor: 'BRANCO'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canAttemptOnline).toBe(false);
    expect(result.checklist.vehicleRegistration).toBe(false);
    expect(result.vehicle).toEqual(expect.objectContaining({
      approved: false,
      active: false,
      identityComplete: false,
      displayIdentityComplete: true,
      identitySource: 'crlv_pdf_ocr'
    }));
  });

  it('nao aceita vehicleApproved legado sem entrada canonica em user_vehicles', async () => {
    const driverId = 'driver_legacy_vehicle_approved_bypass';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {}
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z',
        activeVehicleId: 'legacyVehicle',
        vehicleApproved: true,
        carApproved: true,
        vehiclePlate: 'RJA2D41',
        vehicleModel: 'Honda City',
        vehicleColor: 'BRANCO'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canGoOnline).toBe(false);
    expect(result.checklist.vehicleRegistration).toBe(false);
    expect(result.vehicle).toEqual(expect.objectContaining({
      approved: false,
      active: false,
      vehicleId: null,
      crlvPlateMatch: false
    }));
  });

  it('bloqueia quando a placa do CRLV aprovado diverge do veiculo canonico ativo', async () => {
    const driverId = 'driver_crlv_vehicle_plate_mismatch';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle()
      },
      'vehicles/vehicleA': {
        plate: 'ABC1D23',
        model: 'Honda City',
        color: 'BRANCO'
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canGoOnline).toBe(false);
    expect(result.blockingReason).toBe('A placa do CRLV aprovado deve corresponder ao veiculo ativo.');
    expect(result.vehicle).toEqual(expect.objectContaining({
      canonicalPlate: 'ABC1D23',
      crlvPlateMatch: false
    }));
  });

  it.each(['active', 'valid'])(
    'exige status approved exato no CRLV canonico e rejeita %s',
    async (crlvStatus) => {
      const driverId = `driver_crlv_status_${crlvStatus}`;
      const db = createMockDb({
        [`user_vehicles/${driverId}`]: {
          vehicleA: createApprovedVehicle()
        }
      });

      const result = await resolveDriverActivationState({
        driverId,
        db,
        activationNode: createApprovedActivation({
          documents: {
            crlv: {
              status: crlvStatus,
              data: {
                placa: 'RJA2D41',
                modelo: 'Honda City',
                cor: 'branca'
              }
            }
          }
        }),
        userData: {
          kycStatus: 'approved',
          kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z'
        }
      });

      expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
      expect(result.canGoOnline).toBe(false);
      expect(result.documents.crlv).toBe(crlvStatus);
      expect(result.checklist.vehicleRegistration).toBe(false);
      expect(result.vehicle.crlvPlateMatch).toBe(false);
    }
  );

  it('classifica CRLV ausente como pendente e nao como enviado para analise', async () => {
    const driverId = 'driver_missing_crlv';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle()
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: {
        documents: {
          cnh: { status: 'approved' }
        },
        consent: {
          backgroundCheck: { accepted: true }
        }
      },
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z',
        documents: {
          crlv: {
            status: 'approved',
            extractedData: {
              placa: 'RJA2D41',
              modelo: 'Honda City',
              cor: 'branca'
            }
          }
        }
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.documents.crlv).toBe('pending');
    expect(result.blockingReason).toBe('Envie o CRLV e aguarde a aprovacao para ficar online.');
    expect(result.blockingReason).not.toContain('enviado');
    expect(result.vehicle.crlvPlateMatch).toBe(false);
  });

  it('vincula o CRLV ao catalogo do veiculo ativo quando o link nao duplica a placa', async () => {
    const driverId = 'driver_catalog_vehicle_match';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle({
          plate: undefined,
          model: undefined,
          color: undefined
        })
      },
      'vehicles/vehicleA': {
        plate: 'rja-2d41',
        model: 'Honda City',
        color: 'branca'
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.ACTIVE);
    expect(result.canGoOnline).toBe(true);
    expect(result.vehicle).toEqual(expect.objectContaining({
      vehicleId: 'vehicleA',
      canonicalPlate: 'RJA2D41',
      crlvPlateMatch: true,
      identityComplete: true,
      canonicalRecordReady: true,
      catalogResolved: true,
      catalogFound: true
    }));
  });

  it('usa identidade do link somente depois de confirmar que o catalogo existe', async () => {
    const driverId = 'driver_link_identity_after_catalog_confirmation';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle()
      },
      'vehicles/vehicleA': {
        status: 'approved'
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.ACTIVE);
    expect(result.canGoOnline).toBe(true);
    expect(result.vehicle).toEqual(expect.objectContaining({
      canonicalRecordReady: true,
      catalogResolved: true,
      catalogFound: true,
      canonicalPlate: 'RJA2D41',
      crlvPlateMatch: true
    }));
  });

  it('falha fechado quando o catalogo do veiculo ativo nao existe', async () => {
    const driverId = 'driver_missing_vehicle_catalog';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle()
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canGoOnline).toBe(false);
    expect(result.blockingReason).toBe('Cadastro canonico do veiculo ativo indisponivel para validacao.');
    expect(result.vehicle).toEqual(expect.objectContaining({
      approved: true,
      active: true,
      canonicalRecordReady: false,
      catalogReadAttempted: true,
      catalogResolved: true,
      catalogFound: false,
      crlvPlateMatch: false
    }));
  });

  it('falha fechado quando a leitura do catalogo do veiculo ativo falha', async () => {
    const driverId = 'driver_vehicle_catalog_read_error';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle()
      }
    }, ['vehicles/vehicleA']);

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canGoOnline).toBe(false);
    expect(result.vehicle).toEqual(expect.objectContaining({
      approved: true,
      active: true,
      canonicalRecordReady: false,
      catalogReadAttempted: true,
      catalogResolved: false,
      catalogFound: false,
      crlvPlateMatch: false
    }));
  });

  it('rejeita link ativo sem vehicleId canonico', async () => {
    const driverId = 'driver_active_link_without_vehicle_id';
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        legacyLink: createApprovedVehicle({ vehicleId: undefined })
      }
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z'
      }
    });

    expect(result.state).toBe(DRIVER_ACTIVATION_STATES.VEHICLE_PENDING);
    expect(result.canGoOnline).toBe(false);
    expect(result.vehicle).toEqual(expect.objectContaining({
      approved: false,
      active: false,
      vehicleId: null,
      catalogReadAttempted: false,
      canonicalRecordReady: false
    }));
  });

  it.each([
    { label: 'sem status', status: undefined },
    { label: 'com status pending', status: 'pending' }
  ])('rejeita link legado aprovado apenas por boolean $label', async ({ label, status }) => {
    const driverId = `driver_bool_only_${label.replace(/\s+/g, '_')}`;
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle({ status })
      },
      'vehicles/vehicleA': createCatalogVehicle()
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z'
      }
    });

    expect(result.canGoOnline).toBe(false);
    expect(result.checklist.vehicleRegistration).toBe(false);
    expect(result.vehicle.approved).toBe(false);
    expect(result.vehicle.active).toBe(false);
    expect(result.vehicle.catalogReadAttempted).toBe(false);
  });

  it.each([
    {
      label: 'solicita liveness sem evidencia facial',
      userData: { kycStatus: 'approved' },
      expectedState: DRIVER_ACTIVATION_STATES.APPROVED_NEEDS_LIVENESS,
      canGoOnline: false
    },
    {
      label: 'fica ativo depois da evidencia facial',
      userData: {
        kycStatus: 'approved',
        kycFirstAccessVerifiedAt: '2026-07-14T10:00:00.000Z'
      },
      expectedState: DRIVER_ACTIVATION_STATES.ACTIVE,
      canGoOnline: true
    }
  ])('$label somente com gate veicular completo', async ({ userData, expectedState, canGoOnline }) => {
    const driverId = `driver_complete_${expectedState.toLowerCase()}`;
    const db = createMockDb({
      [`user_vehicles/${driverId}`]: {
        vehicleA: createApprovedVehicle()
      },
      'vehicles/vehicleA': createCatalogVehicle()
    });

    const result = await resolveDriverActivationState({
      driverId,
      db,
      activationNode: createApprovedActivation(),
      userData
    });

    expect(result.state).toBe(expectedState);
    expect(result.canGoOnline).toBe(canGoOnline);
    expect(result.canAttemptOnline).toBe(true);
    expect(result.checklist.vehicleRegistration).toBe(true);
    expect(result.vehicle).toEqual(expect.objectContaining({
      canonicalPlate: 'RJA2D41',
      crlvPlateMatch: true,
      identityComplete: true
    }));
  });
});
