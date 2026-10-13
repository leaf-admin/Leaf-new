import React from 'react';
import { AppState } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { Camera } from 'expo-camera';

import KYCCameraScreen from '../src/components/KYC/KYCCameraScreen';

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Camera: {
      requestCameraPermissionsAsync: jest.fn(),
      getCameraPermissionsAsync: jest.fn(),
    },
    CameraView: React.forwardRef((props, ref) => <View ref={ref} testID="kyc-camera-view" />),
  };
});

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('KYCCameraScreen camera permission', () => {
  let appStateListener;
  let removeSubscription;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListener = null;
    removeSubscription = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
      appStateListener = listener;
      return { remove: removeSubscription };
    });
  });

  afterEach(() => {
    AppState.addEventListener.mockRestore();
  });

  test('leaves the disabled-camera screen after the permission is granted in settings', async () => {
    Camera.requestCameraPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Camera.getCameraPermissionsAsync.mockResolvedValue({ status: 'granted' });

    const screen = render(<KYCCameraScreen onCapture={jest.fn()} onCancel={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Câmera desativada')).toBeTruthy();
    });

    await act(async () => {
      await appStateListener('background');
    });
    expect(Camera.getCameraPermissionsAsync).not.toHaveBeenCalled();

    await act(async () => {
      await appStateListener('active');
    });

    expect(screen.queryByText('Câmera desativada')).toBeNull();
    expect(screen.getByTestId('kyc-camera-view')).toBeTruthy();
    expect(screen.getByLabelText('Fechar')).toBeTruthy();
    expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);

    screen.unmount();
    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });

  test('stays on the disabled-camera screen while the permission is still denied', async () => {
    Camera.requestCameraPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Camera.getCameraPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const screen = render(<KYCCameraScreen onCapture={jest.fn()} onCancel={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Câmera desativada')).toBeTruthy();
    });

    await act(async () => {
      await appStateListener('active');
    });

    expect(screen.getByText('Câmera desativada')).toBeTruthy();
  });
});
