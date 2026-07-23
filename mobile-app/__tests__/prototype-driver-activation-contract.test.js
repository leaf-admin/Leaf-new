import fs from 'fs';
import path from 'path';

import {
  resolveCanonicalDriverActivationGates,
  resolveCanonicalLivenessGate,
} from '../src/screens/prototype/driverActivationCanonicalContract';
import {
  computeDriverOnboardingState,
  createInitialDriverOnboardingState,
  DRIVER_ONBOARDING_STAGE_KEYS,
} from '../src/services/DriverOnboardingService';

function buildApprovedDocumentsSnapshot(overrides = {}) {
  return {
    activationState: 'VEHICLE_PENDING',
    canGoOnline: false,
    documents: {
      cnh: { status: 'approved' },
      crlv: { status: 'approved' },
    },
    checklist: {
      cnhEar: true,
      backgroundCheckConsent: true,
      vehicleRegistration: false,
    },
    liveness: { passed: false },
    requiresLiveness: false,
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('prototype driver activation canonical contract', () => {
  it('keeps document approval separate from the canonical vehicle gate', () => {
    const gates = resolveCanonicalDriverActivationGates(
      buildApprovedDocumentsSnapshot(),
    );

    expect(gates.crlvDocumentApproved).toBe(true);
    expect(gates.canonicalVehicleApproved).toBe(false);
  });

  it('approves the vehicle stage only from the canonical backend checklist', () => {
    const gates = resolveCanonicalDriverActivationGates(
      buildApprovedDocumentsSnapshot({
        activationState: 'ACTIVE',
        canGoOnline: true,
        checklist: {
          cnhEar: true,
          backgroundCheckConsent: true,
          vehicleRegistration: true,
        },
        liveness: { passed: true },
      }),
    );

    expect(gates.crlvDocumentApproved).toBe(true);
    expect(gates.canonicalVehicleApproved).toBe(true);
  });

  it.each([
    {
      snapshot: { activationState: 'VEHICLE_PENDING', requiresLiveness: false },
      visible: false,
      canStart: false,
      completed: false,
    },
    {
      snapshot: {
        activationState: 'APPROVED_NEEDS_LIVENESS',
        requiresLiveness: true,
      },
      visible: true,
      canStart: true,
      completed: false,
    },
    {
      snapshot: { activationState: 'ACTIVE', requiresLiveness: false },
      visible: true,
      canStart: false,
      completed: true,
    },
  ])('fails liveness closed for canonical snapshot %#', ({ snapshot, ...expected }) => {
    expect(resolveCanonicalLivenessGate(snapshot)).toEqual(
      expect.objectContaining(expected),
    );
  });

  it('advances local presentation from driver documents to vehicle and only then to liveness', () => {
    const initial = createInitialDriverOnboardingState();
    const afterDriverDocuments = computeDriverOnboardingState({
      ...initial,
      stages: {
        ...initial.stages,
        [DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]: {
          ...initial.stages[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA],
          status: 'approved',
        },
      },
    });

    expect(afterDriverDocuments.currentStage).toBe(
      DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA,
    );
    expect(
      afterDriverDocuments.stages[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA].status,
    ).toBe('action_required');
    expect(
      afterDriverDocuments.stages[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION].status,
    ).toBe('locked');

    const afterVehicle = computeDriverOnboardingState({
      ...afterDriverDocuments,
      stages: {
        ...afterDriverDocuments.stages,
        [DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]: {
          ...afterDriverDocuments.stages[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA],
          status: 'approved',
        },
      },
    });

    expect(afterVehicle.currentStage).toBe(
      DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION,
    );
    expect(
      afterVehicle.stages[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION].status,
    ).toBe('action_required');
  });

  it('keeps Socket and foreground activation refreshes forced', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/screens/prototype/prototypeRideRuntime.js'),
      'utf8',
    );

    expect(source).toMatch(
      /refreshPrototypeDriverActivation\(\s*currentProfile,\s*"socket_document_status"/,
    );
    expect(source).toMatch(
      /if \(foregroundRole === "driver"\)[\s\S]{0,300}refreshPrototypeDriverActivation\(\s*profile,\s*"appstate_active_activation"/,
    );
    expect(source).toMatch(
      /async function refreshPrototypeDriverActivation\([\s\S]{0,180}force: true/,
    );
    expect(source).toContain(
      'resolveCanonicalDriverActivationGates(remoteSnapshot)',
    );
  });
});
