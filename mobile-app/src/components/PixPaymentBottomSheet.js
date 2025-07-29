import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { QRCode } from 'react-native-qrcode-svg';
import BottomSheetWrapper from './BottomSheetWrapper';
import { createPixCharge, checkPaymentStatus } from '../services/paymentService';
import { getFinalFareValue } from '../utils/minimumFareValidator';

const PixPaymentBottomSheet = ({ 
  tripData, 
  isVisible, 
  onClose, 
  onPaymentSuccess,
  onPaymentFailed 
}) => {
  const [qrCodeData, setQrCodeData] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [countdown, setCountdown] = useState(300); // 5 minutos
  const [chargeId, setChargeId] = useState(null);

  useEffect(() => {
    if (isVisible && tripData) {
      initializePayment();
    }
  }, [isVisible, tripData]);

  useEffect(() => {
    let timer;
    if (countdown > 0 && paymentStatus === 'pending') {
      timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
    } else if (countdown === 0) {
      setPaymentStatus('expired');
      onPaymentFailed(new Error('Tempo expirado'));
    }
    return () => clearTimeout(timer);
  }, [countdown, paymentStatus]);

  const initializePayment = async () => {
    try {
      // Aplicar tarifa mínima
      const fareInfo = getFinalFareValue(tripData.value);
      
      // Criar cobrança PIX
      const chargeData = {
        value: fareInfo.finalValue,
        correlationID: `trip_${tripData.id || Date.now()}_${Date.now()}`,
        comment: `Corrida Leaf - ${tripData.destination || 'Destino'}`,
        expiresIn: 300 // 5 minutos
      };

      const response = await createPixCharge(chargeData);
      setQrCodeData(response.data.qrCode);
      setChargeId(response.data.identifier);
      
      // Iniciar monitoramento
      startPaymentMonitoring();
    } catch (error) {
      console.error('Erro ao inicializar pagamento:', error);
      Alert.alert('Erro', 'Falha ao gerar pagamento PIX');
      onPaymentFailed(error);
    }
  };

  const startPaymentMonitoring = () => {
    const interval = setInterval(async () => {
      try {
        if (!chargeId) return;
        
        const status = await checkPaymentStatus(chargeId);
        
        if (status.data.status === 'CONFIRMED') {
          setPaymentStatus('confirmed');
          clearInterval(interval);
          onPaymentSuccess({ chargeId, amount: tripData.value });
        } else if (status.data.status === 'EXPIRED') {
          setPaymentStatus('expired');
          clearInterval(interval);
          onPaymentFailed(new Error('Pagamento expirado'));
        }
      } catch (error) {
        console.error('Erro ao verificar status:', error);
      }
    }, 2000); // Verificar a cada 2 segundos

    // Limpar intervalo após 5 minutos
    setTimeout(() => {
      clearInterval(interval);
    }, 300000);
  };

  const renderPaymentContent = () => (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pagamento PIX</Text>
        <Text style={styles.subtitle}>Escaneie o QR Code para pagar</Text>
      </View>

      {qrCodeData && (
        <View style={styles.qrContainer}>
          <QRCode
            value={qrCodeData}
            size={200}
            color="black"
            backgroundColor="white"
          />
        </View>
      )}

      <View style={styles.infoContainer}>
        <Text style={styles.amount}>
          R$ {tripData?.value?.toFixed(2) || '0.00'}
        </Text>
        
        {(() => {
          const fareInfo = getFinalFareValue(tripData?.value);
          if (fareInfo.wasAdjusted) {
            return (
              <Text style={styles.adjustedFare}>
                Valor ajustado automaticamente para o mínimo
              </Text>
            );
          }
          return null;
        })()}

        <Text style={styles.timer}>
          Tempo restante: {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
        </Text>
      </View>

      {paymentStatus === 'confirmed' && (
        <View style={styles.successContainer}>
          <Text style={styles.successText}>✅ Pagamento confirmado!</Text>
        </View>
      )}

      {paymentStatus === 'expired' && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>❌ Pagamento expirado</Text>
        </View>
      )}
    </View>
  );

  return (
    <BottomSheetWrapper
      snapPoints={['60%', '80%']}
      index={isVisible ? 1 : -1}
      onClose={onClose}
    >
      {renderPaymentContent()}
    </BottomSheetWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  qrContainer: {
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  amount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginBottom: 8,
  },
  adjustedFare: {
    fontSize: 14,
    color: '#FF6B35',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  timer: {
    fontSize: 16,
    color: '#666',
  },
  successContainer: {
    backgroundColor: '#D4EDDA',
    padding: 15,
    borderRadius: 8,
    marginTop: 10,
  },
  successText: {
    color: '#155724',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  errorContainer: {
    backgroundColor: '#F8D7DA',
    padding: 15,
    borderRadius: 8,
    marginTop: 10,
  },
  errorText: {
    color: '#721C24',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

export default PixPaymentBottomSheet; 