import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
  Image,
  Linking
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { createPixCharge, checkPaymentStatus } from '../services/paymentService';
import { updateTripStatus } from '../actions/tripActions';
import { formatMinimumFare, getFinalFareValue } from '../utils/minimumFareValidator';
import { useTranslation } from './i18n/LanguageProvider';


const { width } = Dimensions.get('window');

const PixPaymentScreen = ({ route }) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const dispatch = useDispatch();
  
  const { tripData } = route.params;
  const [qrCodeData, setQrCodeData] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(3600); // 1 hora em segundos

  useEffect(() => {
    generatePixPayment();
    startPaymentMonitoring();
    startTimer();
  }, []);

  const generatePixPayment = async () => {
    try {
      setLoading(true);
      
      // O valor já foi ajustado automaticamente no cálculo
      const response = await createPixCharge({
        value: tripData.value,
        correlationID: `trip_${Date.now()}_${tripData.id}`,
        comment: `Corrida Leaf - ${tripData.origin} → ${tripData.destination}`,
        expiresIn: 3600
      });

      setQrCodeData({
        qrCode: response.data.qrCodeImage,
        brCode: response.data.brCode,
        paymentLink: response.data.paymentLinkUrl,
        chargeId: response.data.charge.identifier
      });

      setLoading(false);
    } catch (error) {
      Logger.error('Erro ao gerar PIX:', error);
      setError('Erro ao gerar pagamento PIX');
      setLoading(false);
    }
  };

  const startPaymentMonitoring = () => {
    const interval = setInterval(async () => {
      if (qrCodeData?.chargeId) {
        try {
          const status = await checkPaymentStatus(qrCodeData.chargeId);
          
          if (status.data.status === 'CONFIRMED') {
            setPaymentStatus('confirmed');
            clearInterval(interval);
            
            // Atualizar status da corrida
            dispatch(updateTripStatus(tripData.id, 'PAYMENT_CONFIRMED'));
            
            // Navegar para busca de motoristas
            navigation.replace('DriverSearch', { tripData });
          }
        } catch (error) {
          Logger.error('Erro ao verificar pagamento:', error);
        }
      }
    }, 3000); // Verificar a cada 3 segundos

    // Limpar intervalo após 1 hora
    setTimeout(() => {
      clearInterval(interval);
    }, 3600000);
  };

  const startTimer = () => {
    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setPaymentStatus('expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const handleCopyPixCode = () => {
    if (qrCodeData?.brCode) {
      // Implementar cópia para clipboard
      Alert.alert(t('payment.pixCopied'));
    }
  };

  const handleOpenPaymentLink = () => {
    if (qrCodeData?.paymentLink) {
      Linking.openURL(qrCodeData.paymentLink);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      t('payment.cancelPayment'),
      t('payment.cancelConfirmation'),
      [
        { text: t('messages.cancel'), style: 'cancel' },
        { 
          text: t('messages.confirm'), 
          onPress: () => {
            navigation.goBack();
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Gerando pagamento PIX...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={generatePixPayment}>
          <Text style={styles.retryButtonText}>Tentar Novamente</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (paymentStatus === 'expired') {
    return (
      <View style={styles.container}>
        <Text style={styles.expiredText}>Tempo de pagamento expirado</Text>
        <TouchableOpacity style={styles.retryButton} onPress={generatePixPayment}>
          <Text style={styles.retryButtonText}>Gerar Novo PIX</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
              <View style={styles.header}>
          <Text style={styles.title}>Pagamento PIX</Text>
          <Text style={styles.subtitle}>Escaneie o QR Code para pagar</Text>
          <Text style={styles.minimumFare}>Valor mínimo: {formatMinimumFare()}</Text>
          {(() => {
            const fareInfo = getFinalFareValue(tripData.value);
            if (fareInfo.wasAdjusted) {
              return (
                <Text style={styles.adjustedFare}>
                  Valor ajustado automaticamente para o mínimo
                </Text>
              );
            }
            return null;
          })()}
        </View>

      {/* Informações da Corrida */}
      <View style={styles.tripInfo}>
        <Text style={styles.tripTitle}>Detalhes da Corrida</Text>
        <Text style={styles.tripDetail}>Origem: {tripData.origin}</Text>
        <Text style={styles.tripDetail}>Destino: {tripData.destination}</Text>
        <Text style={styles.tripDetail}>Valor: R$ {(tripData.value / 100).toFixed(2)}</Text>
      </View>

      {/* QR Code */}
      <View style={styles.qrContainer}>
        {qrCodeData?.qrCode ? (
          <Image 
            source={{ uri: qrCodeData.qrCode }} 
            style={styles.qrCode}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.qrPlaceholder}>
            <Text>QR Code não disponível</Text>
          </View>
        )}
      </View>

      {/* Timer */}
      <View style={styles.timerContainer}>
        <Text style={styles.timerLabel}>Tempo restante:</Text>
        <Text style={styles.timer}>{formatTime(timeRemaining)}</Text>
      </View>

      {/* Botões de Ação */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={handleCopyPixCode}>
          <Text style={styles.actionButtonText}>Copiar Código PIX</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.actionButton} onPress={handleOpenPaymentLink}>
          <Text style={styles.actionButtonText}>Abrir Link de Pagamento</Text>
        </TouchableOpacity>
      </View>

      {/* Status do Pagamento */}
      <View style={styles.statusContainer}>
        <Text style={styles.statusLabel}>Status:</Text>
        <Text style={[
          styles.statusText,
          paymentStatus === 'confirmed' ? styles.statusConfirmed : styles.statusPending
        ]}>
          {paymentStatus === 'confirmed' ? 'Pagamento Confirmado!' : 'Aguardando Pagamento...'}
        </Text>
      </View>

      {/* Botão Cancelar */}
      <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 5,
  },
  minimumFare: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    marginBottom: 5,
  },
  adjustedFare: {
    fontSize: 12,
    color: '#ff6b35',
    fontStyle: 'italic',
    marginBottom: 10,
  },
  tripInfo: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    elevation: 2,
  },
  tripTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  tripDetail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  qrCode: {
    width: width * 0.6,
    height: width * 0.6,
    borderRadius: 10,
  },
  qrPlaceholder: {
    width: width * 0.6,
    height: width * 0.6,
    backgroundColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  timerContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  timerLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  timer: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ff6b35',
  },
  actionButtons: {
    marginBottom: 20,
  },
  actionButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  statusLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusPending: {
    color: '#ff9800',
  },
  statusConfirmed: {
    color: '#4CAF50',
  },
  cancelButton: {
    backgroundColor: '#f44336',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    color: '#f44336',
    textAlign: 'center',
    marginBottom: 20,
  },
  expiredText: {
    fontSize: 16,
    color: '#ff9800',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default PixPaymentScreen; 