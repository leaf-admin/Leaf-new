jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: null,
}));

jest.mock('../src/services/MobileProfileService', () => ({
  __esModule: true,
  default: {
    getCurrentProfile: jest.fn(),
    upsertCurrentProfile: jest.fn(),
  },
}));

const { OnboardingProfileService } = require('../src/services/OnboardingProfileService');

describe('OnboardingProfileService.buildProfilePayload', () => {
  it('builds a consistent passenger payload for a brand new registration', () => {
    const payload = OnboardingProfileService.buildProfilePayload({
      phoneNumber: '+5511999999999',
      profileSelection: { userType: 'passenger' },
      profileData: { fullName: 'Maria da Silva' },
      documentData: {
        cpf: '123.456.789-01',
        email: 'maria@leaf.app.br',
        city: 'rio_de_janeiro',
      },
      credentials: {
        acceptTerms: true,
        acceptPrivacy: true,
      },
      user: { uid: 'customer_1' },
    });

    expect(payload.uid).toBe('customer_1');
    expect(payload.usertype).toBe('customer');
    expect(payload.userType).toBe('customer');
    expect(payload.name).toBe('Maria da Silva');
    expect(payload.firstName).toBe('Maria');
    expect(payload.lastName).toBe('da Silva');
    expect(payload.cpf).toBe('123.456.789-01');
    expect(payload.email).toBe('maria@leaf.app.br');
    expect(payload.phoneValidated).toBe(true);
    expect(payload.onboardingCompleted).toBe(true);
    expect(payload.profileComplete).toBe(true);
    expect(payload.approved).toBeUndefined();
    expect(payload.canGoOnline).toBeUndefined();
  });

  it('keeps driver approval and document state backend-governed during registration', () => {
    const payload = OnboardingProfileService.buildProfilePayload({
      phoneNumber: '+5511888888888',
      profileSelection: { userType: 'driver' },
      profileData: { fullName: 'Joao Motorista' },
      documentData: {
        email: 'joao@leaf.app.br',
        cnhExtraction: {
          success: true,
          source: 'ocr',
          data: {
            cpf: '98765432100',
            dataNascimento: '01/02/1990',
            nomeMae: 'Maria Motorista',
            genero: 'M',
          },
        },
        vehicleExtraction: {
          success: true,
          source: 'ocr',
          data: {
            placa: 'ABC1D23',
          },
        },
      },
      credentials: {
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
      },
      user: { uid: 'driver_1' },
    });

    expect(payload.uid).toBe('driver_1');
    expect(payload.usertype).toBe('driver');
    expect(payload.userType).toBe('driver');
    expect(payload.approved).toBeUndefined();
    expect(payload.canGoOnline).toBeUndefined();
    expect(payload.driverActivation).toBeUndefined();
    expect(payload.documents).toBeUndefined();
    expect(payload.vehicles).toBeUndefined();
    expect(payload.birthDate).toBe('1990-02-01');
    expect(payload.motherName).toBe('MARIA MOTORISTA');
    expect(payload.gender).toBe('M');
  });

  it('does not resend backend-derived driver state when creating the base profile', async () => {
    const mobileProfileService = require('../src/services/MobileProfileService').default;
    mobileProfileService.getCurrentProfile.mockResolvedValueOnce({
      uid: 'driver_1',
      approved: false,
      documents: { cnh: { status: 'approved' } },
      vehicles: { current: { status: 'approved' } },
    });
    mobileProfileService.upsertCurrentProfile.mockResolvedValueOnce({
      uid: 'driver_1',
      userType: 'driver',
    });

    const result = await OnboardingProfileService.saveOnboardingProfile({
      uid: 'driver_1',
      profileSelection: { userType: 'driver' },
      profileData: { fullName: 'Joao Motorista' },
      documentData: {
        email: 'joao@leaf.app.br',
        cnhExtraction: { success: true, data: { cpf: '98765432100' } },
        vehicleExtraction: { success: true, data: { placa: 'ABC1D23' } },
      },
    });

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(mobileProfileService.upsertCurrentProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({
        approved: expect.anything(),
        documents: expect.anything(),
        vehicles: expect.anything(),
      }),
    );
  });
});
