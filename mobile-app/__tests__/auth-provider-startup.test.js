import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import AuthProvider from '../src/components/AuthProvider';

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

    expect(getByText('Preparando sua experiência...')).toBeTruthy();
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
    expect(queryByText('Preparando sua experiência...')).toBeNull();
  });
});
