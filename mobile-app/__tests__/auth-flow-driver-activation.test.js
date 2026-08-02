const fs = require('fs');
const path = require('path');
const {
  createDriverActivationSubmissionTracker,
  submitDriverOnboardingActivation,
} = require('../src/components/auth/authFlowDriverActivation');

const CNH_ASSET = {
  uri: 'file:///tmp/cnh.pdf',
  name: 'CNH.pdf',
  mimeType: 'application/pdf',
  size: 1200,
  updatedAt: '2026-07-14T12:00:00.000Z',
};

const CRLV_ASSET = {
  uri: 'file:///tmp/crlv.pdf',
  name: 'CRLV.pdf',
  mimeType: 'application/pdf',
  size: 900,
  updatedAt: '2026-07-14T12:01:00.000Z',
};

const REQUIRED_CONSENTS = Object.freeze({
  acceptTerms: true,
  acceptPrivacy: true,
  consentBackgroundCheck: true,
});

function createActivationService({ failConsent = false, failCnh = false, failCrlv = false } = {}) {
  const calls = [];
  return {
    calls,
    service: {
      submitBackgroundCheckConsent: jest.fn(async accepted => {
        calls.push(['consent', accepted]);
        if (failConsent) {
          throw new Error('consent write failed');
        }
        return { accepted };
      }),
      submitDocument: jest.fn(async (type, asset) => {
        calls.push([type, asset.name]);
        if (type === 'cnh' && failCnh) {
          throw new Error('cnh upload failed');
        }
        if (type === 'crlv' && failCrlv) {
          throw new Error('crlv upload failed');
        }
        return { type, status: 'in_review' };
      }),
    },
  };
}

describe('driver onboarding canonical activation bridge', () => {
  it('submits consent, mandatory CNH and optional CRLV in canonical order', async () => {
    const { service, calls } = createActivationService();

    const result = await submitDriverOnboardingActivation({
      activationService: service,
      credentials: REQUIRED_CONSENTS,
      documentData: {
        cnhPdfMeta: CNH_ASSET,
        vehiclePdfMeta: CRLV_ASSET,
      },
      tracker: createDriverActivationSubmissionTracker(),
    });

    expect(calls).toEqual([
      ['consent', true],
      ['cnh', 'CNH.pdf'],
      ['crlv', 'CRLV.pdf'],
    ]);
    expect(result).toMatchObject({
      requiredComplete: true,
      cnhSubmitted: true,
      crlvSubmitted: true,
      crlvError: null,
      pendingCrlvAsset: null,
    });
  });

  it('allows onboarding to advance without a CRLV after canonical CNH submission', async () => {
    const { service, calls } = createActivationService();

    const result = await submitDriverOnboardingActivation({
      activationService: service,
      credentials: REQUIRED_CONSENTS,
      documentData: { cnhPdfMeta: CNH_ASSET },
      tracker: createDriverActivationSubmissionTracker(),
    });

    expect(calls).toEqual([
      ['consent', true],
      ['cnh', 'CNH.pdf'],
    ]);
    expect(result).toMatchObject({
      requiredComplete: true,
      cnhSubmitted: true,
      crlvSubmitted: false,
      crlvError: null,
    });
  });

  it('blocks completion on CNH failure and resumes without duplicating consent', async () => {
    const tracker = createDriverActivationSubmissionTracker();
    const { service, calls } = createActivationService({ failCnh: true });
    const request = {
      activationService: service,
      credentials: REQUIRED_CONSENTS,
      documentData: {
        cnhPdfMeta: CNH_ASSET,
        vehiclePdfMeta: CRLV_ASSET,
      },
      tracker,
    };

    await expect(submitDriverOnboardingActivation(request)).rejects.toMatchObject({
      name: 'DriverOnboardingActivationError',
      stage: 'cnh',
    });
    expect(calls).toEqual([
      ['consent', true],
      ['cnh', 'CNH.pdf'],
    ]);
    expect(tracker.backgroundCheckConsentAccepted).toBe(true);
    expect(tracker.cnhAssetKey).toBe('');

    service.submitDocument.mockImplementation(async (type, asset) => {
      calls.push([type, asset.name]);
      return { type, status: 'in_review' };
    });

    const retriedResult = await submitDriverOnboardingActivation(request);

    expect(calls).toEqual([
      ['consent', true],
      ['cnh', 'CNH.pdf'],
      ['cnh', 'CNH.pdf'],
      ['crlv', 'CRLV.pdf'],
    ]);
    expect(retriedResult.crlvSubmitted).toBe(true);
  });

  it('blocks before document submission when canonical consent cannot be recorded', async () => {
    const { service, calls } = createActivationService({ failConsent: true });

    await expect(submitDriverOnboardingActivation({
      activationService: service,
      credentials: REQUIRED_CONSENTS,
      documentData: { cnhPdfMeta: CNH_ASSET },
      tracker: createDriverActivationSubmissionTracker(),
    })).rejects.toMatchObject({
      name: 'DriverOnboardingActivationError',
      stage: 'background_check_consent',
    });

    expect(calls).toEqual([['consent', true]]);
    expect(service.submitDocument).not.toHaveBeenCalled();
  });

  it.each([
    ['Termos de Uso', { ...REQUIRED_CONSENTS, acceptTerms: false }],
    ['Política de Privacidade', { ...REQUIRED_CONSENTS, acceptPrivacy: false }],
    ['checagem de antecedentes', { ...REQUIRED_CONSENTS, consentBackgroundCheck: false }],
  ])('blocks before any canonical write when %s is missing', async (_label, credentials) => {
    const { service, calls } = createActivationService();

    await expect(submitDriverOnboardingActivation({
      activationService: service,
      credentials,
      documentData: { cnhPdfMeta: CNH_ASSET },
      tracker: createDriverActivationSubmissionTracker(),
    })).rejects.toMatchObject({
      name: 'DriverOnboardingActivationError',
      stage: 'background_check_consent',
    });

    expect(calls).toEqual([]);
    expect(service.submitBackgroundCheckConsent).not.toHaveBeenCalled();
    expect(service.submitDocument).not.toHaveBeenCalled();
  });

  it('keeps a failed optional CRLV available for retry without failing required onboarding', async () => {
    const { service, calls } = createActivationService({ failCrlv: true });

    const result = await submitDriverOnboardingActivation({
      activationService: service,
      credentials: REQUIRED_CONSENTS,
      documentData: {
        cnhPdfMeta: CNH_ASSET,
        vehiclePdfMeta: CRLV_ASSET,
      },
      tracker: createDriverActivationSubmissionTracker(),
    });

    expect(calls).toEqual([
      ['consent', true],
      ['cnh', 'CNH.pdf'],
      ['crlv', 'CRLV.pdf'],
    ]);
    expect(result.requiredComplete).toBe(true);
    expect(result.cnhSubmitted).toBe(true);
    expect(result.crlvSubmitted).toBe(false);
    expect(result.crlvError).toEqual(expect.any(Error));
    expect(result.pendingCrlvAsset).toEqual(CRLV_ASSET);
  });

  it('deduplicates an in-flight canonical submission from repeated finalization taps', async () => {
    let releaseConsent;
    const consentBarrier = new Promise(resolve => {
      releaseConsent = resolve;
    });
    const service = {
      submitBackgroundCheckConsent: jest.fn(async () => {
        await consentBarrier;
        return { accepted: true };
      }),
      submitDocument: jest.fn(async type => ({ type, status: 'in_review' })),
    };
    const tracker = createDriverActivationSubmissionTracker();
    const request = {
      activationService: service,
      credentials: REQUIRED_CONSENTS,
      documentData: { cnhPdfMeta: CNH_ASSET },
      tracker,
    };

    const firstSubmission = submitDriverOnboardingActivation(request);
    const repeatedSubmission = submitDriverOnboardingActivation(request);
    releaseConsent();

    await expect(Promise.all([firstSubmission, repeatedSubmission])).resolves.toHaveLength(2);
    expect(service.submitBackgroundCheckConsent).toHaveBeenCalledTimes(1);
    expect(service.submitDocument).toHaveBeenCalledTimes(1);
    expect(service.submitDocument).toHaveBeenCalledWith(
      'cnh',
      expect.objectContaining({ uri: CNH_ASSET.uri }),
    );
  });

  it('runs the canonical bridge after profile persistence and before onComplete', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/components/auth/AuthFlow.js'),
      'utf8',
    );
    const profileSaveIndex = source.indexOf(
      'const result = await OnboardingProfileService.saveOnboardingProfile(onboardingData);',
    );
    const requiredConsentsGuardIndex = source.indexOf(
      '!hasRequiredDriverConsents(onboardingData.credentials)',
    );
    const bridgeIndex = source.indexOf(
      'driverActivationSubmission = await submitDriverOnboardingActivation({',
    );
    const localPersistenceIndex = source.indexOf(
      'await persistAuthenticatedProfile(savedProfilePayload, normalizedUserType);',
    );
    const completionIndex = source.indexOf('if (onComplete) {', bridgeIndex);

    expect(profileSaveIndex).toBeGreaterThan(-1);
    expect(requiredConsentsGuardIndex).toBeGreaterThan(-1);
    expect(requiredConsentsGuardIndex).toBeLessThan(profileSaveIndex);
    expect(bridgeIndex).toBeGreaterThan(profileSaveIndex);
    expect(localPersistenceIndex).toBeGreaterThan(bridgeIndex);
    expect(completionIndex).toBeGreaterThan(bridgeIndex);
    expect(source.slice(bridgeIndex, localPersistenceIndex)).toContain('return false;');
  });
});
