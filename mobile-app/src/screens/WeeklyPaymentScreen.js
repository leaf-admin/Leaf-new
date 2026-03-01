import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
  ActivityIndicator,
  ScrollView,
  Dimensions
} from 'react-native';
import { Icon } from 'react-native-elements';
import QRCode from 'react-native-qrcode-svg';
import { useSelector } from 'react-redux';
import { api } from '../common-local';
import { useTranslation } from '../components/i18n/LanguageProvider';


const { width } = Dimensions.get('window');

const WeeklyPaymentScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { plan, charge } = route.params || {};
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [qrCodeData, setQrCodeData] = useState('');
  const [paymentData, setPaymentData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(3600); // 1 hora
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  useEffect(() => {
    initializePayment();
    startPaymentTimer();
  }, []);

  const initializePayment = async () => {
    try {
      setIsLoading(true);
      
      // Criar cobrança PIX para o plano semanal
      const pixCharge = await createPixCharge();
      setPaymentData(pixCharge);
      setQrCodeData(pixCharge.qrCode);
      
      // Iniciar monitoramento do pagamento
      startPaymentMonitoring(pixCharge.id);
      
    } catch (error) {
      Logger.error('Erro ao inicializar pagamento:', error);
      Alert.alert(t('messages.error'), t('weeklyPayment.generateError'));
    } finally {
      setIsLoading(false);
    }
  };

  const createPixCharge = async () => {
    try {
      const response = await api.post('/api/payments/create-weekly-plan', {
        planId: plan.id,
        userId: currentUser.id,
        amount: plan.price,
        description: `Plano ${plan.name} - Semanal`,
        expiresIn: 3600 // 1 hora
      });
      
      return response.data;
    } catch (error) {
      Logger.error('Erro ao criar cobrança PIX:', error);
      throw error;
    }
  };

  const startPaymentMonitoring = (chargeId) => {
    // Monitorar status do pagamento via WebSocket ou polling
    const interval = setInterval(async () => {
      try {
        const status = await checkPaymentStatus(chargeId);
        
        if (status === 'confirmed') {
          clearInterval(interval);
          handlePaymentSuccess();
        } else if (status === 'expired') {
          clearInterval(interval);
          handlePaymentExpired();
        }
      } catch (error) {
        Logger.error('Erro ao verificar status:', error);
      }
    }, 5000); // Verificar a cada 5 segundos
    
    // Limpar intervalo após 1 hora
    setTimeout(() => {
      clearInterval(interval);
    }, 3600000);
  };

  const checkPaymentStatus = async (chargeId) => {
    try {
      const response = await api.get(`/api/payments/status/${chargeId}`);
      return response.data.status;
    } catch (error) {
      Logger.error('Erro ao verificar status:', error);
      return 'pending';
    }
  };

  const startPaymentTimer = () => {
    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          handlePaymentExpired();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handlePaymentSuccess = () => {
    setPaymentStatus('success');
    
    // Ativar plano do usuário
    activateUserPlan();
    
    // Navegar para tela de sucesso
    setTimeout(() => {
      navigation.navigate('PaymentSuccessScreen', {
        plan: plan,
        paymentData: paymentData
      });
    }, 2000);
  };

  const handlePaymentExpired = () => {
    setPaymentStatus('expired');
    Alert.alert(
      t('weeklyPayment.expired'),
      t('weeklyPayment.expiredMessage'),
      [
        { text: t('messages.cancel'), onPress: () => navigation.goBack() },
        { text: t('messages.retry'), onPress: initializePayment }
      ]
    );
  };

  const activateUserPlan = async () => {
    try {
      await api.post('/api/plans/activate', {
        userId: currentUser.id,
        planId: plan.id,
        paymentId: paymentData.id
      });
    } catch (error) {
      Logger.error('Erro ao ativar plano:', error);
    }
  };

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const handleCopyPixCode = () => {
    // Implementar cópia do código PIX
    Alert.alert(t('payment.pixCopied'), t('payment.pixCopiedMessage'));
  };

  const handleManualPayment = () => {
    Alert.alert(
      t('weeklyPayment.manualPayment'),
      t('weeklyPayment.manualPaymentMessage'),
      [{ text: t('messages.confirm') }]
    );
  };

  const renderPaymentInfo = () => (
    <View style={styles.paymentInfoContainer}>
      <View style={styles.planCard}>
        <Text style={styles.planName}>{plan.name}</Text>
        <Text style={styles.planPrice}>
          R$ {plan.price.toFixed(2).replace('.', ',')}
        </Text>
        <Text style={styles.planPeriod}>por semana</Text>
      </View>
      
      <View style={styles.paymentDetails}>
        <View style={styles.detailItem}>
          <Icon name="schedule" type="material" color="#666" size={20} />
          <Text style={styles.detailText}>
            Expira em: {formatTime(timeRemaining)}
          </Text>
        </View>
        
        <View style={styles.detailItem}>
          <Icon name="account-balance-wallet" type="material" color="#666" size={20} />
          <Text style={styles.detailText}>
            Pagamento via PIX
          </Text>
        </View>
        
        <View style={styles.detailItem}>
          <Icon name="security" type="material" color="#666" size={20} />
          <Text style={styles.detailText}>
            Pagamento seguro
          </Text>
        </View>
      </View>
    </View>
  );

  const renderQRCode = () => (
    <View style={styles.qrCodeContainer}>
      <Text style={styles.qrCodeTitle}>Escaneie o QR Code</Text>
      <Text style={styles.qrCodeSubtitle}>
        Use o app do seu banco para escanear
      </Text>
      
      <View style={styles.qrCodeWrapper}>
        {qrCodeData ? (
          <QRCode
            value={qrCodeData}
            size={200}
            color="#000"
            backgroundColor="#fff"
          />
        ) : (
          <View style={styles.qrCodePlaceholder}>
            <ActivityIndicator size="large" color="#2E8B57" />
            <Text style={styles.qrCodePlaceholderText}>Gerando QR Code...</Text>
          </View>
        )}
      </View>
      
      <TouchableOpacity
        style={styles.copyButton}
        onPress={handleCopyPixCode}
      >
        <Icon name="content-copy" type="material" color="#2E8B57" size={20} />
        <Text style={styles.copyButtonText}>Copiar Código PIX</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPaymentInstructions = () => (
    <View style={styles.instructionsContainer}>
      <Text style={styles.instructionsTitle}>Como pagar:</Text>
      
      <View style={styles.instructionStep}>
        <View style={styles.stepNumber}>
          <Text style={styles.stepNumberText}>1</Text>
        </View>
        <Text style={styles.instructionText}>
          Abra o app do seu banco
        </Text>
      </View>
      
      <View style={styles.instructionStep}>
        <View style={styles.stepNumber}>
          <Text style={styles.stepNumberText}>2</Text>
        </View>
        <Text style={styles.instructionText}>
          Escolha a opção PIX
        </Text>
      </View>
      
      <View style={styles.instructionStep}>
        <View style={styles.stepNumber}>
          <Text style={styles.stepNumberText}>3</Text>
        </View>
        <Text style={styles.instructionText}>
          Escaneie o QR Code ou cole o código
        </Text>
      </View>
      
      <View style={styles.instructionStep}>
        <View style={styles.stepNumber}>
          <Text style={styles.stepNumberText}>4</Text>
        </View>
        <Text style={styles.instructionText}>
          Confirme o pagamento
        </Text>
      </View>
    </View>
  );

  const renderStatusIndicator = () => {
    let statusColor = '#FFA500';
    let statusText = 'Aguardando Pagamento';
    let statusIcon = 'schedule';
    
    if (paymentStatus === 'success') {
      statusColor = '#4CAF50';
      statusText = 'Pagamento Confirmado';
      statusIcon = 'check-circle';
    } else if (paymentStatus === 'expired') {
      statusColor = '#FF5722';
      statusText = 'Pagamento Expirado';
      statusIcon = 'error';
    }
    
    return (
      <View style={styles.statusContainer}>
        <Icon name={statusIcon} type="material" color={statusColor} size={24} />
        <Text style={[styles.statusText, { color: statusColor }]}>
          {statusText}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Pagamento Semanal</Text>
        
        <View style={styles.headerSpacer} />
      </View>
      
      <ScrollView 
        style={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {renderPaymentInfo()}
        
        {renderStatusIndicator()}
        
        {paymentStatus === 'pending' && (
          <>
            {renderQRCode()}
            {renderPaymentInstructions()}
          </>
        )}
        
        {paymentStatus === 'success' && (
          <View style={styles.successContainer}>
            <Icon name="check-circle" type="material" color="#4CAF50" size={64} />
            <Text style={styles.successTitle}>Pagamento Confirmado!</Text>
            <Text style={styles.successSubtitle}>
              Seu plano {plan.name} foi ativado com sucesso
            </Text>
          </View>
        )}
        
        {paymentStatus === 'expired' && (
          <View style={styles.expiredContainer}>
            <Icon name="error" type="material" color="#FF5722" size={64} />
            <Text style={styles.expiredTitle}>Pagamento Expirado</Text>
            <Text style={styles.expiredSubtitle}>
              O tempo para pagamento expirou
            </Text>
            
            <TouchableOpacity
              style={styles.retryButton}
              onPress={initializePayment}
            >
              <Text style={styles.retryButtonText}>Tentar Novamente</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      
      {paymentStatus === 'pending' && (
        <View style={styles.bottomActions}>
          <TouchableOpacity
            style={styles.manualButton}
            onPress={handleManualPayment}
          >
            <Text style={styles.manualButtonText}>Pagamento Manual</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  paymentInfoContainer: {
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  planCard: {
    alignItems: 'center',
    marginBottom: 20,
  },
  planName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
  },
  planPrice: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2E8B57',
  },
  planPeriod: {
    fontSize: 16,
    color: '#7f8c8d',
    marginTop: 4,
  },
  paymentDetails: {
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 16,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailText: {
    fontSize: 14,
    color: '#2c3e50',
    marginLeft: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  qrCodeContainer: {
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  qrCodeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  qrCodeSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 20,
  },
  qrCodeWrapper: {
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 20,
  },
  qrCodePlaceholder: {
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrCodePlaceholderText: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 8,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  copyButtonText: {
    fontSize: 14,
    color: '#2E8B57',
    marginLeft: 8,
    fontWeight: '600',
  },
  instructionsContainer: {
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  instructionsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2E8B57',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  instructionText: {
    fontSize: 14,
    color: '#2c3e50',
    flex: 1,
  },
  successContainer: {
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginTop: 16,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  expiredContainer: {
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  expiredTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FF5722',
    marginTop: 16,
    marginBottom: 8,
  },
  expiredSubtitle: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#2E8B57',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  bottomActions: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  manualButton: {
    backgroundColor: '#f8f9fa',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  manualButtonText: {
    color: '#2E8B57',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default WeeklyPaymentScreen; 