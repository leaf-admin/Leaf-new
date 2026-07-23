import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = '@driver_onboarding_v2_';

export const DRIVER_ONBOARDING_STAGE_KEYS = {
  DRIVER_DATA: 'driver_data_activation',
  FACE_VALIDATION: 'face_validation',
  VEHICLE_DATA: 'vehicle_activation'
};

const DEFAULT_STAGE = {
  status: 'locked',
  completedAt: null,
  updatedAt: null,
  checklist: {}
};

const DEFAULT_DRIVER_ONBOARDING_STATE = Object.freeze({
  version: 2,
  preRegistrationCompleted: true,
  currentStage: DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA,
  canGoOnline: false,
  driverProfileStatus: 'pending',
  vehicleProfileStatus: 'pending',
  stages: {
    [DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]: {
      status: 'action_required',
      completedAt: null,
      updatedAt: null,
      checklist: {
        cnhEar: false,
        vehicleRegistration: false,
        inssOrMei: false,
        backgroundCheckConsent: false
      }
    },
    [DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]: {
      status: 'locked',
      completedAt: null,
      updatedAt: null,
      checklist: {
        facialValidation: false
      }
    },
    [DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]: {
      status: 'locked',
      completedAt: null,
      updatedAt: null,
      checklist: {
        crlv: false
      }
    }
  },
  notifications: [
    {
      id: 'driver-onboarding-started',
      title: 'Pré-cadastro concluído',
      message: 'Finalize as etapas de ativação para ficar online.',
      kind: 'driver',
      scope: 'driver',
      read: false,
      createdAt: new Date().toISOString()
    }
  ],
  updatedAt: new Date().toISOString()
});

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_DRIVER_ONBOARDING_STATE));
}

function getStorageKey(uid) {
  const key = String(uid || '').trim();
  return `${STORAGE_PREFIX}${key || 'anonymous'}`;
}

function mergeChecklist(defaultChecklist = {}, inputChecklist = {}) {
  const nextChecklist = { ...defaultChecklist };
  Object.keys(defaultChecklist).forEach(fieldKey => {
    if (
      fieldKey === 'vehicleRegistration' &&
      typeof inputChecklist.vehicleRegistration !== 'boolean' &&
      typeof inputChecklist.criminalRecord === 'boolean'
    ) {
      nextChecklist[fieldKey] = inputChecklist.criminalRecord;
      return;
    }

    if (typeof inputChecklist[fieldKey] === 'boolean') {
      nextChecklist[fieldKey] = inputChecklist[fieldKey];
    }
  });
  return nextChecklist;
}

function normalizeStage(defaultStage, incomingStage = {}) {
  const normalizedStatus =
    typeof incomingStage.status === 'string' && incomingStage.status.trim().length > 0
      ? incomingStage.status
      : defaultStage.status;

  return {
    ...defaultStage,
    status: normalizedStatus,
    completedAt: incomingStage.completedAt || defaultStage.completedAt || null,
    updatedAt: incomingStage.updatedAt || defaultStage.updatedAt || null,
    checklist: mergeChecklist(defaultStage.checklist, incomingStage.checklist)
  };
}

export function computeDriverOnboardingState(rawState = {}) {
  const base = cloneDefaultState();
  const incomingStages = rawState?.stages || {};

  const stages = {
    [DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]: normalizeStage(
      base.stages[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA],
      incomingStages[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]
    ),
    [DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]: normalizeStage(
      base.stages[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION],
      incomingStages[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]
    ),
    [DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]: normalizeStage(
      base.stages[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA],
      incomingStages[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]
    )
  };

  const driverDataApproved = stages[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA].status === 'approved';
  const faceApproved = stages[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION].status === 'approved';
  const vehicleApproved = stages[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA].status === 'approved';

  if (driverDataApproved && stages[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA].status === 'locked') {
    stages[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA].status = 'action_required';
  }

  if (vehicleApproved && stages[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION].status === 'locked') {
    stages[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION].status = 'action_required';
  }

  const canGoOnline = driverDataApproved && faceApproved && vehicleApproved;

  let currentStage = DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA;
  if (!driverDataApproved) {
    currentStage = DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA;
  } else if (!vehicleApproved) {
    currentStage = DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA;
  } else if (!faceApproved) {
    currentStage = DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION;
  }

  return {
    ...base,
    ...rawState,
    stages,
    preRegistrationCompleted:
      typeof rawState?.preRegistrationCompleted === 'boolean'
        ? rawState.preRegistrationCompleted
        : base.preRegistrationCompleted,
    currentStage,
    canGoOnline,
    driverProfileStatus: faceApproved && driverDataApproved ? 'approved' : rawState?.driverProfileStatus || 'pending',
    vehicleProfileStatus: vehicleApproved ? 'approved' : rawState?.vehicleProfileStatus || 'pending',
    notifications: Array.isArray(rawState?.notifications) ? rawState.notifications : base.notifications,
    updatedAt: new Date().toISOString()
  };
}

export function createInitialDriverOnboardingState() {
  return computeDriverOnboardingState(cloneDefaultState());
}

export function updateDriverOnboardingChecklist(state, stageKey, fieldKey, value) {
  const normalized = computeDriverOnboardingState(state);
  const stage = normalized?.stages?.[stageKey];
  if (!stage || typeof stage.checklist?.[fieldKey] !== 'boolean') {
    return normalized;
  }

  const nextStage = {
    ...stage,
    checklist: {
      ...stage.checklist,
      [fieldKey]: Boolean(value)
    },
    updatedAt: new Date().toISOString()
  };

  const nextState = {
    ...normalized,
    stages: {
      ...normalized.stages,
      [stageKey]: nextStage
    },
    updatedAt: new Date().toISOString()
  };

  return computeDriverOnboardingState(nextState);
}

export function completeDriverOnboardingStage(state, stageKey) {
  const normalized = computeDriverOnboardingState(state);
  const stage = normalized?.stages?.[stageKey];
  if (!stage) {
    return normalized;
  }

  const checklistValues = Object.values(stage.checklist || {});
  const allDone = checklistValues.length === 0 || checklistValues.every(Boolean);
  if (!allDone) {
    return {
      ...normalized,
      stages: {
        ...normalized.stages,
        [stageKey]: {
          ...stage,
          status: 'needs_attention',
          updatedAt: new Date().toISOString()
        }
      },
      notifications: [
        {
          id: `driver-stage-attention-${stageKey}-${Date.now()}`,
          title: 'Etapa incompleta',
          message: 'Preencha todos os itens obrigatórios antes de concluir esta etapa.',
          kind: 'driver',
          scope: 'driver',
          read: false,
          createdAt: new Date().toISOString()
        },
        ...(Array.isArray(normalized.notifications) ? normalized.notifications : [])
      ].slice(0, 30),
      updatedAt: new Date().toISOString()
    };
  }

  const nextState = {
    ...normalized,
    stages: {
      ...normalized.stages,
      [stageKey]: {
        ...stage,
        status: 'approved',
        completedAt: stage.completedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    },
    notifications: [
      {
        id: `driver-stage-${stageKey}-${Date.now()}`,
        title: 'Etapa concluída',
        message:
          stageKey === DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA
            ? 'Dados do motorista aprovados. Próxima etapa: validação do veículo.'
            : stageKey === DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA
              ? 'Veículo aprovado. Próxima etapa: validação facial.'
              : 'Validação facial aprovada. Motorista liberado para ficar online.',
        kind: 'driver',
        scope: 'driver',
        read: false,
        createdAt: new Date().toISOString()
      },
      ...(Array.isArray(normalized.notifications) ? normalized.notifications : [])
    ].slice(0, 30),
    updatedAt: new Date().toISOString()
  };

  return computeDriverOnboardingState(nextState);
}

export async function loadDriverOnboardingState(uid) {
  try {
    const raw = await AsyncStorage.getItem(getStorageKey(uid));
    if (!raw) {
      return createInitialDriverOnboardingState();
    }
    return computeDriverOnboardingState(JSON.parse(raw));
  } catch {
    return createInitialDriverOnboardingState();
  }
}

export async function saveDriverOnboardingState(uid, state) {
  const normalized = computeDriverOnboardingState(state);
  await AsyncStorage.setItem(getStorageKey(uid), JSON.stringify(normalized));
  return normalized;
}

export async function clearDriverOnboardingState(uid) {
  await AsyncStorage.removeItem(getStorageKey(uid));
}
