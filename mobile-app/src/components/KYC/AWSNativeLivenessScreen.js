import React, { useEffect, useRef, useState } from 'react';
import { Camera } from 'expo-camera';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import kycService from '../../services/KYCService';
import nativeAwsLivenessService from '../../services/NativeAwsLivenessService';
import Logger from '../../utils/Logger';
import { resolveKycLivenessErrorPresentation } from './kycLivenessErrorPresentation';

const STATUS = {
  PREPARING: 'preparing',
  RUNNING: 'running',
  VERIFYING: 'verifying',
  ERROR: 'error',
};
const SAFE_REVIEW_CONTEXT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
export const AWS_LIVENESS_RESULT_POLL_INTERVAL_MS = 1000;
export const AWS_LIVENESS_RESULT_POLL_MAX_ATTEMPTS = 30;
const TERMINAL_RESULT_ERROR_CODES = new Set([
  'AWS_LIVENESS_SESSION_EXPIRED',
  'AWS_LIVENESS_SESSION_NOT_FOUND',
  'AWS_LIVENESS_SESSION_USER_MISMATCH',
  'AWS_LIVENESS_SESSION_ABANDONED',
  'KYC_AWS_SESSION_ALREADY_CONSUMED',
]);
const POLL_STOP_ERROR_CODES = new Set([
  ...TERMINAL_RESULT_ERROR_CODES,
  'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
]);

const waitFor = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
const STATUS_PRESENTATION = {
  [STATUS.PREPARING]: {
    title: 'Prepare seu rosto',
    message: 'A câmera abrirá em instantes. A captura começa automaticamente quando seu rosto estiver enquadrado.',
  },
  [STATUS.RUNNING]: {
    title: 'Posicione seu rosto',
    message: 'Mantenha o rosto centralizado. A captura começa automaticamente.',
  },
  [STATUS.VERIFYING]: {
    title: 'Estamos verificando',
    message: 'Você não precisa fazer mais nada.',
  },
};
const isSuccessfulTerminalResult = (data = {}) => (
  data?.livenessPassed === true
  && data?.completed === true
  && String(data?.status || '').trim().toUpperCase() === 'SUCCEEDED'
);
const isTerminalResultError = (error) => {
  const code = String(error?.code || '').trim().toUpperCase();
  return code === 'KYC_AWS_LIVENESS_NOT_PASSED'
    || TERMINAL_RESULT_ERROR_CODES.has(code);
};

function createStableError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function requireCameraPermission() {
  try {
    const permission = await Camera.requestCameraPermissionsAsync();
    if (permission?.status !== 'granted') {
      throw createStableError(
        'KYC_CAMERA_PERMISSION_REQUIRED',
        'A permissão da câmera é necessária para continuar.',
      );
    }
  } catch (error) {
    if (error?.code === 'KYC_CAMERA_PERMISSION_REQUIRED') {
      throw error;
    }
    throw createStableError(
      'KYC_CAMERA_PERMISSION_REQUIRED',
      'Não foi possível confirmar a permissão da câmera.',
    );
  }
}

export function createFlowError(result = {}, fallbackMessage) {
  const payload = result?.payload && typeof result.payload === 'object'
    ? result.payload
    : {};
  const responseData = result?.response?.data && typeof result.response.data === 'object'
    ? result.response.data
    : {};
  const data = result?.data && typeof result.data === 'object' ? result.data : {};
  const sources = [result, payload, responseData, data];
  const firstValue = (field) =>
    sources.find((source) => source?.[field] !== undefined && source?.[field] !== null)
      ?.[field] ?? null;
  const message =
    firstValue('error') || firstValue('message') || fallbackMessage;
  const error = new Error(message);

  error.code = firstValue('code') || '';
  error.status = firstValue('status');
  error.retryAt = firstValue('retryAt');
  error.retryAfterSeconds = firstValue('retryAfterSeconds');
  error.retryable = firstValue('retryable') === true;
  error.challengeId = firstValue('challengeId');
  error.requirement = firstValue('requirement');
  error.evidenceId = firstValue('evidenceId');
  error.reviewCaseId = firstValue('reviewCaseId');
  const reviewSource = sources.find(
    (source) => typeof source?.reviewAvailable === 'boolean',
  );
  if (reviewSource) {
    error.reviewAvailable = reviewSource.reviewAvailable;
  }

  return error;
}

export async function pollAwsLivenessResult({
  driverId,
  sessionId,
  isCancelled = () => false,
  wait = waitFor,
} = {}) {
  let lastFailure = null;

  for (
    let attempt = 1;
    attempt <= AWS_LIVENESS_RESULT_POLL_MAX_ATTEMPTS;
    attempt += 1
  ) {
    if (isCancelled()) return null;
    const resultResponse = await kycService.getAwsLivenessSessionResult(driverId, sessionId);
    if (isCancelled()) return null;

    if (resultResponse?.success) {
      const livenessData = resultResponse.data || {};
      const referenceImageStillProcessing = livenessData.completed === true
        && livenessData.livenessPassed === true
        && livenessData?.aws?.referenceImageAvailable === false;
      if (livenessData.completed === true && !referenceImageStillProcessing) {
        if (livenessData.livenessPassed === true) return livenessData;
        throw Object.assign(
          new Error('A validação não confirmou a prova de vida.'),
          { code: 'KYC_AWS_LIVENESS_NOT_PASSED' },
        );
      }
      lastFailure = resultResponse;
    } else {
      const code = String(resultResponse?.code || '').trim().toUpperCase();
      if (POLL_STOP_ERROR_CODES.has(code)) {
        throw createFlowError(resultResponse, 'Não foi possível confirmar a validação.');
      }
      lastFailure = resultResponse;
    }

    if (attempt < AWS_LIVENESS_RESULT_POLL_MAX_ATTEMPTS) {
      await wait(AWS_LIVENESS_RESULT_POLL_INTERVAL_MS);
    }
  }

  throw createFlowError({
    ...(lastFailure || {}),
    code: 'KYC_AWS_LIVENESS_RESULT_TIMEOUT',
  }, 'A confirmação está demorando mais que o esperado.');
}

export default function AWSNativeLivenessScreen({
  driverId,
  challengeId,
  requirement,
  onSuccess,
  onCancel,
  onRequestReview,
}) {
  const [status, setStatus] = useState(STATUS.PREPARING);
  const [errorPresentation, setErrorPresentation] = useState(null);
  const [errorContext, setErrorContext] = useState(null);
  const runGenerationRef = useRef(0);
  const activeRunRef = useRef(null);
  const abandoningSessionsRef = useRef(new Set());
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const isCurrentRun = (run) => (
    Boolean(run)
    && activeRunRef.current === run
    && run.cancelled !== true
  );

  const cancelNativeLivenessBestEffort = (run) => {
    if (!run || run.nativeCancelRequested === true) {
      return;
    }
    run.nativeCancelRequested = true;
    try {
      const cancellation = nativeAwsLivenessService.cancel?.();
      if (cancellation && typeof cancellation.catch === 'function') {
        cancellation.catch((error) => {
          Logger.warn('⚠️ [AWS NATIVE LIVENESS] Falha ao encerrar captura nativa:', error);
        });
      }
    } catch (error) {
      Logger.warn('⚠️ [AWS NATIVE LIVENESS] Falha ao encerrar captura nativa:', error);
    }
  };

  const abandonSessionBestEffort = async (run, sessionId = run?.sessionId) => {
    const safeDriverId = String(run?.driverId || '').trim();
    const safeSessionId = String(sessionId || '').trim();
    const abandonmentKey = `${safeDriverId}:${safeSessionId}`;
    if (
      !safeDriverId
      || !safeSessionId
      || run?.successful === true
      || run?.terminal === true
      || abandoningSessionsRef.current.has(abandonmentKey)
    ) {
      return null;
    }
    abandoningSessionsRef.current.add(abandonmentKey);
    try {
      const result = await kycService.abandonAwsLivenessSession(safeDriverId, safeSessionId);
      if (result?.success) return result;
      abandoningSessionsRef.current.delete(abandonmentKey);
      Logger.warn('⚠️ [AWS NATIVE LIVENESS] Sessão será reconciliada pelo backend.');
      return result;
    } catch {
      abandoningSessionsRef.current.delete(abandonmentKey);
      Logger.warn('⚠️ [AWS NATIVE LIVENESS] Sessão será reconciliada pelo backend.');
      return null;
    }
  };

  const finishSuccessfulLiveness = async (run, sessionId, livenessData) => {
    if (
      !isCurrentRun(run)
      || run.sessionId !== sessionId
      || run.successful === true
      || run.terminal === true
    ) {
      return false;
    }
    run.successful = true;
    run.terminal = true;
    await onSuccessRef.current?.({ sessionId, result: livenessData });
    return true;
  };

  const showFlowError = (run, error) => {
    if (!isCurrentRun(run) || run.successful === true) return;
    Logger.error('❌ [AWS NATIVE LIVENESS] Falha no fluxo nativo:', error);
    setStatus(STATUS.ERROR);
    setErrorContext(error);
    setErrorPresentation(resolveKycLivenessErrorPresentation(error));
  };

  useEffect(() => {
    const run = {
      generation: runGenerationRef.current + 1,
      driverId,
      sessionId: null,
      cancelled: false,
      nativeCaptureCompleted: false,
      nativeCancelRequested: false,
      terminal: false,
      successful: false,
      retryInFlight: false,
    };
    runGenerationRef.current = run.generation;
    activeRunRef.current = run;
    setStatus(STATUS.PREPARING);
    setErrorContext(null);
    setErrorPresentation(null);

    const runNativeLiveness = async () => {
      try {
        if (!nativeAwsLivenessService.isAvailable()) {
          throw Object.assign(
            new Error('Módulo nativo de liveness AWS indisponível nesta build.'),
            { code: 'AWS_LIVENESS_NATIVE_UNAVAILABLE' }
          );
        }

        await requireCameraPermission();
        if (!isCurrentRun(run)) return;

        setStatus(STATUS.PREPARING);
        const sessionResponse = await kycService.createAwsLivenessSession(driverId, {
          challengeId,
          requirement,
        });

        if (!sessionResponse.success || !sessionResponse.data?.sessionId) {
          throw createFlowError(sessionResponse, 'Não foi possível preparar a validação.');
        }

        const sessionId = sessionResponse.data.sessionId;
        run.sessionId = sessionId;
        if (!isCurrentRun(run)) {
          return;
        }

        if (isSuccessfulTerminalResult(sessionResponse.data)) {
          await finishSuccessfulLiveness(run, sessionId, sessionResponse.data);
          return;
        }

        const credentialsResponse = await kycService.getAwsLivenessCredentials(
          run.driverId,
          sessionId,
        );
        if (!credentialsResponse.success || !credentialsResponse.data?.credentials) {
          throw createFlowError(credentialsResponse, 'Não foi possível preparar a validação.');
        }

        if (!isCurrentRun(run)) {
          return;
        }
        setStatus(STATUS.RUNNING);

        const region = sessionResponse.data.region || credentialsResponse.data.region || 'us-east-1';

        await nativeAwsLivenessService.start({
          sessionId,
          region,
          credentials: credentialsResponse.data.credentials,
        });
        run.nativeCaptureCompleted = true;

        if (!isCurrentRun(run)) return;
        setStatus(STATUS.VERIFYING);

        const livenessData = await pollAwsLivenessResult({
          driverId: run.driverId,
          sessionId,
          isCancelled: () => !isCurrentRun(run),
        });
        if (!livenessData || !isCurrentRun(run)) return;
        await finishSuccessfulLiveness(run, sessionId, livenessData);
      } catch (error) {
        if (!isCurrentRun(run)) {
          return;
        }
        if (isTerminalResultError(error)) {
          run.terminal = true;
        } else if (String(error?.code || '').trim().toUpperCase() === 'AWS_LIVENESS_CANCELLED') {
          const abandonmentResult = await abandonSessionBestEffort(run);
          if (!isCurrentRun(run)) return;
          if (abandonmentResult?.code === 'KYC_AWS_LIVENESS_RESUME_REQUIRED') {
            setStatus(STATUS.VERIFYING);
            await finishSuccessfulLiveness(run, run.sessionId, {
              completed: true,
              livenessPassed: true,
              status: 'SUCCEEDED',
              resumed: true,
            });
            return;
          }
        }
        showFlowError(run, error);
      }
    };

    runNativeLiveness();

    return () => {
      run.cancelled = true;
      if (activeRunRef.current === run) {
        activeRunRef.current = null;
      }
      cancelNativeLivenessBestEffort(run);
      // A desmontagem encerra apenas o trabalho local. O backend mantém a
      // sessão paga retomável; abandono é reservado ao cancelamento nativo explícito.
    };
  }, [challengeId, driverId, requirement]);

  const handleCancel = () => {
    const run = activeRunRef.current;
    if (run) {
      run.cancelled = true;
      if (activeRunRef.current === run) {
        activeRunRef.current = null;
      }
      cancelNativeLivenessBestEffort(run);
    }
    onCancel?.();
  };

  const statusPresentation = STATUS_PRESENTATION[status]
    || STATUS_PRESENTATION[STATUS.PREPARING];
  const title = status === STATUS.ERROR
    ? (errorPresentation?.title || 'Não foi possível concluir')
    : statusPresentation.title;
  const subtitle = status === STATUS.ERROR
    ? errorPresentation?.message
    : statusPresentation.message;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {status === STATUS.ERROR ? (
          <Text style={styles.errorIcon}>!</Text>
        ) : (
          <ActivityIndicator size="large" color="#1A330E" />
        )}

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>
          {status === STATUS.ERROR ? errorPresentation?.message : subtitle}
        </Text>

        {status === STATUS.ERROR ? (
          <>
            {errorPresentation?.action === 'request_identity_review'
              && errorPresentation?.canRequestReview === true
              && errorContext?.reviewAvailable === true
              && SAFE_REVIEW_CONTEXT_ID_PATTERN.test(String(errorContext?.evidenceId || '').trim())
              && onRequestReview ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => onRequestReview(errorContext)}
              >
                <Text style={styles.primaryButtonText}>
                  {errorPresentation.primaryActionLabel || 'Solicitar análise'}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Fechar"
              style={styles.secondaryButton}
              onPress={handleCancel}
            >
              <Text style={styles.secondaryButtonText}>Fechar</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 2000,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
  },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#D92D20',
    color: '#D92D20',
    fontSize: 34,
    lineHeight: 52,
    textAlign: 'center',
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  title: {
    marginTop: 18,
    fontSize: 22,
    lineHeight: 28,
    color: '#111111',
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: '#6B7169',
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 24,
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1A330E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  secondaryButton: {
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#6B7169',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});
