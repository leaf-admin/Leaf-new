/**
 * 🔐 KYC Camera Screen
 *
 * Validação local de presença para o fluxo novo do motorista.
 * Usa CameraView porque expo-camera@17 não expõe mais a API antiga <Camera />.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Logger from '../../utils/Logger';

const { width } = Dimensions.get('window');

const LEAF_GREEN = '#1A330E';
const LEAF_TEXT = '#111111';
const LEAF_MUTED = '#69736B';
const LEAF_BORDER = 'rgba(255,255,255,0.24)';

const LIVENESS_STEPS = [
  'Centralize seu rosto no quadro',
  'Olhe para a câmera por um instante',
  'Mantenha o rosto bem iluminado',
];

export default function KYCCameraScreen({ onCapture, onCancel }) {
  const [hasPermission, setHasPermission] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [mountError, setMountError] = useState('');
  const [started, setStarted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const cameraRef = useRef(null);
  const stepTimerRef = useRef(null);

  const instruction = useMemo(() => {
    if (mountError) return 'Não foi possível abrir a câmera';
    if (!cameraReady) return 'Preparando câmera...';
    if (!started) return 'Vamos confirmar que é você';
    return LIVENESS_STEPS[Math.min(stepIndex, LIVENESS_STEPS.length - 1)];
  }, [cameraReady, mountError, started, stepIndex]);

  useEffect(() => {
    let mounted = true;

    const requestCameraPermission = async () => {
      try {
        const { status } = await Camera.requestCameraPermissionsAsync();
        if (mounted) {
          setHasPermission(status === 'granted');
        }
      } catch (error) {
        Logger.error('Erro ao solicitar permissão da câmera:', error);
        if (mounted) {
          setHasPermission(false);
        }
      }
    };

    requestCameraPermission();

    return () => {
      mounted = false;
      if (stepTimerRef.current) {
        clearInterval(stepTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!started) {
      return undefined;
    }

    setStepIndex(0);
    setCaptureEnabled(false);
    stepTimerRef.current = setInterval(() => {
      setStepIndex((current) => {
        const next = current + 1;
        if (next >= LIVENESS_STEPS.length - 1) {
          setCaptureEnabled(true);
        }
        if (next >= LIVENESS_STEPS.length) {
          if (stepTimerRef.current) {
            clearInterval(stepTimerRef.current);
            stepTimerRef.current = null;
          }
          return LIVENESS_STEPS.length - 1;
        }
        return next;
      });
    }, 900);

    return () => {
      if (stepTimerRef.current) {
        clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
    };
  }, [started]);

  const handleStart = () => {
    if (!cameraReady || mountError) {
      return;
    }
    setStarted(true);
  };

  const capturePhoto = async () => {
    if (!cameraRef.current || capturing || !captureEnabled) {
      return;
    }

    setCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: false,
        skipProcessing: false,
      });

      if (!photo?.uri) {
        throw new Error('Foto não retornou URI válida.');
      }

      onCapture?.(photo.uri);
    } catch (error) {
      Logger.error('Erro ao capturar foto:', error);
      Alert.alert('Validação facial', 'Não foi possível capturar a foto. Tente novamente.');
      setCapturing(false);
    }
  };

  if (hasPermission === null) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator size="large" color={LEAF_GREEN} />
        <Text style={styles.permissionText}>Solicitando acesso à câmera...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.permissionContainer}>
        <MaterialCommunityIcons name="camera-off" size={64} color={LEAF_MUTED} />
        <Text style={styles.permissionTitle}>Câmera desativada</Text>
        <Text style={styles.permissionText}>
          Para ficar online, permita o acesso à câmera nas configurações do aparelho.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={onCancel}>
          <Text style={styles.primaryButtonText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="front"
        mode="picture"
        mirror
        onCameraReady={() => setCameraReady(true)}
        onMountError={(event) => {
          const message = event?.message || event?.nativeEvent?.message || 'Erro ao iniciar câmera';
          Logger.error('Erro ao montar câmera KYC:', message);
          setMountError(message);
        }}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} onPress={onCancel}>
            <MaterialCommunityIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.guideContainer} pointerEvents="none">
          <View style={[styles.guide, started && styles.guideActive]} />
        </View>

        <View style={styles.bottomPanel}>
          <View style={styles.stepRow}>
            {LIVENESS_STEPS.map((step, index) => (
              <View
                key={step}
                style={[
                  styles.stepDot,
                  started && index <= stepIndex ? styles.stepDotActive : null,
                ]}
              />
            ))}
          </View>

          <Text style={styles.title}>Confirmação rápida</Text>
          <Text style={styles.instruction}>{instruction}</Text>

          {mountError ? (
            <Text style={styles.errorText}>{mountError}</Text>
          ) : null}

          {!started ? (
            <TouchableOpacity
              style={[styles.primaryButton, (!cameraReady || mountError) && styles.buttonDisabled]}
              onPress={handleStart}
              disabled={!cameraReady || Boolean(mountError)}
            >
              <Text style={styles.primaryButtonText}>Iniciar validação</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (!captureEnabled || capturing) && styles.buttonDisabled,
              ]}
              onPress={capturePhoto}
              disabled={!captureEnabled || capturing}
            >
              {capturing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {captureEnabled ? 'Capturar foto' : 'Preparando...'}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  permissionTitle: {
    marginTop: 18,
    color: LEAF_TEXT,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionText: {
    marginTop: 12,
    color: LEAF_MUTED,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    paddingTop: 56,
    paddingHorizontal: 20,
    alignItems: 'flex-end',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.44)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guide: {
    width: width * 0.68,
    height: width * 0.86,
    borderRadius: width * 0.34,
    borderWidth: 2,
    borderColor: LEAF_BORDER,
  },
  guideActive: {
    borderColor: 'rgba(255,255,255,0.86)',
  },
  bottomPanel: {
    margin: 16,
    padding: 20,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  stepRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
  },
  stepDot: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7E2',
  },
  stepDotActive: {
    backgroundColor: LEAF_GREEN,
  },
  title: {
    color: LEAF_TEXT,
    fontSize: 21,
    fontWeight: '700',
  },
  instruction: {
    marginTop: 8,
    color: LEAF_MUTED,
    fontSize: 15,
    lineHeight: 22,
  },
  errorText: {
    marginTop: 10,
    color: '#B42318',
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    marginTop: 18,
    height: 54,
    borderRadius: 27,
    backgroundColor: LEAF_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.54,
  },
});
