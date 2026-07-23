import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Camera } from 'expo-camera';

import AWSNativeLivenessScreen, {
  AWS_LIVENESS_RESULT_POLL_INTERVAL_MS,
  AWS_LIVENESS_RESULT_POLL_MAX_ATTEMPTS,
} from '../src/components/KYC/AWSNativeLivenessScreen';
import kycService from '../src/services/KYCService';
import nativeAwsLivenessService from '../src/services/NativeAwsLivenessService';

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../src/services/KYCService', () => ({
  __esModule: true,
  default: {
    createAwsLivenessSession: jest.fn(),
    getAwsLivenessCredentials: jest.fn(),
    getAwsLivenessSessionResult: jest.fn(),
    abandonAwsLivenessSession: jest.fn(),
  },
}));

jest.mock('../src/services/NativeAwsLivenessService', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(),
    start: jest.fn(),
    cancel: jest.fn(),
  },
}));

jest.mock('expo-camera', () => ({
  Camera: {
    requestCameraPermissionsAsync: jest.fn(),
  },
}));

describe('AWSNativeLivenessScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nativeAwsLivenessService.isAvailable.mockReturnValue(true);
    nativeAwsLivenessService.cancel.mockResolvedValue({ success: true });
    Camera.requestCameraPermissionsAsync.mockResolvedValue({ status: 'granted' });
    kycService.abandonAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { abandoned: true },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('starts preparing automatically without rendering a CTA', async () => {
    kycService.createAwsLivenessSession.mockImplementation(() => new Promise(() => {}));

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByText('Prepare seu rosto')).toBeTruthy();
    expect(
      screen.getByText(
        'A câmera abrirá em instantes. A captura começa automaticamente quando seu rosto estiver enquadrado.'
      )
    ).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    await waitFor(() => {
      expect(kycService.createAwsLivenessSession).toHaveBeenCalledWith('driver-1', {
        challengeId: undefined,
        requirement: 'LIVENESS_REQUIRED',
      });
    });

    screen.unmount();
  });

  test('binds temporary credentials to the session that was just created', async () => {
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-1', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: {
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      },
    });
    nativeAwsLivenessService.start.mockImplementation(() => new Promise(() => {}));

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(kycService.getAwsLivenessCredentials).toHaveBeenCalledWith(
        'driver-1',
        'session-1'
      );
    });
    expect(nativeAwsLivenessService.start).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' })
    );

    screen.unmount();
  });

  test('confirms the result and calls onSuccess without another user action', async () => {
    const onSuccess = jest.fn();
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-success', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      },
    });
    nativeAwsLivenessService.start.mockResolvedValue({ success: true });
    kycService.getAwsLivenessSessionResult.mockResolvedValue({
      success: true,
      data: { completed: true, status: 'SUCCEEDED', livenessPassed: true },
    });

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        challengeId="challenge-1"
        requirement="LIVENESS_REQUIRED"
        onSuccess={onSuccess}
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        sessionId: 'session-success',
        result: { completed: true, status: 'SUCCEEDED', livenessPassed: true },
      });
    });
    expect(kycService.getAwsLivenessSessionResult).toHaveBeenCalledWith(
      'driver-1',
      'session-success'
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/iniciar|confirmar|continuar/i)).toBeNull();

    screen.unmount();
  });

  test('polls IN_PROGRESS until SUCCEEDED using the same paid session and no CTA', async () => {
    jest.useFakeTimers();
    const onSuccess = jest.fn();
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-poll', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      },
    });
    nativeAwsLivenessService.start.mockResolvedValue({ success: true });
    kycService.getAwsLivenessSessionResult
      .mockResolvedValueOnce({
        success: true,
        data: { completed: false, status: 'IN_PROGRESS', livenessPassed: false },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { completed: true, status: 'SUCCEEDED', livenessPassed: true },
      });

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onSuccess={onSuccess}
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(kycService.getAwsLivenessSessionResult).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Estamos verificando')).toBeTruthy();
    });
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(AWS_LIVENESS_RESULT_POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        sessionId: 'session-poll',
        result: { completed: true, status: 'SUCCEEDED', livenessPassed: true },
      });
    });
    expect(kycService.createAwsLivenessSession).toHaveBeenCalledTimes(1);
    expect(kycService.getAwsLivenessSessionResult.mock.calls).toEqual([
      ['driver-1', 'session-poll'],
      ['driver-1', 'session-poll'],
    ]);
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    screen.unmount();
  });

  test('keeps polling a passed session until the reference image is available', async () => {
    jest.useFakeTimers();
    const onSuccess = jest.fn();
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-reference-image', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      },
    });
    nativeAwsLivenessService.start.mockResolvedValue({ success: true });
    kycService.getAwsLivenessSessionResult
      .mockResolvedValueOnce({
        success: true,
        data: {
          completed: true,
          status: 'SUCCEEDED',
          livenessPassed: true,
          aws: { referenceImageAvailable: false },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          completed: true,
          status: 'SUCCEEDED',
          livenessPassed: true,
          aws: { referenceImageAvailable: true },
        },
      });

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onSuccess={onSuccess}
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(kycService.getAwsLivenessSessionResult).toHaveBeenCalledTimes(1);
    });
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(AWS_LIVENESS_RESULT_POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        sessionId: 'session-reference-image',
        result: {
          completed: true,
          status: 'SUCCEEDED',
          livenessPassed: true,
          aws: { referenceImageAvailable: true },
        },
      });
    });
    expect(kycService.createAwsLivenessSession).toHaveBeenCalledTimes(1);
    expect(kycService.getAwsLivenessSessionResult).toHaveBeenCalledTimes(2);

    screen.unmount();
  });

  test('keeps the automatic verification state free of confirmation actions', async () => {
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-verifying', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      },
    });
    nativeAwsLivenessService.start.mockResolvedValue({ success: true });
    kycService.getAwsLivenessSessionResult.mockImplementation(() => new Promise(() => {}));

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Estamos verificando')).toBeTruthy();
      expect(screen.getByText('Você não precisa fazer mais nada.')).toBeTruthy();
    });
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    screen.unmount();
  });

  test('does not create a paid session when camera permission is denied', async () => {
    Camera.requestCameraPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Acesso à câmera necessário')).toBeTruthy();
      expect(
        screen.getByText(
          'Permita o uso da câmera nos ajustes do celular para fazer a validação.'
        )
      ).toBeTruthy();
    });
    expect(kycService.createAwsLivenessSession).not.toHaveBeenCalled();
    expect(nativeAwsLivenessService.start).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  test('does not recreate a paid session when the onSuccess callback identity changes', async () => {
    let resolveNativeStart;
    const firstOnSuccess = jest.fn();
    const latestOnSuccess = jest.fn();
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-stable-callback', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      },
    });
    nativeAwsLivenessService.start.mockImplementation(() => new Promise((resolve) => {
      resolveNativeStart = resolve;
    }));
    kycService.getAwsLivenessSessionResult.mockResolvedValue({
      success: true,
      data: { completed: true, status: 'SUCCEEDED', livenessPassed: true },
    });

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onSuccess={firstOnSuccess}
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(nativeAwsLivenessService.start).toHaveBeenCalledTimes(1);
    });

    screen.rerender(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onSuccess={latestOnSuccess}
        onCancel={jest.fn()}
      />
    );
    expect(kycService.createAwsLivenessSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveNativeStart({ success: true });
    });
    await waitFor(() => {
      expect(latestOnSuccess).toHaveBeenCalledTimes(1);
    });
    expect(firstOnSuccess).not.toHaveBeenCalled();
    expect(kycService.createAwsLivenessSession).toHaveBeenCalledTimes(1);

    screen.unmount();
  });

  test('cancels the native capture and pending poll on unmount', async () => {
    jest.useFakeTimers();
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-cancel', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      },
    });
    nativeAwsLivenessService.start.mockResolvedValue({ success: true });
    kycService.getAwsLivenessSessionResult.mockResolvedValue({
      success: true,
      data: { completed: false, status: 'IN_PROGRESS' },
    });

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(kycService.getAwsLivenessSessionResult).toHaveBeenCalledTimes(1);
    });
    screen.unmount();

    expect(nativeAwsLivenessService.cancel).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(kycService.abandonAwsLivenessSession).toHaveBeenCalledWith(
        'driver-1',
        'session-cancel'
      );
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(AWS_LIVENESS_RESULT_POLL_INTERVAL_MS * 2);
    });
    expect(kycService.getAwsLivenessSessionResult).toHaveBeenCalledTimes(1);
  });

  test('abandons a paid session that finishes being created after unmount', async () => {
    let resolveSessionCreation;
    kycService.createAwsLivenessSession.mockImplementation(
      () => new Promise((resolve) => {
        resolveSessionCreation = resolve;
      })
    );

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(kycService.createAwsLivenessSession).toHaveBeenCalledTimes(1);
    });
    screen.unmount();

    await act(async () => {
      resolveSessionCreation({
        success: true,
        data: { sessionId: 'session-created-after-unmount', region: 'us-east-1' },
      });
    });

    await waitFor(() => {
      expect(kycService.abandonAwsLivenessSession).toHaveBeenCalledWith(
        'driver-1',
        'session-created-after-unmount'
      );
    });
    expect(kycService.getAwsLivenessCredentials).not.toHaveBeenCalled();
  });

  test('stops polling at the limit and shows a friendly timeout', async () => {
    jest.useFakeTimers();
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-timeout', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      },
    });
    nativeAwsLivenessService.start.mockResolvedValue({ success: true });
    kycService.getAwsLivenessSessionResult.mockResolvedValue({
      success: true,
      data: { completed: false, status: 'IN_PROGRESS' },
    });

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(kycService.getAwsLivenessSessionResult).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(
        AWS_LIVENESS_RESULT_POLL_INTERVAL_MS * AWS_LIVENESS_RESULT_POLL_MAX_ATTEMPTS
      );
    });

    await waitFor(() => {
      expect(screen.getByText('A confirmação demorou mais')).toBeTruthy();
      expect(
        screen.getByText(
          'Não conseguimos confirmar o resultado agora. Tente novamente em alguns instantes.'
        )
      ).toBeTruthy();
    });
    expect(kycService.getAwsLivenessSessionResult).toHaveBeenCalledTimes(
      AWS_LIVENESS_RESULT_POLL_MAX_ATTEMPTS
    );
    expect(kycService.createAwsLivenessSession).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(kycService.abandonAwsLivenessSession).toHaveBeenCalledWith(
      'driver-1',
      'session-timeout'
    );

    screen.unmount();
  });

  test('never renders the internal session identifier error', async () => {
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-2', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: false,
      code: 'KYC_AWS_LIVENESS_SESSION_REQUIRED',
      status: 400,
      error: 'SessionID é obrigatório',
    });

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Não foi possível iniciar')).toBeTruthy();
      expect(
        screen.getByText(
          'Não foi possível preparar a validação agora. Tente novamente em alguns minutos.'
        )
      ).toBeTruthy();
    });
    expect(screen.queryByText(/session\s*id|sessionid/i)).toBeNull();
    expect(nativeAwsLivenessService.start).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
  });

  test('does not offer a local selfie fallback when canonical liveness is unavailable', async () => {
    const onCancel = jest.fn();
    const onFallbackLocal = jest.fn();
    nativeAwsLivenessService.isAvailable.mockReturnValue(false);

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onCancel={onCancel}
        onFallbackLocal={onFallbackLocal}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Validação indisponível')).toBeTruthy();
    });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Continuar com selfie' })).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Fechar' }));
    expect(onFallbackLocal).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('resumes canonical comparison if abandonment discovers a completed successful session', async () => {
    const onSuccess = jest.fn();
    kycService.createAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-resume', region: 'us-east-1' },
    });
    kycService.getAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      },
    });
    nativeAwsLivenessService.start.mockRejectedValue(
      Object.assign(new Error('capture closed'), { code: 'AWS_LIVENESS_CANCELLED' })
    );
    kycService.abandonAwsLivenessSession.mockResolvedValue({
      success: false,
      code: 'KYC_AWS_LIVENESS_RESUME_REQUIRED',
      status: 409,
      error: 'A validação já foi concluída.',
    });

    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-1"
        requirement="LIVENESS_REQUIRED"
        onSuccess={onSuccess}
        onCancel={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        sessionId: 'session-resume',
        result: expect.objectContaining({
          completed: true,
          livenessPassed: true,
          resumed: true,
        }),
      });
    });
    expect(screen.queryByText('Validação encerrada')).toBeNull();

    screen.unmount();
  });
});
