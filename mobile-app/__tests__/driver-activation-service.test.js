const mockApi = {
  get: jest.fn(),
  post: jest.fn(),
};

jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: null,
}));

jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: jest.fn(() => 'https://api.leaf.test'),
}));

jest.mock('../src/utils/axiosInterceptor', () => ({
  createAxiosInstance: jest.fn(() => mockApi),
}));

jest.mock('../src/utils/Logger', () => ({
  warn: jest.fn(),
}));

import {
  normalizeErrorMessage,
  DRIVER_ACTIVATION_PUBLIC_ERRORS,
} from '../src/services/DriverActivationService';

describe('DriverActivationService public errors', () => {
  it('maps an allowlisted backend code to approved user copy', () => {
    const error = {
      response: {
        data: {
          code: 'DRIVER_ACTIVATION_DOCUMENT_CONFLICT',
          message: 'distributed lease compare-and-set failed',
        },
      },
    };

    expect(normalizeErrorMessage(error, 'Falha segura.')).toBe(
      DRIVER_ACTIVATION_PUBLIC_ERRORS.DRIVER_ACTIVATION_DOCUMENT_CONFLICT
    );
  });

  it('does not expose an untrusted technical backend message', () => {
    const technicalMessage = 'SessionID is required at rekognition.prepareSession';
    const error = {
      response: {
        data: {
          message: technicalMessage,
          error: technicalMessage,
        },
      },
      message: technicalMessage,
    };

    expect(normalizeErrorMessage(error, 'Não foi possível enviar o documento.')).toBe(
      'Não foi possível enviar o documento.'
    );
    expect(normalizeErrorMessage(error, 'Não foi possível enviar o documento.')).not.toContain(
      'SessionID'
    );
  });

  it('uses session-expired copy for authentication failures', () => {
    expect(normalizeErrorMessage({ response: { status: 403 } }, 'Falha segura.')).toBe(
      'Sua sessão expirou. Entre novamente para continuar.'
    );
  });
});
