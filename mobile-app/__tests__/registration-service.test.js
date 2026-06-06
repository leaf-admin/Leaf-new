const mockStoreState = {
  settingsdata: {
    settings: {
      CompanyWebsite: 'https://app.leaf.test',
    },
  },
};

const mockUsedReferralPush = jest.fn(() => Promise.resolve({ key: 'used-referral-1' }));

jest.mock('../src/state/appStore', () => ({
  __esModule: true,
  store: {
    getState: jest.fn(() => mockStoreState),
  },
  default: {},
}));

jest.mock('../src/services/canonical/sessionService', () => ({
  __esModule: true,
  firebase: {
    config: {
      projectId: 'leaf-test',
    },
    usedreferralRef: {
      push: mockUsedReferralPush,
    },
  },
}));

jest.mock('../src/common-local/other/AccessKey', () => ({
  __esModule: true,
  default: 'test-access-key',
}));

jest.mock('../src/common-local/other/GetCountries', () => ({
  __esModule: true,
  default: [{ label: 'Brasil', value: 'BR' }],
}));

describe('registrationService', () => {
  let registrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(() => Promise.resolve({
      status: 200,
      headers: {},
      json: jest.fn(() => Promise.resolve({ ok: true })),
    }));

    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        location: {
          origin: 'https://app.leaf.test',
        },
      },
    });

    registrationService = require('../src/services/canonical/registrationService');
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('validates referral using Firebase Functions project host', async () => {
    await registrationService.validateReferer('LEAF123');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://leaf-test.web.app/validate_referrer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ referralId: 'LEAF123' }),
      })
    );
  });

  it('checks existing user on configured host with Basic auth header', async () => {
    await registrationService.checkUserExists({
      email: 'user@leaf.test',
      mobile: '+5521999999999',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://app.leaf.test/check_user_exists',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Basic bGVhZi10ZXN0OnRlc3QtYWNjZXNzLWtleQ==',
        }),
        body: JSON.stringify({
          email: 'user@leaf.test',
          mobile: '+5521999999999',
        }),
      })
    );
  });

  it('submits signup data and returns the API payload', async () => {
    global.fetch.mockResolvedValueOnce({
      status: 200,
      headers: {},
      json: jest.fn(() => Promise.resolve({ uid: 'uid-1' })),
    });

    const result = await registrationService.mainSignUp({
      email: 'novo@leaf.test',
      password: 'secret',
      usertype: 'customer',
    });

    expect(result).toEqual({ uid: 'uid-1' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://leaf-test.web.app/user_signup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          regData: {
            email: 'novo@leaf.test',
            password: 'secret',
            usertype: 'customer',
          },
        }),
      })
    );
  });

  it('throws when signup API returns an error', async () => {
    global.fetch.mockResolvedValueOnce({
      status: 200,
      headers: {},
      json: jest.fn(() => Promise.resolve({ error: 'registration failed' })),
    });

    await expect(registrationService.mainSignUp({
      email: 'novo@leaf.test',
    })).rejects.toThrow('registration failed');
  });

  it('dispatches referral audit and pushes only for Add method', async () => {
    const dispatch = jest.fn();

    await registrationService.editreferral({ email: 'novo@leaf.test' }, 'Add')(dispatch);
    registrationService.editreferral({ email: 'novo@leaf.test' }, 'Ignore')(dispatch);

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'EDIT_REFERRAL_ID',
      payload: {
        method: 'Add',
        users: { email: 'novo@leaf.test' },
      },
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'EDIT_REFERRAL_ID',
      payload: {
        method: 'Ignore',
        users: { email: 'novo@leaf.test' },
      },
    });
    expect(mockUsedReferralPush).toHaveBeenCalledTimes(1);
    expect(mockUsedReferralPush).toHaveBeenCalledWith({ email: 'novo@leaf.test' });
  });

  it('keeps countries export available for the legacy registration form', () => {
    expect(registrationService.countries).toEqual([{ label: 'Brasil', value: 'BR' }]);
  });
});
