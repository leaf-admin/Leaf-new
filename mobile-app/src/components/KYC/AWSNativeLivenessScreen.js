import React, { useEffect, useRef, useState } from 'react';
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
const RESULT_POLL_DELAYS_MS = [500, 750, 1000, 1250, 1500, 1750, 2000, 2250];
const TERMINAL_RESULT_ERROR_CODES = new Set([
  'AWS_LIVENESS_SESSION_EXPIRED',
  'AWS_LIVENESS_SESSION_NOT_FOUND',
  'AWS_LIVENESS_SESSION_USER_MISMATCH',
  'AWS_LIVENESS_SESSION_ABANDONED',
  'KYC_AWS_SESSION_ALREADY_CONSUMED',
]);

const waitFor = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
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

  for (let index = 0; index <= RESULT_POLL_DELAYS_MS.length; index += 1) {
    if (isCancelled()) return null;
    const resultResponse = await kycService.getAwsLivenessSessionResult(driverId, sessionId);
    if (isCancelled()) return null;

    if (resultResponse?.success) {
      const livenessData = resultResponse.data || {};
      if (livenessData.completed === true) {
        if (livenessData.livenessPassed === true) return livenessData;
        throw Object.assign(
          new Error('A validação não confirmou a prova de vida.'),
          { code: 'KYC_AWS_LIVENESS_NOT_PASSED' },
        );
      }
      lastFailure = resultResponse;
    } else {
      const code = String(resultResponse?.code || '').trim().toUpperCase();
      if (TERMINAL_RESULT_ERROR_CODES.has(code)) {
        throw createFlowError(resultResponse, 'Não foi possível confirmar a validação.');
      }
      lastFailure = resultResponse;
    }

    if (index < RESULT_POLL_DELAYS_MS.length) {
      await wait(RESULT_POLL_DELAYS_MS[index]);
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
      return;
    }
    abandoningSessionsRef.current.add(abandonmentKey);
    try {
      const result = await kycService.abandonAwsLivenessSession(safeDriverId, safeSessionId);
      if (result?.success) return;
      abandoningSessionsRef.current.delete(abandonmentKey);
      Logger.warn('⚠️ [AWS NATIVE LIVENESS] Sessão será reconciliada pelo backend.');
    } catch {
      abandoningSessionsRef.current.delete(abandonmentKey);
      Logger.warn('⚠️ [AWS NATIVE LIVENESS] Sessão será reconciliada pelo backend.');
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
          await abandonSessionBestEffort(run, sessionId);
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
          await abandonSessionBestEffort(run, sessionId);
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
          await abandonSessionBestEffort(run);
          return;
        }
        if (isTerminalResultError(error)) {
          run.terminal = true;
        } else if (!run.nativeCaptureCompleted) {
          await abandonSessionBestEffort(run);
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
      void abandonSessionBestEffort(run);
    };
  }, [challengeId, driverId, requirement]);

  const handleRetryResult = async () => {
    const run = activeRunRef.current;
    const sessionId = run?.sessionId;
    if (
      !sessionId
      || !isCurrentRun(run)
      || run.terminal === true
      || run.successful === true
      || run.retryInFlight === true
    ) {
      return;
    }
    run.retryInFlight = true;
    setStatus(STATUS.VERIFYING);
    setErrorContext(null);
    setErrorPresentation(null);
    try {
      const livenessData = await pollAwsLivenessResult({
        driverId: run.driverId,
        sessionId,
        isCancelled: () => !isCurrentRun(run),
      });
      if (!livenessData || !isCurrentRun(run)) return;
      await finishSuccessfulLiveness(run, sessionId, livenessData);
    } catch (error) {
      if (!isCurrentRun(run)) return;
      if (isTerminalResultError(error)) {
        run.terminal = true;
      }
      showFlowError(run, error);
    } finally {
      run.retryInFlight = false;
    }
  };

  const handleCancel = () => {
    const run = activeRunRef.current;
    if (run) {
      run.cancelled = true;
      if (activeRunRef.current === run) {
        activeRunRef.current = null;
      }
      void abandonSessionBestEffort(run);
    }
    onCancel?.();
  };

  const title = status === STATUS.ERROR
    ? (errorPresentation?.title || 'Não foi possível concluir')
    : 'Validação facial';
  const subtitle = status === STATUS.VERIFYING
    ? 'Confirmando o resultado com segurança...'
    : status === STATUS.RUNNING
      ? 'Siga as instruções na tela para confirmar que é você.'
      : 'Preparando uma verificação segura...';

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
            {errorContext?.code === 'KYC_AWS_LIVENESS_RESULT_TIMEOUT' ? (
              <TouchableOpacity style={styles.primaryButton} onPress={handleRetryResult}>
                <Text style={styles.primaryButtonText}>Confirmar resultado</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.secondaryButton} onPress={handleCancel}>
              <Text style={styles.secondaryButtonText}>Agora não</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.secondaryButton} onPress={handleCancel}>
            <Text style={styles.secondaryButtonText}>Cancelar</Text>
          </TouchableOpacity>
        )}
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
