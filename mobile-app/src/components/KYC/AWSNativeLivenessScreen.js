import React, { useEffect, useRef, useState } from 'react';
import { Camera } from 'expo-camera';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import kycService from '../../services/KYCService';
import nativeAwsLivenessService from '../../services/NativeAwsLivenessService';
import { fonts } from '../../theme/runtimeTokens';
import Logger from '../../utils/Logger';
import { resolveKycLivenessErrorPresentation } from './kycLivenessErrorPresentation';

const STATUS = {
  PREPARING: 'preparing',
  RUNNING: 'running',
  VERIFYING: 'verifying',
  ERROR: 'error',
};

export const AWS_LIVENESS_RESULT_POLL_INTERVAL_MS = 1000;
export const AWS_LIVENESS_RESULT_POLL_MAX_ATTEMPTS = 30;

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

function createFlowError(result, fallbackMessage) {
  const error = new Error(result?.error || fallbackMessage);
  error.code = result?.code || '';
  error.status = result?.status || null;
  error.retryAt = result?.retryAt || null;
  return error;
}

function createStableError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function requireCameraPermission() {
  try {
    const permission = await Camera.requestCameraPermissionsAsync();
    if (permission?.status !== 'granted') {
      throw createStableError(
        'KYC_CAMERA_PERMISSION_REQUIRED',
        'A permissão da câmera é necessária para continuar.'
      );
    }
  } catch (error) {
    if (error?.code === 'KYC_CAMERA_PERMISSION_REQUIRED') {
      throw error;
    }
    throw createStableError(
      'KYC_CAMERA_PERMISSION_REQUIRED',
      'Não foi possível confirmar a permissão da câmera.'
    );
  }
}

function cancelNativeLiveness() {
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
}

export default function AWSNativeLivenessScreen({
  driverId,
  challengeId,
  requirement,
  onSuccess,
  onCancel,
}) {
  const [status, setStatus] = useState(STATUS.PREPARING);
  const [errorPresentation, setErrorPresentation] = useState(null);
  const onSuccessRef = useRef(onSuccess);
  const activeFlowRef = useRef(0);
  const pendingPollWaitRef = useRef(null);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    const flowId = activeFlowRef.current + 1;
    activeFlowRef.current = flowId;
    const isCancelled = () => activeFlowRef.current !== flowId;
    let activeSessionId = null;
    let sessionHandedOff = false;
    let sessionTerminal = false;
    let abandonmentPromise = null;

    const requestSessionAbandonment = () => {
      if (
        !activeSessionId
        || sessionHandedOff
        || sessionTerminal
      ) {
        return Promise.resolve(null);
      }
      if (abandonmentPromise) {
        return abandonmentPromise;
      }

      abandonmentPromise = kycService
        .abandonAwsLivenessSession(driverId, activeSessionId)
        .then((result) => {
          if (result?.success) {
            sessionTerminal = true;
          }
          return result;
        })
        .catch((error) => ({
          success: false,
          code: error?.code || '',
          error: error?.message || 'Não foi possível encerrar a validação.',
        }))
        .finally(() => {
          if (!sessionTerminal) {
            abandonmentPromise = null;
          }
        });

      return abandonmentPromise;
    };

    const waitForNextResultPoll = () => new Promise((resolve) => {
      if (isCancelled()) {
        resolve(false);
        return;
      }

      const timerId = setTimeout(() => {
        if (pendingPollWaitRef.current?.flowId === flowId) {
          pendingPollWaitRef.current = null;
        }
        resolve(!isCancelled());
      }, AWS_LIVENESS_RESULT_POLL_INTERVAL_MS);

      pendingPollWaitRef.current = {
        flowId,
        timerId,
        resolve,
      };
    });

    const pollCompletedResult = async (sessionId) => {
      for (
        let attempt = 1;
        attempt <= AWS_LIVENESS_RESULT_POLL_MAX_ATTEMPTS;
        attempt += 1
      ) {
        if (isCancelled()) return null;

        const resultResponse = await kycService.getAwsLivenessSessionResult(
          driverId,
          sessionId
        );
        if (isCancelled()) return null;
        if (!resultResponse.success) {
          throw createFlowError(resultResponse, 'Não foi possível confirmar a validação.');
        }

        const livenessData = resultResponse.data || {};
        const referenceImageStillProcessing = livenessData.completed === true
          && livenessData.livenessPassed === true
          && livenessData?.aws?.referenceImageAvailable === false;
        if (livenessData.completed === true && !referenceImageStillProcessing) {
          return livenessData;
        }

        if (attempt < AWS_LIVENESS_RESULT_POLL_MAX_ATTEMPTS) {
          const shouldContinue = await waitForNextResultPoll();
          if (!shouldContinue) return null;
        }
      }

      throw createStableError(
        'KYC_AWS_LIVENESS_RESULT_TIMEOUT',
        'A confirmação da validação demorou mais do que o esperado.'
      );
    };

    const runNativeLiveness = async () => {
      try {
        if (!nativeAwsLivenessService.isAvailable()) {
          throw Object.assign(
            new Error('Módulo nativo de liveness AWS indisponível nesta build.'),
            { code: 'AWS_LIVENESS_NATIVE_UNAVAILABLE' }
          );
        }

        await requireCameraPermission();
        if (isCancelled()) return;

        setStatus(STATUS.PREPARING);
        const sessionResponse = await kycService.createAwsLivenessSession(driverId, {
          challengeId,
          requirement,
        });

        if (!sessionResponse.success || !sessionResponse.data?.sessionId) {
          throw createFlowError(sessionResponse, 'Não foi possível preparar a validação.');
        }

        const sessionId = sessionResponse.data.sessionId;
        activeSessionId = sessionId;
        if (isCancelled()) {
          await requestSessionAbandonment();
          return;
        }
        const credentialsResponse = await kycService.getAwsLivenessCredentials(driverId, sessionId);
        if (isCancelled()) return;
        if (!credentialsResponse.success || !credentialsResponse.data?.credentials) {
          throw createFlowError(credentialsResponse, 'Não foi possível preparar a validação.');
        }

        setStatus(STATUS.RUNNING);

        const region = sessionResponse.data.region || credentialsResponse.data.region || 'us-east-1';

        await nativeAwsLivenessService.start({
          sessionId,
          region,
          credentials: credentialsResponse.data.credentials,
        });

        if (isCancelled()) return;
        setStatus(STATUS.VERIFYING);

        const livenessData = await pollCompletedResult(sessionId);
        if (isCancelled() || !livenessData) return;
        if (livenessData.livenessPassed !== true) {
          sessionTerminal = true;
          throw new Error('Validação facial não aprovada. Tente novamente em um local bem iluminado.');
        }

        sessionHandedOff = true;
        await onSuccessRef.current?.({
          sessionId,
          result: livenessData,
        });
      } catch (error) {
        if (isCancelled()) return;
        const abandonmentResult = await requestSessionAbandonment();
        if (isCancelled()) return;
        if (abandonmentResult?.code === 'KYC_AWS_LIVENESS_RESUME_REQUIRED') {
          sessionHandedOff = true;
          setStatus(STATUS.VERIFYING);
          await onSuccessRef.current?.({
            sessionId: activeSessionId,
            result: {
              completed: true,
              livenessPassed: true,
              status: 'SUCCEEDED',
              resumed: true,
            },
          });
          return;
        }
        Logger.error('❌ [AWS NATIVE LIVENESS] Falha no fluxo nativo:', error);
        setStatus(STATUS.ERROR);
        setErrorPresentation(resolveKycLivenessErrorPresentation(error));
      }
    };

    runNativeLiveness();

    return () => {
      if (activeFlowRef.current === flowId) {
        activeFlowRef.current += 1;
      }

      const pendingWait = pendingPollWaitRef.current;
      if (pendingWait?.flowId === flowId) {
        clearTimeout(pendingWait.timerId);
        pendingPollWaitRef.current = null;
        pendingWait.resolve(false);
      }

      cancelNativeLiveness();
      requestSessionAbandonment().catch((error) => {
        Logger.warn('⚠️ [AWS NATIVE LIVENESS] Falha ao liberar sessão abandonada:', error);
      });
    };
  }, [challengeId, driverId, requirement]);

  const isError = status === STATUS.ERROR;
  const statusPresentation = STATUS_PRESENTATION[status] || STATUS_PRESENTATION[STATUS.PREPARING];
  const title = isError
    ? errorPresentation?.title || 'Não foi possível continuar'
    : statusPresentation.title;
  const message = isError
    ? errorPresentation?.message || 'Não foi possível iniciar a validação agora.'
    : statusPresentation.message;
  const canClose = isError && typeof onCancel === 'function';

  return (
    <View
      style={styles.container}
      testID="leaf-liveness-screen"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.card}>
        <View style={[styles.statusIndicator, isError && styles.statusIndicatorError]}>
          {isError ? (
            <Text style={styles.errorMark}>!</Text>
          ) : (
            <ActivityIndicator size="small" color="#1A330E" />
          )}
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>

        {isError ? (
          <View style={styles.actions}>
            {canClose ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Fechar"
                style={styles.primaryButton}
                onPress={onCancel}
              >
                <Text style={styles.primaryButtonText}>Fechar</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F6F1',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E9E2D8',
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    shadowColor: '#171412',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: Platform.OS === 'android' ? 0 : 8,
  },
  statusIndicator: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EEF3EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIndicatorError: {
    backgroundColor: '#FFF1F2',
  },
  errorMark: {
    color: '#D7153A',
    fontFamily: fonts.SemiBold,
    fontSize: 24,
    lineHeight: 28,
  },
  title: {
    marginTop: 20,
    fontSize: 22,
    lineHeight: 28,
    color: '#171412',
    fontFamily: fonts.SemiBold,
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: '#756F68',
    fontFamily: fonts.Regular,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    marginTop: 24,
  },
  primaryButton: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1A330E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fonts.SemiBold,
  },
});
