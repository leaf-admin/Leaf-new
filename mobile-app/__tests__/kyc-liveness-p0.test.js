import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AWSNativeLivenessScreen, {
  createFlowError,
  pollAwsLivenessResult,
} from '../src/components/KYC/AWSNativeLivenessScreen';
import { resolveKycLivenessErrorPresentation } from '../src/components/KYC/kycLivenessErrorPresentation';
import fs from 'fs';
import path from 'path';

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCreateAwsLivenessSession = jest.fn();
const mockGetAwsLivenessCredentials = jest.fn();
const mockGetAwsLivenessSessionResult = jest.fn();
const mockAbandonAwsLivenessSession = jest.fn();
const mockNativeLivenessStart = jest.fn();

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

jest.mock('../src/services/KYCService', () => ({
  __esModule: true,
  default: {
    createAwsLivenessSession: (...args) => mockCreateAwsLivenessSession(...args),
    getAwsLivenessCredentials: (...args) => mockGetAwsLivenessCredentials(...args),
    getAwsLivenessSessionResult: (...args) => mockGetAwsLivenessSessionResult(...args),
    abandonAwsLivenessSession: (...args) => mockAbandonAwsLivenessSession(...args),
  },
}));

jest.mock('../src/services/NativeAwsLivenessService', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(() => true),
    start: (...args) => mockNativeLivenessStart(...args),
  },
}));

describe('KYC mobile P0 boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateAwsLivenessSession.mockResolvedValue({
      success: true,
      data: { sessionId: 'session-1', region: 'us-east-1' },
    });
    mockGetAwsLivenessCredentials.mockResolvedValue({
      success: true,
      data: { credentials: { accessKeyId: 'temporary' }, region: 'us-east-1' },
    });
    mockGetAwsLivenessSessionResult.mockResolvedValue({
      success: true,
      data: { completed: true, livenessPassed: true },
    });
    mockAbandonAwsLivenessSession.mockResolvedValue({ success: true });
    mockNativeLivenessStart.mockResolvedValue({ success: true });
  });

  test('finishes AWS liveness through canonical backend compare without a second selfie', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/screens/prototype/RobotaxiHomeScreen.js'),
      'utf8',
    );
    const start = source.indexOf('const handleDriverKycAwsSuccess');
    const end = source.indexOf('\n  const runDriverOnlineMutation', start);
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain('kycService.verifyDriver(driverId, null');
    expect(handler).toContain('await handleDriverKycVerificationSuccess()');
    expect(handler).toContain('resolveKycLivenessErrorPresentation');
    expect(handler).not.toContain('local_after_aws');
    expect(handler).not.toContain('Capture uma selfie');
  });

  test('closes native liveness before a gate-only reconciliation without a new paid session', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/screens/prototype/RobotaxiHomeScreen.js'),
      'utf8',
    );
    const retryStart = source.indexOf('const retryDriverOnlineAfterKycReconciliation');
    const successStart = source.indexOf('const handleDriverKycVerificationSuccess', retryStart);
    const successEnd = source.indexOf('\n  const handleDriverKycCapture', successStart);
    const retryHandler = source.slice(retryStart, successStart);
    const successHandler = source.slice(successStart, successEnd);
    const residualStart = successHandler.indexOf('if (isDriverKycRequiredResult(onlineResult))');
    const residualEnd = successHandler.indexOf('\n    handleDriverKycModalCancel();', residualStart + 1);
    const residualBranch = successHandler.slice(residualStart, residualEnd);

    expect(retryStart).toBeGreaterThan(-1);
    expect(successStart).toBeGreaterThan(retryStart);
    expect(successEnd).toBeGreaterThan(successStart);
    expect(residualStart).toBeGreaterThan(-1);
    expect(residualEnd).toBeGreaterThan(residualStart);
    expect(residualBranch).toContain('handleDriverKycModalCancel();');
    expect(residualBranch.indexOf('handleDriverKycModalCancel();')).toBeLessThan(
      residualBranch.indexOf('Alert.alert('),
    );
    expect(residualBranch).toContain("text: 'Tentar ficar online'");
    expect(residualBranch).toContain('onPress: retryDriverOnlineAfterKycReconciliation');
    expect(retryHandler).toContain('const retryResult = await setDriverOnline(true);');
    expect(retryHandler).not.toContain('openDriverKycModal');
    expect(retryHandler).not.toContain("setDriverKycLivenessMode('aws')");
    expect(retryHandler).not.toContain('setDriverKycModalVisible(true)');
    expect(retryHandler).not.toContain('createAwsLivenessSession');
    expect(retryHandler).not.toContain('kycService.verifyDriver');
    expect(residualBranch).not.toContain('setDriverKycProcessing(false)');
  });

  test('keeps identity-review references when a service response becomes an Error', () => {
    const error = createFlowError({
      success: false,
      code: 'KYC_IDENTITY_REVIEW_HOLD',
      status: 423,
      evidenceId: 'evidence_01HZX9',
      reviewCaseId: 'case_01HZX9',
      challengeId: 'challenge_01HZX9',
      requirement: 'IDENTITY_REVERIFICATION',
      reviewAvailable: true,
      error: 'technical response',
    }, 'fallback');

    expect(error).toMatchObject({
      code: 'KYC_IDENTITY_REVIEW_HOLD',
      status: 423,
      evidenceId: 'evidence_01HZX9',
      reviewCaseId: 'case_01HZX9',
      challengeId: 'challenge_01HZX9',
      requirement: 'IDENTITY_REVERIFICATION',
      reviewAvailable: true,
    });
  });

  test('shows a safe pending-review state only for a traceable case', () => {
    expect(resolveKycLivenessErrorPresentation({
      code: 'KYC_IDENTITY_REVIEW_HOLD',
      reviewCaseId: 'case_01HZX9',
      message: 'technical review hold',
    })).toEqual({
      title: 'Análise em andamento',
      message: 'Sua identidade está sendo analisada. Avisaremos assim que houver uma atualização.',
      allowLocalFallback: false,
    });
  });

  test('never offers a new local capture for recovery-required responses', () => {
    expect(resolveKycLivenessErrorPresentation({
      code: 'KYC_IDENTITY_RECOVERY_REQUIRED',
      reviewCaseId: 'stale_case_01HZX9',
    })).toEqual({
      title: 'Nova tentativa necessária',
      message: 'Precisamos liberar uma nova tentativa. Fale com o suporte.',
      allowLocalFallback: false,
    });
  });

  test('never displays an unmapped backend message verbatim', () => {
    const rawTechnicalMessage = 'ResourceNotFoundException for SessionId internal-session-123';
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'UNMAPPED_KYC_FAILURE',
      message: rawTechnicalMessage,
    });

    expect(presentation.message).toBe(
      'Não foi possível iniciar a validação agora. Tente novamente em alguns minutos.',
    );
    expect(presentation.message).not.toContain('SessionId');
    expect(presentation.message).not.toContain('ResourceNotFoundException');
  });

  test('polls the same AWS session until the result becomes terminal', async () => {
    mockGetAwsLivenessSessionResult
      .mockResolvedValueOnce({ success: true, data: { completed: false, status: 'IN_PROGRESS' } })
      .mockResolvedValueOnce({ success: true, data: { completed: true, livenessPassed: true } });

    const result = await pollAwsLivenessResult({
      driverId: 'driver-1',
      sessionId: 'session-1',
      wait: jest.fn(async () => {}),
    });

    expect(result).toMatchObject({ completed: true, livenessPassed: true });
    expect(mockGetAwsLivenessSessionResult).toHaveBeenNthCalledWith(
      1,
      'driver-1',
      'session-1',
    );
    expect(mockGetAwsLivenessSessionResult).toHaveBeenNthCalledWith(
      2,
      'driver-1',
      'session-1',
    );
    expect(mockCreateAwsLivenessSession).not.toHaveBeenCalled();
  });

  test('isolates overlapping runs when props change and only starts the current session', async () => {
    const staleCreate = createDeferred();
    const currentCreate = createDeferred();
    mockCreateAwsLivenessSession
      .mockReturnValueOnce(staleCreate.promise)
      .mockReturnValueOnce(currentCreate.promise);
    const onSuccess = jest.fn();
    const screen = render(
      <AWSNativeLivenessScreen
        driverId="driver-stale"
        challengeId="challenge-stale"
        requirement="IDENTITY_REVERIFICATION"
        onSuccess={onSuccess}
      />,
    );

    await waitFor(() => {
      expect(mockCreateAwsLivenessSession).toHaveBeenCalledTimes(1);
    });

    screen.rerender(
      <AWSNativeLivenessScreen
        driverId="driver-current"
        challengeId="challenge-current"
        requirement="IDENTITY_REVERIFICATION"
        onSuccess={onSuccess}
      />,
    );
    await waitFor(() => {
      expect(mockCreateAwsLivenessSession).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      currentCreate.resolve({
        success: true,
        data: { sessionId: 'session-current', region: 'us-east-1' },
      });
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        sessionId: 'session-current',
        result: expect.objectContaining({ completed: true, livenessPassed: true }),
      });
    });

    await act(async () => {
      staleCreate.resolve({
        success: true,
        data: { sessionId: 'session-stale', region: 'us-east-1' },
      });
    });
    await waitFor(() => {
      expect(mockAbandonAwsLivenessSession).toHaveBeenCalledWith(
        'driver-stale',
        'session-stale',
      );
    });

    expect(mockGetAwsLivenessCredentials).toHaveBeenCalledTimes(1);
    expect(mockGetAwsLivenessCredentials).toHaveBeenCalledWith(
      'driver-current',
      'session-current',
    );
    expect(mockNativeLivenessStart).toHaveBeenCalledTimes(1);
    expect(mockNativeLivenessStart).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-current',
    }));
    expect(mockGetAwsLivenessSessionResult).toHaveBeenCalledTimes(1);
    expect(mockGetAwsLivenessSessionResult).toHaveBeenCalledWith(
      'driver-current',
      'session-current',
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  test('resumes an already successful session without credentials, camera, or polling', async () => {
    const terminalResult = {
      sessionId: 'session-resumed',
      region: 'us-east-1',
      status: 'SUCCEEDED',
      completed: true,
      livenessPassed: true,
    };
    mockCreateAwsLivenessSession.mockResolvedValue({
      success: true,
      data: terminalResult,
    });
    const onSuccess = jest.fn();
    const screen = render(
      <AWSNativeLivenessScreen driverId="driver-1" onSuccess={onSuccess} />,
    );

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        sessionId: 'session-resumed',
        result: terminalResult,
      });
    });

    expect(mockGetAwsLivenessCredentials).not.toHaveBeenCalled();
    expect(mockNativeLivenessStart).not.toHaveBeenCalled();
    expect(mockGetAwsLivenessSessionResult).not.toHaveBeenCalled();
    screen.unmount();
    expect(mockAbandonAwsLivenessSession).not.toHaveBeenCalled();
  });

  test('abandons a session that arrives after the user already cancelled', async () => {
    let resolveCreate;
    mockCreateAwsLivenessSession.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const onCancel = jest.fn();
    const screen = render(
      <AWSNativeLivenessScreen driverId="driver-1" onCancel={onCancel} />,
    );

    fireEvent.press(screen.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({
        success: true,
        data: { sessionId: 'session-late', region: 'us-east-1' },
      });
    });

    await waitFor(() => {
      expect(mockAbandonAwsLivenessSession).toHaveBeenCalledWith(
        'driver-1',
        'session-late',
      );
    });
    expect(mockGetAwsLivenessCredentials).not.toHaveBeenCalled();
  });

  test('abandons the bound session when cancellation happens after creation', async () => {
    let resolveCredentials;
    mockGetAwsLivenessCredentials.mockReturnValue(new Promise((resolve) => {
      resolveCredentials = resolve;
    }));
    const onCancel = jest.fn();
    const screen = render(
      <AWSNativeLivenessScreen driverId="driver-1" onCancel={onCancel} />,
    );
    await waitFor(() => {
      expect(mockGetAwsLivenessCredentials).toHaveBeenCalledWith(
        'driver-1',
        'session-1',
      );
    });

    fireEvent.press(screen.getByText('Cancelar'));
    await waitFor(() => {
      expect(mockAbandonAwsLivenessSession).toHaveBeenCalledWith(
        'driver-1',
        'session-1',
      );
    });

    await act(async () => {
      resolveCredentials({ success: false, code: 'CANCELLED' });
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockNativeLivenessStart).not.toHaveBeenCalled();
  });
});
