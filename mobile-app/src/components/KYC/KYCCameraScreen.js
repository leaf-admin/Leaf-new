/**
 * 🔐 KYC Camera Screen
 * 
 * Tela de câmera com detecção facial e validação de liveness
 * 
 * Features:
 * - Detecção facial em tempo real
 * - Validação de liveness (piscar, sorrir, virar cabeça)
 * - Feedback visual para o usuário
 * - Captura automática quando validações passam
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
  Animated,
} from 'react-native';
import { Camera } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import faceDetectionService from '../../services/FaceDetectionService';
import Logger from '../../utils/Logger';

const { width, height } = Dimensions.get('window');

const LEAF_GREEN = '#1A330E';
const LEAF_GRAY = '#B0B0B0';

export default function KYCCameraScreen({ onCapture, onCancel, type = 'selfie' }) {
  const [hasPermission, setHasPermission] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [livenessStatus, setLivenessStatus] = useState({
    blink: false,
    smile: false,
    headMovement: false,
  });
  const [faceHistory, setFaceHistory] = useState([]);
  const [capturing, setCapturing] = useState(false);
  const [instructions, setInstructions] = useState('Posicione seu rosto no quadro');

  const cameraRef = useRef(null);
  const detectionIntervalRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    requestCameraPermission();
    initializeFaceDetection();

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Validar liveness quando houver histórico suficiente (pelo menos 10 frames)
    if (faceHistory.length >= 10 && detecting) {
      validateLiveness();
    }
  }, [faceHistory, detecting]);

  const requestCameraPermission = async () => {
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    } catch (error) {
      Logger.error('Erro ao solicitar permissão da câmera:', error);
      Alert.alert('Erro', 'Não foi possível acessar a câmera');
    }
  };

  const initializeFaceDetection = async () => {
    try {
      await faceDetectionService.initialize();
      setCameraReady(true);
    } catch (error) {
      Logger.error('Erro ao inicializar detecção facial:', error);
      Alert.alert('Aviso', 'Detecção facial não disponível. Continuando sem validação.');
      setCameraReady(true);
    }
  };

  const startFaceDetection = async () => {
    if (!cameraRef.current || detecting) return;

    setDetecting(true);
    setInstructions('Posicione seu rosto no quadro...');
    setFaceHistory([]); // Resetar histórico

    // A detecção será feita em tempo real via onFacesDetected
    // Não precisa de timeout - a câmera detecta automaticamente
    Logger.log('✅ Detecção facial iniciada (tempo real)');
  };

  const stopFaceDetection = () => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    setDetecting(false);
  };

  const handleFacesDetected = ({ faces }) => {
    if (!detecting || !faces || faces.length === 0) {
      setFaceDetected(false);
      return;
    }

    // Processar faces detectadas pelo Expo Camera (MLKit)
    const processed = faceDetectionService.processCameraFaces(faces);

    if (processed.success && processed.hasFace) {
      setFaceDetected(true);

      // Adicionar ao histórico (manter últimos 30 frames)
      setFaceHistory(prev => {
        const newHistory = [...prev, processed.face];
        return newHistory.slice(-30); // Manter apenas últimos 30 frames
      });

      // Atualizar instruções baseadas na qualidade
      if (processed.quality && !processed.quality.isValid) {
        const warnings = processed.quality.warnings || [];
        if (warnings.length > 0) {
          setInstructions(warnings[0]);
        }
      } else if (!faceDetected) {
        setInstructions('✅ Rosto detectado! Siga as instruções abaixo.');
      }
    } else {
      setFaceDetected(false);
      setInstructions('Posicione seu rosto no quadro...');
    }
  };

  const validateLiveness = async () => {
    try {
      if (faceHistory.length < 3) {
        return; // Aguardar mais frames
      }

      const result = await faceDetectionService.validateLiveness(faceHistory);

      if (result.success) {
        setLivenessStatus(result.checks);
        setInstructions('✅ Validação completa! Capturando foto...');

        // Parar detecção
        stopFaceDetection();

        // Capturar automaticamente após 0.5 segundo
        setTimeout(() => {
          capturePhoto();
        }, 500);
      } else {
        // Atualizar status parcial
        if (result.checks) {
          setLivenessStatus(result.checks);
        }

        // Instruções baseadas no que falta
        const missing = Object.entries(result.checks || {})
          .filter(([_, passed]) => !passed)
          .map(([check]) => check);

        if (missing.includes('blink')) {
          setInstructions('👁️ Piscar os olhos naturalmente');
        } else if (missing.includes('smile')) {
          setInstructions('😊 Sorrir levemente');
        } else if (missing.includes('headMovement')) {
          setInstructions('👤 Virar a cabeça levemente para os lados');
        } else {
          setInstructions('✅ Rosto detectado! Siga as instruções abaixo.');
        }
      }
    } catch (error) {
      Logger.error('Erro ao validar liveness:', error);
      // Em caso de erro, permitir captura manual
      setInstructions('Clique no botão para capturar');
    }
  };

  const capturePhoto = async () => {
    if (!cameraRef.current || capturing) return;

    setCapturing(true);
    stopFaceDetection();

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        base64: false,
        skipProcessing: true,
      });

      // Extrair o último rosto conhecido capturado pelo trackeador de vídeo ao vivo
      const lastKnownFace = faceHistory.length > 0 ? faceHistory[faceHistory.length - 1] : null;

      // Processar imagem estática validada usando os dados do feed ao vivo
      const processed = await faceDetectionService.processImage(photo.uri, lastKnownFace);

      if (processed.success) {
        // Usar imagem alinhada
        onCapture(processed.alignedUri);
      } else {
        // Se processamento falhar, usar imagem original
        Logger.warn('Processamento falhou, usando imagem original:', processed.error);
        onCapture(photo.uri);
      }
    } catch (error) {
      Logger.error('Erro ao capturar foto:', error);
      Alert.alert('Erro', 'Não foi possível capturar a foto. Tente novamente.');
    } finally {
      setCapturing(false);
    }
  };

  const handleStart = () => {
    startFaceDetection();
  };

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={LEAF_GREEN} />
        <Text style={styles.loadingText}>Solicitando permissão da câmera...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <MaterialCommunityIcons name="camera-off" size={64} color={LEAF_GRAY} />
        <Text style={styles.errorText}>Permissão da câmera negada</Text>
        <Text style={styles.errorSubtext}>
          Por favor, permita o acesso à câmera nas configurações do dispositivo
        </Text>
        <TouchableOpacity style={styles.button} onPress={onCancel}>
          <Text style={styles.buttonText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={styles.camera}
        type={Camera.Constants.Type.front}
        ratio="16:9"
        onFacesDetected={handleFacesDetected}
        faceDetectorSettings={{
          mode: Camera.Constants.FaceDetector.Mode.fast,
          detectLandmarks: Camera.Constants.FaceDetector.Landmarks.all,
          runClassifications: Camera.Constants.FaceDetector.Classifications.all,
          minDetectionInterval: 100, // Detectar a cada 100ms
          tracking: true, // Rastrear faces entre frames
        }}
      >
        {/* Overlay com guia */}
        <View style={styles.overlay}>
          {/* Guia de posicionamento */}
          <View style={styles.guideContainer}>
            <View style={[styles.guide, faceDetected && styles.guideActive]} />
          </View>

          {/* Instruções */}
          <View style={styles.instructionsContainer}>
            <Text style={styles.instructionsText}>{instructions}</Text>
          </View>

          {/* Status de liveness */}
          {faceDetected && (
            <View style={styles.livenessContainer}>
              <View style={styles.livenessItem}>
                <MaterialCommunityIcons
                  name={livenessStatus.blink ? 'check-circle' : 'circle-outline'}
                  size={20}
                  color={livenessStatus.blink ? '#4CAF50' : LEAF_GRAY}
                />
                <Text style={styles.livenessText}>Piscar</Text>
              </View>
              <View style={styles.livenessItem}>
                <MaterialCommunityIcons
                  name={livenessStatus.smile ? 'check-circle' : 'circle-outline'}
                  size={20}
                  color={livenessStatus.smile ? '#4CAF50' : LEAF_GRAY}
                />
                <Text style={styles.livenessText}>Sorrir</Text>
              </View>
              <View style={styles.livenessItem}>
                <MaterialCommunityIcons
                  name={livenessStatus.headMovement ? 'check-circle' : 'circle-outline'}
                  size={20}
                  color={livenessStatus.headMovement ? '#4CAF50' : LEAF_GRAY}
                />
                <Text style={styles.livenessText}>Movimento</Text>
              </View>
            </View>
          )}

          {/* Botões */}
          <View style={styles.controlsContainer}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <MaterialCommunityIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>

            {!detecting ? (
              <TouchableOpacity style={styles.startButton} onPress={handleStart}>
                <Text style={styles.startButtonText}>Iniciar</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.captureButton, capturing && styles.captureButtonDisabled]}
                onPress={capturePhoto}
                disabled={capturing}
              >
                {capturing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialCommunityIcons name="camera" size={32} color="#fff" />
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Camera>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
    padding: 20,
  },
  guideContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  guide: {
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: width * 0.35,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderStyle: 'dashed',
  },
  guideActive: {
    borderColor: '#4CAF50',
    borderStyle: 'solid',
  },
  instructionsContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  instructionsText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
  livenessContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  livenessItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  livenessText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 4,
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cancelButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  startButton: {
    flex: 1,
    marginLeft: 20,
    backgroundColor: LEAF_GREEN,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: LEAF_GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 20,
  },
  captureButtonDisabled: {
    opacity: 0.5,
  },
  manualCaptureButton: {
    marginTop: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignSelf: 'center',
  },
  manualCaptureText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingText: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
  },
  errorText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  errorSubtext: {
    color: LEAF_GRAY,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  button: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 24,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

