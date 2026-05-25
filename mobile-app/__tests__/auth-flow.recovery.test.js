const {
  buildRestoredAuthFlowData,
  normalizeAuthFlowProfileData,
  resolveAuthFlowInitialStep,
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

  it('normalizes recovered profile names consistently', () => {
    expect(normalizeAuthFlowProfileData({ fullName: 'Maria da Silva' })).toEqual({
      fullName: 'Maria da Silva',
      firstName: 'Maria',
      lastName: 'da Silva',
    });
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
});
