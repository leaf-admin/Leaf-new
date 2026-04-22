const mockAsyncStorageGetItem = jest.fn();
const mockGetIdToken = jest.fn();

let mockAuthState = {
  currentUser: null,
};

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

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args) => mockAsyncStorageGetItem(...args),
}));

jest.mock('../src/utils/friendlyErrorMessages', () => ({
  toUserFriendlyError: jest.fn((error) => error),
}));

import axios from 'axios';
import { createAxiosInstance } from '../src/utils/axiosInterceptor';

describe('axiosInterceptor auth token resolution', () => {
  let requestFulfilled;
  let responseRejected;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = { currentUser: null };
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
});
