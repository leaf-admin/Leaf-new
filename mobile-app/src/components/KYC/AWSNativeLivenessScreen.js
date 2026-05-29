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

const STATUS = {
  PREPARING: 'preparing',
  RUNNING: 'running',
  VERIFYING: 'verifying',
  ERROR: 'error',
};

export default function AWSNativeLivenessScreen({
  driverId,
  challengeId,
  requirement,
  onSuccess,
  onCancel,
  onFallbackLocal,
}) {
  const [status, setStatus] = useState(STATUS.PREPARING);
  const [errorMessage, setErrorMessage] = useState('');
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

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
          throw new Error(sessionResponse.error || 'Não foi possível criar a sessão AWS.');
        }

        const credentialsResponse = await kycService.getAwsLivenessCredentials(driverId);
        if (!credentialsResponse.success || !credentialsResponse.data?.credentials) {
          throw new Error(credentialsResponse.error || 'Não foi possível preparar a verificação segura.');
        }

        if (cancelledRef.current) return;
        setStatus(STATUS.RUNNING);

        const sessionId = sessionResponse.data.sessionId;
        const region = sessionResponse.data.region || credentialsResponse.data.region || 'us-east-1';

        await nativeAwsLivenessService.start({
          sessionId,
          region,
          credentials: credentialsResponse.data.credentials,
        });

        if (cancelledRef.current) return;
        setStatus(STATUS.VERIFYING);

        const resultResponse = await kycService.getAwsLivenessSessionResult(driverId, sessionId);
        if (!resultResponse.success) {
          throw new Error(resultResponse.error || 'Não foi possível confirmar o liveness.');
        }

        const livenessData = resultResponse.data || {};
        if (livenessData.livenessPassed !== true) {
          throw new Error('Validação facial não aprovada. Tente novamente em um local bem iluminado.');
        }

        await onSuccess?.({
          sessionId,
          result: livenessData,
        });
      } catch (error) {
        if (cancelledRef.current) return;
        Logger.error('❌ [AWS NATIVE LIVENESS] Falha no fluxo nativo:', error);
        setStatus(STATUS.ERROR);
        setErrorMessage(error.message || 'Não foi possível concluir a validação facial.');
      }
    };

    runNativeLiveness();

    return () => {
      cancelledRef.current = true;
    };
  }, [challengeId, driverId, onSuccess, requirement]);

  const title = status === STATUS.ERROR
    ? 'Não foi possível concluir'
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
          {status === STATUS.ERROR ? errorMessage : subtitle}
        </Text>

        {status === STATUS.ERROR ? (
          <>
            <TouchableOpacity style={styles.primaryButton} onPress={onFallbackLocal}>
              <Text style={styles.primaryButtonText}>Usar validação local</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
              <Text style={styles.secondaryButtonText}>Agora não</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
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
