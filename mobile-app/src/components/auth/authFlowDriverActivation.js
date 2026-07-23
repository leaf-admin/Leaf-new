import { hasRequiredDriverConsents } from './authFlowRecovery';

const REQUIRED_CNH_ERROR_MESSAGE =
  'Não foi possível enviar sua CNH para análise. Verifique sua conexão e tente novamente.';

const REQUIRED_CONSENT_ERROR_MESSAGE =
  'Não foi possível registrar o consentimento obrigatório. Verifique sua conexão e tente novamente.';

function normalizePdfAsset(asset) {
  const uri = String(asset?.uri || '').trim();
  if (!uri) {
    return null;
  }

  return {
    ...asset,
    uri,
    name: String(asset?.name || '').trim() || 'documento.pdf',
    mimeType: String(asset?.mimeType || asset?.type || 'application/pdf').trim(),
    size: Number(asset?.size || 0),
  };
}

function buildPdfAssetKey(asset) {
  if (!asset) {
    return '';
  }

  return [
    asset.uri,
    asset.name,
    asset.size,
    String(asset?.updatedAt || ''),
  ].join('|');
}

export class DriverOnboardingActivationError extends Error {
  constructor(message, stage, cause = null) {
    super(message);
    this.name = 'DriverOnboardingActivationError';
    this.stage = stage;
    this.cause = cause;
  }
}

export function createDriverActivationSubmissionTracker(initialState = {}) {
  return {
    backgroundCheckConsentAccepted:
      initialState.backgroundCheckConsentAccepted === true,
    cnhAssetKey: String(initialState.cnhAssetKey || ''),
    crlvAssetKey: String(initialState.crlvAssetKey || ''),
    inFlightPromise: null,
  };
}

export function resolveDriverActivationBlockingAlert(error) {
  if (error?.stage === 'background_check_consent') {
    return {
      title: 'Consentimento não registrado',
      message: REQUIRED_CONSENT_ERROR_MESSAGE,
    };
  }

  return {
    title: 'CNH não enviada',
    message: REQUIRED_CNH_ERROR_MESSAGE,
  };
}

/**
 * Bridges the local onboarding assets into the canonical activation API.
 * The tracker is intentionally mutable so a retry in the same mounted flow can
 * resume after the last successful canonical write without duplicating it.
 */
async function runDriverOnboardingActivation({
  activationService,
  credentials = {},
  documentData = {},
  tracker = createDriverActivationSubmissionTracker(),
} = {}) {
  if (!activationService) {
    throw new DriverOnboardingActivationError(
      REQUIRED_CNH_ERROR_MESSAGE,
      'cnh',
    );
  }

  const cnhAsset = normalizePdfAsset(documentData?.cnhPdfMeta);
  if (!cnhAsset) {
    throw new DriverOnboardingActivationError(
      REQUIRED_CNH_ERROR_MESSAGE,
      'cnh',
    );
  }

  if (!hasRequiredDriverConsents(credentials)) {
    throw new DriverOnboardingActivationError(
      REQUIRED_CONSENT_ERROR_MESSAGE,
      'background_check_consent',
    );
  }

  if (!tracker.backgroundCheckConsentAccepted) {
    try {
      await activationService.submitBackgroundCheckConsent(true);
      tracker.backgroundCheckConsentAccepted = true;
    } catch (error) {
      throw new DriverOnboardingActivationError(
        REQUIRED_CONSENT_ERROR_MESSAGE,
        'background_check_consent',
        error,
      );
    }
  }

  const cnhAssetKey = buildPdfAssetKey(cnhAsset);
  if (tracker.cnhAssetKey !== cnhAssetKey) {
    try {
      await activationService.submitDocument('cnh', cnhAsset);
      tracker.cnhAssetKey = cnhAssetKey;
    } catch (error) {
      throw new DriverOnboardingActivationError(
        REQUIRED_CNH_ERROR_MESSAGE,
        'cnh',
        error,
      );
    }
  }

  const crlvAsset = normalizePdfAsset(documentData?.vehiclePdfMeta);
  if (!crlvAsset) {
    return {
      requiredComplete: true,
      cnhSubmitted: true,
      crlvSubmitted: false,
      crlvError: null,
      pendingCrlvAsset: null,
    };
  }

  const crlvAssetKey = buildPdfAssetKey(crlvAsset);
  if (tracker.crlvAssetKey === crlvAssetKey) {
    return {
      requiredComplete: true,
      cnhSubmitted: true,
      crlvSubmitted: true,
      crlvError: null,
      pendingCrlvAsset: null,
    };
  }

  try {
    await activationService.submitDocument('crlv', crlvAsset);
    tracker.crlvAssetKey = crlvAssetKey;
    return {
      requiredComplete: true,
      cnhSubmitted: true,
      crlvSubmitted: true,
      crlvError: null,
      pendingCrlvAsset: null,
    };
  } catch (error) {
    return {
      requiredComplete: true,
      cnhSubmitted: true,
      crlvSubmitted: false,
      crlvError: error,
      pendingCrlvAsset: crlvAsset,
    };
  }
}

export function submitDriverOnboardingActivation(options = {}) {
  const tracker = options?.tracker || createDriverActivationSubmissionTracker();
  if (tracker.inFlightPromise) {
    return tracker.inFlightPromise;
  }

  const trackedPromise = runDriverOnboardingActivation({
    ...options,
    tracker,
  }).finally(() => {
    if (tracker.inFlightPromise === trackedPromise) {
      tracker.inFlightPromise = null;
    }
  });

  tracker.inFlightPromise = trackedPromise;
  return trackedPromise;
}

export { buildPdfAssetKey, normalizePdfAsset };
