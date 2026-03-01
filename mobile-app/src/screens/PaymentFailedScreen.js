import Logger from '../utils/Logger';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  Dimensions,
  Alert
} from 'react-native';
import { Icon } from 'react-native-elements';
import LottieView from 'lottie-react-native';
import BottomSheetWrapper from '../components/BottomSheetWrapper';

const { width, height } = Dimensions.get('window');

const PaymentFailedScreen = ({ navigation, route }) => {
  const { error, paymentData } = route.params || {};

  const handleRetryPayment = () => {
    // Navegar de volta para a tela de pagamento
    navigation.navigate('PixPayment', { tripData: paymentData });
  };

  const handleContactSupport = () => {
    // Navegar para suporte
    navigation.navigate('Support', { 
      issue: 'payment_failed',
      error: error 
    });
  };

  const handleGoBack = () => {
    Alert.alert(
      'Voltar ao início',
      'Deseja voltar à tela inicial?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sim', onPress: () => navigation.navigate('Map') }
      ]
    );
  };

  const getErrorMessage = () => {
    if (error?.code === 'timeout') {
      return {
        title: '⏰ Tempo Expirado',
        message: 'O tempo para pagamento expirou. Tente novamente.',
        icon: 'schedule'
      };
    } else if (error?.code === 'insufficient_funds') {
      return {
        title: '💰 Saldo Insuficiente',
        message: 'Verifique se há saldo suficiente na sua conta.',
        icon: 'account-balance-wallet'
      };
    } else if (error?.code === 'network_error') {
      return {
        title: '📡 Erro de Conexão',
        message: 'Verifique sua conexão com a internet e tente novamente.',
        icon: 'wifi-off'
      };
    } else {
      return {
        title: '❌ Pagamento Falhou',
        message: 'Ocorreu um erro ao processar seu pagamento. Tente novamente.',
        icon: 'error'
      };
    }
  };

  const errorInfo = getErrorMessage();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#E74C3C" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" type="material" color="#fff" size={24} />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Pagamento Falhou</Text>
        
        <View style={styles.placeholder} />
      </View>

      {/* Conteúdo Principal */}
      <View style={styles.content}>
        {/* Animação de Erro */}
        <View style={styles.animationContainer}>
          {/* LOTTIE ANIMATION - COMENTADO PARA INVESTIGAÇÃO
          <LottieView
            source={require('../../assets/animations/payment-error.json')}
            autoPlay
            loop={false}
            onError={(error) => Logger.log('Lottie error:', error)}
            style={styles.animation}
            resizeMode="contain"
          />
          */}
          
          {/* FALLBACK: Ícone estático */}
          <Icon 
            name="error" 
            type="material" 
            color="#E74C3C" 
            size={120} 
            style={styles.animation}
          />
        </View>

        {/* Mensagem de Erro */}
        <View style={styles.messageContainer}>
          <Text style={styles.errorTitle}>{errorInfo.title}</Text>
          <Text style={styles.errorSubtitle}>
            {errorInfo.message}
          </Text>
        </View>

        {/* Detalhes do Erro */}
        <View style={styles.errorDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Código do Erro:</Text>
            <Text style={styles.detailValue}>
              {error?.code || 'UNKNOWN_ERROR'}
            </Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Tentativa:</Text>
            <Text style={styles.detailValue}>
              {new Date().toLocaleTimeString('pt-BR')}
            </Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Valor:</Text>
            <Text style={styles.detailValue}>
              R$ {paymentData?.amount?.toFixed(2) || '0.00'}
            </Text>
          </View>
        </View>
      </View>

      {/* Bottom Sheet - Soluções */}
      <BottomSheetWrapper
        snapPoints={['45%', '65%']}
        index={0}
        onClose={() => {}}
      >
        <View style={styles.bottomSheetContent}>
          <Text style={styles.bottomSheetTitle}>O que você pode fazer?</Text>
          
          <View style={styles.solutionsContainer}>
            <View style={styles.solution}>
              <View style={styles.solutionIcon}>
                <Icon name="refresh" type="material" color="#3498DB" size={20} />
              </View>
              <View style={styles.solutionText}>
                <Text style={styles.solutionTitle}>Tentar Novamente</Text>
                <Text style={styles.solutionDescription}>
                  Tente fazer o pagamento novamente
                </Text>
              </View>
            </View>
            
            <View style={styles.solution}>
              <View style={styles.solutionIcon}>
                <Icon name="support-agent" type="material" color="#E67E22" size={20} />
              </View>
              <View style={styles.solutionText}>
                <Text style={styles.solutionTitle}>Contatar Suporte</Text>
                <Text style={styles.solutionDescription}>
                  Fale com nossa equipe de suporte
                </Text>
              </View>
            </View>
            
            <View style={styles.solution}>
              <View style={styles.solutionIcon}>
                <Icon name="home" type="material" color="#95A5A6" size={20} />
              </View>
              <View style={styles.solutionText}>
                <Text style={styles.solutionTitle}>Voltar ao Início</Text>
                <Text style={styles.solutionDescription}>
                  Retorne à tela principal
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryButton]}
              onPress={handleRetryPayment}
            >
              <Icon name="refresh" type="material" color="#fff" size={20} />
              <Text style={styles.actionButtonText}>Tentar Novamente</Text>
            </TouchableOpacity>
            
            <View style={styles.secondaryButtons}>
              <TouchableOpacity
                style={[styles.actionButton, styles.secondaryButton]}
                onPress={handleContactSupport}
              >
                <Icon name="support-agent" type="material" color="#E67E22" size={20} />
                <Text style={[styles.actionButtonText, { color: '#E67E22' }]}>
                  Suporte
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.actionButton, styles.tertiaryButton]}
                onPress={handleGoBack}
              >
                <Icon name="home" type="material" color="#95A5A6" size={20} />
                <Text style={[styles.actionButtonText, { color: '#95A5A6' }]}>
                  Início
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </BottomSheetWrapper>
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
    backgroundColor: '#E74C3C',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 15,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  animationContainer: {
    width: 200,
    height: 200,
    marginBottom: 30,
  },
  animation: {
    width: '100%',
    height: '100%',
  },
  messageContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#E74C3C',
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  errorDetails: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f2f6',
  },
  detailLabel: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
  },
  bottomSheetContent: {
    padding: 20,
  },
  bottomSheetTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 20,
    textAlign: 'center',
  },
  solutionsContainer: {
    marginBottom: 30,
  },
  solution: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  solutionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f2f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  solutionText: {
    flex: 1,
  },
  solutionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  solutionDescription: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  actionButtons: {
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  primaryButton: {
    backgroundColor: '#3498DB',
  },
  secondaryButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E67E22',
  },
  tertiaryButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#95A5A6',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default PaymentFailedScreen; 