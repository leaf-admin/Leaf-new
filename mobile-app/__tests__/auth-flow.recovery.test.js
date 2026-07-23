const fs = require('fs');
const path = require('path');
const {
  buildRestoredAuthFlowData,
  buildSerializableConfirmationMeta,
  hasRequiredDriverConsents,
  isPersistedProfileOnboardingComplete,
  isProfileIdentityConsistent,
  normalizeAuthFlowProfileData,
  resolveAuthFlowInitialStep,
  unwrapAuthFlowStepData,
} = require('../src/components/auth/authFlowRecovery');

describe('auth flow recovery helpers', () => {
  it('starts a fresh user at phone validation when no progress exists', () => {
    expect(resolveAuthFlowInitialStep([], 0, null)).toBe(0);
  });

  it('restores driver onboarding directly to documents after profile selection', () => {
    expect(
      resolveAuthFlowInitialStep(
        ['phone_validation', 'profile_selection'],
        0,
        'driver',
      ),
    ).toBe(4);
  });

  it('restores passenger onboarding to profile data after profile selection', () => {
    expect(
      resolveAuthFlowInitialStep(
        ['phone_validation', 'profile_selection'],
        0,
        'customer',
      ),
    ).toBe(3);
  });

  it('does not infer passenger when the persisted profile choice is missing', () => {
    expect(resolveAuthFlowInitialStep(['phone_validation'], 0, null)).toBe(2);
    expect(unwrapAuthFlowStepData('profile_selection', {})).toEqual({});
  });

  it('never restores a driver past permissions unless all required consents are present', () => {
    const completedSteps = [
      'phone_validation',
      'profile_selection',
      'document_data',
      'credentials',
      'driver_contact',
    ];

    expect(
      resolveAuthFlowInitialStep(completedSteps, 6, 'driver', {
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: false,
      }),
    ).toBe(5);

    expect(
      resolveAuthFlowInitialStep(completedSteps, 6, 'driver', {
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
      }),
    ).toBe(6);
  });

  it('recognizes both current and compatibility credential storage shapes', () => {
    const requiredConsents = {
      acceptTerms: true,
      acceptPrivacy: true,
      consentBackgroundCheck: true,
    };

    expect(hasRequiredDriverConsents(requiredConsents)).toBe(true);
    expect(hasRequiredDriverConsents({ credentials: requiredConsents })).toBe(true);
    expect(hasRequiredDriverConsents({ ...requiredConsents, acceptPrivacy: false })).toBe(false);
  });

  it('normalizes recovered profile names consistently', () => {
    expect(normalizeAuthFlowProfileData({ fullName: 'Maria da Silva' })).toEqual({
      fullName: 'Maria da Silva',
      firstName: 'Maria',
      lastName: 'da Silva',
    });
  });

  it('serializes OTP confirmation metadata without keeping Firebase cyclic objects', () => {
    const confirmation = {
      verificationId: 'verification_123',
      isCustomOtp: false,
      isTestNumber: true,
      confirm: jest.fn(),
    };
    confirmation.self = confirmation;

    const meta = buildSerializableConfirmationMeta(confirmation);

    expect(meta).toEqual({
      verificationId: 'verification_123',
      isCustomOtp: false,
      isReviewAccount: false,
      isTestOtpBypass: false,
      isTestNumber: true,
      source: 'firebase_phone_auth',
    });
    expect(() => JSON.stringify(meta)).not.toThrow();
  });

  it('merges driver contact data into restored document data for onboarding recovery', () => {
    expect(
      buildRestoredAuthFlowData({
        completedSteps: [
          'phone_validation',
          'profile_selection',
          'profile_data',
          'document_data',
          'driver_contact',
        ],
        phoneData: {
          phoneNumber: '+5511999999999',
          confirmation: { verificationId: 'otp_1' },
          isExistingUser: true,
        },
        profileSelectionData: {
          userType: 'driver',
          timestamp: '2026-04-05T12:00:00.000Z',
        },
        profileData: {
          fullName: 'Joao da Silva',
        },
        documentData: {
          cpf: '123.456.789-01',
          city: 'rio_de_janeiro',
          cnhExtraction: { success: true },
        },
        driverContactData: {
          email: 'motorista@leaf.app.br',
        },
      }),
    ).toEqual({
      phoneNumber: '+5511999999999',
      confirmation: { verificationId: 'otp_1' },
      isExistingUser: true,
      profileSelection: {
        userType: 'driver',
        timestamp: '2026-04-05T12:00:00.000Z',
      },
      profileData: {
        fullName: 'Joao da Silva',
        firstName: 'Joao',
        lastName: 'da Silva',
      },
      documentData: {
        cpf: '123.456.789-01',
        email: 'motorista@leaf.app.br',
        city: 'rio_de_janeiro',
        cnhExtraction: { success: true },
        vehicleExtraction: null,
        cnhPdfMeta: null,
        vehiclePdfMeta: null,
      },
      driverContactData: {
        email: 'motorista@leaf.app.br',
      },
    });
  });

  it('restores manual gender and required consents after an interrupted driver onboarding', () => {
    const restored = buildRestoredAuthFlowData({
      completedSteps: ['profile_selection', 'document_data', 'credentials'],
      profileSelectionData: { userType: 'driver' },
      documentData: {
        cpf: '123.456.789-01',
        birthDate: '01/01/1990',
        motherName: 'Maria da Silva',
        gender: 'M',
        cnhExtraction: { success: true },
      },
      credentialsData: {
        credentials: {
          acceptTerms: true,
          acceptPrivacy: true,
          consentBackgroundCheck: true,
          marketingOptIn: false,
        },
      },
    });

    expect(restored.documentData).toEqual(expect.objectContaining({
      birthDate: '01/01/1990',
      motherName: 'Maria da Silva',
      gender: 'M',
    }));
    expect(restored.credentials).toEqual({
      acceptTerms: true,
      acceptPrivacy: true,
      consentBackgroundCheck: true,
      marketingOptIn: false,
    });
  });

  it('recovers legacy wrapped step payloads without changing the selected role', () => {
    const restored = buildRestoredAuthFlowData({
      completedSteps: ['profile_selection', 'document_data', 'credentials'],
      profileSelectionData: {
        profileSelection: { userType: 'driver', timestamp: '2026-07-14T12:00:00.000Z' },
      },
      documentData: {
        documentData: {
          cpf: '123.456.789-01',
          gender: 'M',
          cnhExtraction: { success: true },
        },
      },
      credentialsData: {
        credentials: {
          acceptTerms: true,
          acceptPrivacy: true,
          consentBackgroundCheck: true,
          marketingOptIn: false,
        },
      },
    });

    expect(restored.profileSelection.userType).toBe('driver');
    expect(restored.documentData).toEqual(expect.objectContaining({ gender: 'M' }));
    expect(restored.credentials).toEqual(expect.objectContaining({
      acceptTerms: true,
      acceptPrivacy: true,
      consentBackgroundCheck: true,
      marketingOptIn: false,
    }));
  });

  it('does not treat a v2 driver profile without required consents as complete', () => {
    const v2Driver = {
      uid: 'driver-1',
      userType: 'driver',
      onboardingVersion: 2,
      onboardingCompleted: true,
      profileComplete: true,
    };

    expect(isPersistedProfileOnboardingComplete(v2Driver)).toBe(false);
    expect(isPersistedProfileOnboardingComplete({
      ...v2Driver,
      acceptTerms: true,
      acceptPrivacy: true,
      consentBackgroundCheck: true,
    })).toBe(true);
    expect(isPersistedProfileOnboardingComplete({
      uid: 'legacy-driver',
      userType: 'driver',
      onboardingVersion: 1,
    })).toBe(true);
  });

  it('never treats an OTP bootstrap customer profile as completed onboarding', () => {
    expect(isPersistedProfileOnboardingComplete({
      uid: 'otp-bootstrap-user',
      userType: 'customer',
      createdVia: 'otp_verify',
      profileComplete: false,
      onboardingCompleted: false,
    })).toBe(false);
  });

  it('requires Splash cache UID and phone to match the native Firebase session', () => {
    const firebaseUser = { uid: 'uid-a', phoneNumber: '+5521998991886' };
    const profile = { uid: 'uid-a', phone: '+55 (21) 99899-1886' };

    expect(isProfileIdentityConsistent({
      profile,
      firebaseUser,
      storedUid: 'uid-a',
    })).toBe(true);
    expect(isProfileIdentityConsistent({
      profile: { ...profile, uid: 'uid-b' },
      firebaseUser,
      storedUid: 'uid-b',
    })).toBe(false);
    expect(isProfileIdentityConsistent({
      profile: { ...profile, phone: '+5521123456789' },
      firebaseUser,
      storedUid: 'uid-a',
    })).toBe(false);
  });

  it('does not reference a stale profilePayload variable when setting customer password', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/components/auth/AuthFlow.js'),
      'utf8',
    );

    expect(source).not.toContain('profilePayload.phoneNumber');
    expect(source).not.toContain('profilePayload.mobile');
    expect(source).toContain('persistedProfilePayload.phoneNumber');
    expect(source).toContain('savedProfilePayload.phoneNumber');
  });
});
