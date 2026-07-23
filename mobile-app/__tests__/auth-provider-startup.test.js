import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthProvider from '../src/components/AuthProvider';
import mobileProfileService from '../src/services/MobileProfileService';
import {
  allowTestUserTools,
  isE2ETestBuild,
  isSimulatorBuild,
} from '../src/config/runtimeAccessPolicy';
import { restoreQaSeedProfile } from '../src/utils/qaSeedProfile';

const mockUseAuth = jest.fn();
const mockDispatch = jest.fn();

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

jest.mock('../src/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
}));

jest.mock('../src/services/InteractiveNotificationService', () => ({
  initialize: jest.fn().mockResolvedValue(),
}));

jest.mock('../src/services/PersistentRideNotificationService', () => ({
  initialize: jest.fn().mockResolvedValue(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  multiGet: jest.fn().mockResolvedValue([]),
  multiSet: jest.fn().mockResolvedValue(),
  getItem: jest.fn().mockResolvedValue(null),
  multiRemove: jest.fn().mockResolvedValue(),
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowTestUserTools: jest.fn(() => false),
  isE2ETestBuild: jest.fn(() => false),
  isSimulatorBuild: jest.fn(() => false),
}));

jest.mock('../src/services/MobileProfileService', () => ({
  getCurrentProfile: jest.fn().mockResolvedValue(null),
  upsertCurrentProfile: jest.fn().mockResolvedValue(),
}));

jest.mock('../src/utils/qaSeedProfile', () => ({
  restoreQaSeedProfile: jest.fn().mockResolvedValue(null),
}));

describe('AuthProvider startup shell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.multiGet.mockResolvedValue([]);
    mobileProfileService.getCurrentProfile.mockResolvedValue(null);
    allowTestUserTools.mockReturnValue(false);
    isE2ETestBuild.mockReturnValue(false);
    isSimulatorBuild.mockReturnValue(false);
  });

  it('shows a branded shell while auth is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
    });

    const { getByText, queryByText } = render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    expect(getByText('Bem vindo(a)')).toBeTruthy();
    expect(queryByText('app-ready-child')).toBeNull();
  });

  it('renders children once auth loading finishes', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
    });

    const { getByText, queryByText } = render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    expect(getByText('app-ready-child')).toBeTruthy();
    expect(queryByText('Bem vindo(a)')).toBeNull();
  });

  it('does not keep the global bootstrap shell over a valid local session', async () => {
    const cachedProfile = {
      uid: 'driver-seeded-1',
      usertype: 'driver',
      firstName: 'Leaf',
      lastName: 'Motorista Teste',
      phone: '+5521123456789',
      isTestUser: true,
    };

    mockUseAuth.mockReturnValue({
      user: {
        uid: 'driver-seeded-1',
        displayName: 'Leaf',
        phoneNumber: '+5521123456789',
      },
      loading: true,
    });
    allowTestUserTools.mockReturnValue(true);
    AsyncStorage.multiGet.mockResolvedValue([
      ['@auth_uid', 'driver-seeded-1'],
      ['@user_data', JSON.stringify(cachedProfile)],
      ['@test_mode', null],
    ]);

    const { getByText, queryByText } = render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByText('app-ready-child')).toBeTruthy();
      expect(queryByText('Bem vindo(a), Leaf')).toBeNull();
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FETCH_USER_SUCCESS',
        payload: expect.objectContaining({
          uid: 'driver-seeded-1',
          usertype: 'driver',
          isTestUser: true,
        }),
      })
    );
  });

  it('releases the app from a matching cached profile while refreshing remotely in background', async () => {
    const cachedProfile = {
      uid: 'firebase-uid-1',
      usertype: 'customer',
      firstName: 'Izaak',
      lastName: 'Dias',
      phone: '+5521998991886',
      email: 'izaak.dias@hotmail.com',
    };

    mockUseAuth.mockReturnValue({
      user: {
        uid: 'firebase-uid-1',
        phoneNumber: '+5521998991886',
        email: null,
      },
      loading: false,
    });
    AsyncStorage.multiGet.mockResolvedValue([
      ['@auth_uid', 'firebase-uid-1'],
      ['@user_data', JSON.stringify(cachedProfile)],
      ['@test_mode', 'false'],
    ]);
    mobileProfileService.getCurrentProfile.mockResolvedValueOnce({
      ...cachedProfile,
      firstName: 'Izaak',
      lastName: 'Ribeiro Dias',
    });

    const { getByText, queryByText } = render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FETCH_USER_SUCCESS',
          payload: expect.objectContaining({
            uid: 'firebase-uid-1',
            firstName: 'Izaak',
            usertype: 'customer',
          }),
        })
      );
    });

    await waitFor(() => {
      expect(queryByText('Bem vindo(a)')).toBeNull();
      expect(getByText('app-ready-child')).toBeTruthy();
    });
    expect(mobileProfileService.getCurrentProfile).toHaveBeenCalledTimes(1);
  });

  it('releases a divergent QA cache only in an explicit simulator E2E build', async () => {
    const cachedProfile = {
      uid: 'driver-seeded-1',
      usertype: 'driver',
      firstName: 'Leaf',
      lastName: 'Motorista Teste',
      phone: '+5521123456789',
      isTestUser: true,
      approved: true,
    };

    mockUseAuth.mockReturnValue({
      user: {
        uid: 'firebase-session-1',
        phoneNumber: '+5521123456789',
        email: null,
      },
      loading: false,
    });
    allowTestUserTools.mockReturnValue(true);
    isE2ETestBuild.mockReturnValue(true);
    isSimulatorBuild.mockReturnValue(true);
    AsyncStorage.multiGet.mockResolvedValue([
      ['@auth_uid', 'driver-seeded-1'],
      ['@user_data', JSON.stringify(cachedProfile)],
      ['@test_mode', null],
    ]);

    const { getByText, queryByText } = render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FETCH_USER_SUCCESS',
          payload: expect.objectContaining({
            uid: 'driver-seeded-1',
            firstName: 'Leaf',
            usertype: 'driver',
            isTestUser: true,
          }),
        })
      );
    });

    await waitFor(() => {
      expect(queryByText('Bem vindo(a), Leaf')).toBeNull();
      expect(getByText('app-ready-child')).toBeTruthy();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FETCH_USER_SUCCESS',
        payload: expect.objectContaining({
          uid: 'driver-seeded-1',
          usertype: 'driver',
        }),
      })
    );
  });

  it('does not let a cached QA identity override a different Firebase session when test tools are disabled', async () => {
    const cachedProfile = {
      uid: 'driver-seeded-1',
      usertype: 'driver',
      firstName: 'Leaf',
      phone: '+5521123456789',
      isTestUser: true,
      approved: true,
    };

    mockUseAuth.mockReturnValue({
      user: {
        uid: 'firebase-session-1',
        phoneNumber: '+5521999999999',
        email: null,
      },
      loading: false,
    });
    AsyncStorage.multiGet.mockResolvedValue([
      ['@auth_uid', 'driver-seeded-1'],
      ['@user_data', JSON.stringify(cachedProfile)],
      ['@test_mode', 'true'],
    ]);

    render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FETCH_USER_SUCCESS',
          payload: expect.objectContaining({
            uid: 'firebase-session-1',
          }),
        })
      );
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FETCH_USER_SUCCESS',
        payload: expect.objectContaining({ uid: 'driver-seeded-1' }),
      })
    );
  });

  it.each([
    ['physical build', false, true],
    ['simulator without E2E', true, false],
  ])(
    'fails closed for a divergent QA cache with test tools enabled on %s',
    async (_scenario, simulatorBuild, e2eBuild) => {
      const cachedProfile = {
        uid: 'driver-seeded-1',
        usertype: 'driver',
        firstName: 'Leaf',
        phone: '+5521123456789',
        isTestUser: true,
        approved: true,
      };

      mockUseAuth.mockReturnValue({
        user: {
          uid: 'firebase-session-1',
          phoneNumber: '+5521999999999',
          email: null,
        },
        loading: false,
      });
      allowTestUserTools.mockReturnValue(true);
      isSimulatorBuild.mockReturnValue(simulatorBuild);
      isE2ETestBuild.mockReturnValue(e2eBuild);
      AsyncStorage.multiGet.mockResolvedValue([
        ['@auth_uid', 'driver-seeded-1'],
        ['@user_data', JSON.stringify(cachedProfile)],
        ['@test_mode', 'true'],
      ]);

      render(
        <AuthProvider>
          <Text>app-ready-child</Text>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'FETCH_USER_SUCCESS',
            payload: expect.objectContaining({ uid: 'firebase-session-1' }),
          })
        );
      });

      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FETCH_USER_SUCCESS',
          payload: expect.objectContaining({ uid: 'driver-seeded-1' }),
        })
      );
      expect(AsyncStorage.multiSet.mock.calls).not.toEqual(
        expect.arrayContaining([
          [expect.arrayContaining([['@auth_uid', 'driver-seeded-1']])],
        ])
      );
    }
  );

  it('does not dispatch a physical-device cache before Firebase resolves its UID', async () => {
    const cachedProfile = {
      uid: 'driver-seeded-1',
      usertype: 'driver',
      firstName: 'Leaf',
      phone: '+5521123456789',
      isTestUser: true,
    };

    mockUseAuth.mockReturnValue({ user: null, loading: true });
    allowTestUserTools.mockReturnValue(true);
    isE2ETestBuild.mockReturnValue(true);
    isSimulatorBuild.mockReturnValue(false);
    AsyncStorage.multiGet.mockResolvedValue([
      ['@auth_uid', 'driver-seeded-1'],
      ['@user_data', JSON.stringify(cachedProfile)],
      ['@test_mode', 'true'],
    ]);

    const { getByText } = render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(AsyncStorage.multiGet).toHaveBeenCalled();
    });

    expect(getByText('Bem vindo(a)')).toBeTruthy();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('does not rebuild a QA profile from a persisted UID when test tools are disabled', async () => {
    mockUseAuth.mockReturnValue({
      user: {
        uid: 'firebase-session-1',
        phoneNumber: '+5521999999999',
        email: null,
      },
      loading: false,
    });
    AsyncStorage.multiGet.mockResolvedValue([
      ['@auth_uid', 'driver-seeded-1'],
      ['@user_data', null],
      ['@test_mode', 'true'],
    ]);

    render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(mobileProfileService.getCurrentProfile).toHaveBeenCalled();
    });

    expect(restoreQaSeedProfile).not.toHaveBeenCalled();
  });

  it('does not rebuild a QA profile on a physical build even when test tools are enabled', async () => {
    mockUseAuth.mockReturnValue({
      user: {
        uid: 'firebase-session-1',
        phoneNumber: '+5521999999999',
        email: null,
      },
      loading: false,
    });
    allowTestUserTools.mockReturnValue(true);
    isE2ETestBuild.mockReturnValue(true);
    isSimulatorBuild.mockReturnValue(false);
    AsyncStorage.multiGet.mockResolvedValue([
      ['@auth_uid', 'driver-seeded-1'],
      ['@user_data', null],
      ['@test_mode', 'true'],
    ]);

    render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(mobileProfileService.getCurrentProfile).toHaveBeenCalled();
    });

    expect(restoreQaSeedProfile).not.toHaveBeenCalled();
  });

  it('keeps authenticated UI visible while profile sync runs in background', async () => {
    const remoteProfileDeferred = createDeferred();

    mockUseAuth.mockReturnValue({
      user: {
        uid: 'driver-live-session',
        phoneNumber: '+5521123456789',
        displayName: 'Leaf',
      },
      loading: false,
    });
    AsyncStorage.multiGet.mockResolvedValue([
      ['@auth_uid', null],
      ['@user_data', null],
      ['@test_mode', null],
    ]);
    mobileProfileService.getCurrentProfile.mockReturnValue(remoteProfileDeferred.promise);

    const { getByText, queryByText } = render(
      <AuthProvider>
        <Text>app-ready-child</Text>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(mobileProfileService.getCurrentProfile).toHaveBeenCalled();
    });

    expect(getByText('app-ready-child')).toBeTruthy();
    expect(queryByText('Bem vindo(a), Leaf')).toBeNull();
    expect(queryByText('Bem vindo(a)')).toBeNull();

    await act(async () => {
      remoteProfileDeferred.resolve({
        uid: 'driver-live-session',
        usertype: 'driver',
        firstName: 'Leaf',
        phone: '+5521123456789',
      });
      await remoteProfileDeferred.promise;
      await Promise.resolve();
    });
  });
});
