import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthProvider from '../src/components/AuthProvider';
import mobileProfileService from '../src/services/MobileProfileService';

const mockUseAuth = jest.fn();
const mockDispatch = jest.fn();

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

    expect(getByText('Preparando o app...')).toBeTruthy();
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
    expect(queryByText('Preparando o app...')).toBeNull();
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
    AsyncStorage.multiGet.mockResolvedValueOnce([
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
      expect(queryByText('Entrando na sua conta...')).toBeNull();
      expect(getByText('app-ready-child')).toBeTruthy();
    });
    expect(mobileProfileService.getCurrentProfile).toHaveBeenCalledTimes(1);
  });
});
