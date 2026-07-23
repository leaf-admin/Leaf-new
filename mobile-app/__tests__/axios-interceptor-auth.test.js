const mockAsyncStorageGetItem = jest.fn();
const mockGetIdToken = jest.fn();

let mockAuthState = {
  currentUser: null,
};
let mockQaAuthRuntimeAllowed = true;

const mockInstance = {
  interceptors: {
    request: {
      use: jest.fn(),
    },
    response: {
      use: jest.fn(),
    },
  },
};

jest.mock('axios', () => ({
  create: jest.fn(() => mockInstance),
  isCancel: jest.fn(() => false),
  interceptors: {
    request: {
      use: jest.fn(),
    },
    response: {
      use: jest.fn(),
    },
  },
}));

jest.mock('@react-native-firebase/auth', () => () => mockAuthState);

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowTestUserTools: jest.fn(() => mockQaAuthRuntimeAllowed),
  isE2ETestBuild: jest.fn(() => mockQaAuthRuntimeAllowed),
  isSimulatorBuild: jest.fn(() => mockQaAuthRuntimeAllowed),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args) => mockAsyncStorageGetItem(...args),
}));

jest.mock('../src/utils/friendlyErrorMessages', () => ({
  toUserFriendlyError: jest.fn((error) => error),
}));

import axios from 'axios';
import { createAxiosInstance } from '../src/utils/axiosInterceptor';

function buildJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

describe('axiosInterceptor auth token resolution', () => {
  let requestFulfilled;
  let responseRejected;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = { currentUser: null };
    mockQaAuthRuntimeAllowed = true;
    mockGetIdToken.mockReset();
    mockAsyncStorageGetItem.mockResolvedValue(null);
    requestFulfilled = null;
    responseRejected = null;

    mockInstance.interceptors.request.use.mockImplementation((fulfilled) => {
      requestFulfilled = fulfilled;
      return 0;
    });
    mockInstance.interceptors.response.use.mockImplementation((_fulfilled, rejected) => {
      responseRejected = rejected;
      return 0;
    });
  });

  it('adds Firebase bearer token when currentUser is mounted', async () => {
    mockAuthState.currentUser = {
      getIdToken: mockGetIdToken.mockResolvedValue('firebase-id-token'),
    };

    createAxiosInstance({ baseURL: 'https://api.test' });

    const config = await requestFulfilled({
      headers: {},
      method: 'get',
      url: '/api/map/h3-cells',
    });

    expect(axios.create).toHaveBeenCalled();
    expect(mockGetIdToken).toHaveBeenCalledWith(false);
    expect(config.headers.Authorization).toBe('Bearer firebase-id-token');
    expect(config._authTokenSource).toBe('firebase');
  });

  it('falls back to the seeded QA idToken for HTTP calls when no Firebase user exists', async () => {
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') return 'qa-seeded-id-token';
      return null;
    });

    createAxiosInstance({ baseURL: 'https://api.test' });

    const config = await requestFulfilled({
      headers: {},
      method: 'get',
      url: '/api/map/h3-cells',
    });

    expect(config.headers.Authorization).toBe('Bearer qa-seeded-id-token');
    expect(config._authTokenSource).toBe('qa_storage');
  });

  it('prefers the seeded QA idToken over a stale Firebase user in test mode', async () => {
    mockAuthState.currentUser = {
      getIdToken: mockGetIdToken.mockResolvedValue('stale-firebase-token'),
    };
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') return 'qa-seeded-id-token';
      return null;
    });

    createAxiosInstance({ baseURL: 'https://api.test' });

    const config = await requestFulfilled({
      headers: {},
      method: 'post',
      url: '/api/payment/advance',
    });

    expect(mockGetIdToken).not.toHaveBeenCalled();
    expect(config.headers.Authorization).toBe('Bearer qa-seeded-id-token');
    expect(config._authTokenSource).toBe('qa_storage');
  });

  it('ignores a divergent QA token on a physical build and uses native Firebase', async () => {
    mockQaAuthRuntimeAllowed = false;
    mockAuthState.currentUser = {
      uid: 'firebase-user-b',
      getIdToken: mockGetIdToken.mockResolvedValue('firebase-user-b-token'),
    };
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') return 'cached-user-a-token';
      if (key === '@auth_uid') return 'cached-user-a';
      return null;
    });

    createAxiosInstance({ baseURL: 'https://api.test' });

    const config = await requestFulfilled({
      headers: {},
      method: 'get',
      url: '/api/account/profile',
    });

    expect(mockGetIdToken).toHaveBeenCalledWith(false);
    expect(config.headers.Authorization).toBe('Bearer firebase-user-b-token');
    expect(config._authTokenSource).toBe('firebase');
  });

  it('ignores an expired QA idToken and falls back to Firebase for HTTP calls', async () => {
    mockAuthState.currentUser = {
      getIdToken: mockGetIdToken.mockResolvedValue('fresh-firebase-token'),
    };
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') {
        return buildJwt({
          sub: 'qa-driver-uid',
          exp: Math.floor(Date.now() / 1000) - 60,
        });
      }
      return null;
    });

    createAxiosInstance({ baseURL: 'https://api.test' });

    const config = await requestFulfilled({
      headers: {},
      method: 'post',
      url: '/api/payment/advance',
    });

    expect(mockGetIdToken).toHaveBeenCalledWith(false);
    expect(config.headers.Authorization).toBe('Bearer fresh-firebase-token');
    expect(config._authTokenSource).toBe('firebase');
  });

  it('uses the matching Firebase session when the persisted QA passenger token expired', async () => {
    const passengerFirebaseToken = buildJwt({
      sub: 'passenger_uid',
      user_id: 'passenger_uid',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockAuthState.currentUser = {
      getIdToken: mockGetIdToken.mockResolvedValue(passengerFirebaseToken),
    };
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@auth_uid') return 'passenger_uid';
      if (key === '@qa_socket_id_token') {
        return buildJwt({
          sub: 'passenger_uid',
          user_id: 'passenger_uid',
          exp: Math.floor(Date.now() / 1000) - 60,
        });
      }
      return null;
    });

    createAxiosInstance({ baseURL: 'https://api.test' });

    const config = await requestFulfilled({
      headers: {},
      method: 'post',
      url: '/api/payment/advance',
      data: {
        passengerId: 'passenger_uid',
      },
    });

    expect(mockGetIdToken).toHaveBeenCalledWith(false);
    expect(config.headers.Authorization).toBe(`Bearer ${passengerFirebaseToken}`);
    expect(config._authTokenSource).toBe('firebase');
  });

  it('does not use a different Firebase user when the QA passenger token expired for payment advance', async () => {
    mockAuthState.currentUser = {
      getIdToken: mockGetIdToken.mockResolvedValue(buildJwt({
        sub: 'driver_uid',
        user_id: 'driver_uid',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })),
    };
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@auth_uid') return 'passenger_uid';
      if (key === '@qa_socket_id_token') {
        return buildJwt({
          sub: 'passenger_uid',
          user_id: 'passenger_uid',
          exp: Math.floor(Date.now() / 1000) - 60,
        });
      }
      return null;
    });

    createAxiosInstance({ baseURL: 'https://api.test' });

    await expect(requestFulfilled({
      headers: {},
      method: 'post',
      url: '/api/payment/advance',
      data: {
        passengerId: 'passenger_uid',
      },
    })).rejects.toMatchObject({
      code: 'TOKEN_INVALID_OR_EXPIRED',
      response: {
        status: 401,
        data: {
          code: 'TOKEN_INVALID_OR_EXPIRED',
          passengerId: 'passenger_uid',
          authenticatedPassengerId: 'passenger_uid',
          tokenSource: 'qa_storage_expired',
        },
      },
    });
    expect(mockGetIdToken).toHaveBeenCalledWith(false);
  });

  it('blocks payment advance when the bearer token subject differs from passengerId', async () => {
    mockAuthState.currentUser = {
      getIdToken: mockGetIdToken.mockResolvedValue(buildJwt({
        sub: 'driver_uid',
        user_id: 'driver_uid',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })),
    };

    createAxiosInstance({ baseURL: 'https://api.test' });

    await expect(requestFulfilled({
      headers: {},
      method: 'post',
      url: '/api/payment/advance',
      data: {
        passengerId: 'passenger_uid',
      },
    })).rejects.toMatchObject({
      code: 'PAYMENT_PASSENGER_SCOPE_MISMATCH',
      response: {
        status: 403,
        data: {
          code: 'PAYMENT_PASSENGER_SCOPE_MISMATCH',
          passengerId: 'passenger_uid',
          authenticatedPassengerId: 'driver_uid',
        },
      },
    });
    expect(mockGetIdToken).toHaveBeenCalledWith(false);
    expect(mockGetIdToken).toHaveBeenCalledWith(true);
  });

  it('refreshes a mismatched QA token before payment advance when Firebase matches passengerId', async () => {
    const firebasePassengerToken = buildJwt({
      sub: 'passenger_uid',
      user_id: 'passenger_uid',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockAuthState.currentUser = {
      getIdToken: mockGetIdToken.mockResolvedValue(firebasePassengerToken),
    };
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') {
        return buildJwt({
          sub: 'driver_uid',
          user_id: 'driver_uid',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
      }
      return null;
    });

    createAxiosInstance({ baseURL: 'https://api.test' });

    const config = await requestFulfilled({
      headers: {},
      method: 'post',
      url: '/api/payment/advance',
      data: JSON.stringify({
        passengerId: 'passenger_uid',
      }),
    });

    expect(mockGetIdToken).toHaveBeenCalledWith(true);
    expect(config.headers.Authorization).toBe(`Bearer ${firebasePassengerToken}`);
    expect(config._authTokenSource).toBe('firebase');
  });

  it('marks persisted QA token 401 responses as an expired QA session instead of retrying Firebase refresh', async () => {
    createAxiosInstance({ baseURL: 'https://api.test' });

    const qaError = {
      config: {
        _authTokenSource: 'qa_storage',
        headers: {},
      },
      response: {
        status: 401,
      },
      message: 'Request failed with status code 401',
    };

    await expect(responseRejected(qaError)).rejects.toMatchObject({
      code: 'TOKEN_INVALID_OR_EXPIRED',
      message: 'Sessão QA expirada. Reabra o app ou resemeie a autenticação.',
    });
  });

  it('does not mask payment errors when axios rejects without an original request config', async () => {
    createAxiosInstance({ baseURL: 'https://api.test' });

    const paymentErrorWithoutConfig = {
      response: {
        status: 500,
        data: {
          code: 'PAYMENT_PROVIDER_CHARGE_FAILED',
          message: 'Falha temporária no provedor de pagamento',
        },
      },
      message: 'Request failed before config was attached',
    };

    await expect(responseRejected(paymentErrorWithoutConfig)).rejects.toMatchObject({
      response: {
        status: 500,
        data: {
          code: 'PAYMENT_PROVIDER_CHARGE_FAILED',
        },
      },
    });
    expect(mockGetIdToken).not.toHaveBeenCalled();
  });
});
