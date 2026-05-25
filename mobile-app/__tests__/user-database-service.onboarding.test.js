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

const { UserDatabaseService } = require('../src/utils/userDatabaseService');

describe('UserDatabaseService.buildProfilePayload', () => {
  it('builds a consistent passenger payload for a brand new registration', () => {
    const payload = UserDatabaseService.buildProfilePayload({
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
    expect(payload.approved).toBe(true);
    expect(payload.canGoOnline).toBe(true);
  });

  it('builds a driver payload with activation locked until KYC/documents are approved', () => {
    const payload = UserDatabaseService.buildProfilePayload({
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
    expect(payload.approved).toBe(false);
    expect(payload.canGoOnline).toBe(false);
    expect(payload.driverProfileStatus).toBeDefined();
    expect(payload.vehicleProfileStatus).toBeDefined();
    expect(payload.onboardingDocuments).toEqual(
      expect.objectContaining({
        cnhUploaded: true,
        vehicleUploaded: true,
        cnhIdentity: expect.objectContaining({
          birthDate: '1990-02-01',
          motherName: 'MARIA MOTORISTA',
          gender: 'M',
        }),
      }),
    );
  });
});
