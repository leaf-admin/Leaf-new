import Logger from '../utils/Logger';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  Dimensions
} from 'react-native';
import { Icon } from 'react-native-elements';
import LottieView from 'lottie-react-native';
import BottomSheetWrapper from '../components/BottomSheetWrapper';

const { width, height } = Dimensions.get('window');

const PaymentSuccessScreen = ({ navigation, route }) => {
  const { paymentData } = route.params || {};

  const handleContinueToTrip = () => {
    // Navegar para a tela de busca de motoristas
    navigation.navigate('DriverSearch', { tripData: paymentData });
  };

  const handleViewReceipt = () => {
    // Navegar para detalhes do recibo
    navigation.navigate('ReceiptDetails', { paymentData });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#27AE60" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" type="material" color="#fff" size={24} />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Pagamento Confirmado</Text>
        
        <View style={styles.placeholder} />
      </View>

      {/* Conteúdo Principal */}
      <View style={styles.content}>
        {/* Animação de Sucesso */}
        <View style={styles.animationContainer}>
          {/* LOTTIE ANIMATION - COMENTADO PARA INVESTIGAÇÃO
          <LottieView
            source={require('../../assets/animations/payment-success.json')}
            autoPlay
            loop={false}
            style={styles.animation}
            onError={(error) => Logger.log('Lottie success error:', error)}
            resizeMode="contain"
          />
          */}
          
          {/* FALLBACK: Ícone estático */}
          <Icon 
            name="check-circle" 
            type="material" 
            color="#2E8B57" 
            size={120} 
            style={styles.animation}
          />
        </View>

        {/* Mensagem de Sucesso */}
        <View style={styles.messageContainer}>
          <Text style={styles.successTitle}>✅ Pagamento Confirmado!</Text>
          <Text style={styles.successSubtitle}>
            Seu pagamento foi processado com sucesso
          </Text>
        </View>

        {/* Detalhes do Pagamento */}
        <View style={styles.paymentDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Valor:</Text>
            <Text style={styles.detailValue}>
              R$ {paymentData?.amount?.toFixed(2) || '0.00'}
            </Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Método:</Text>
            <Text style={styles.detailValue}>PIX</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Data:</Text>
            <Text style={styles.detailValue}>
              {new Date().toLocaleDateString('pt-BR')}
            </Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Hora:</Text>
            <Text style={styles.detailValue}>
              {new Date().toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </Text>
          </View>
        </View>
      </View>

      {/* Bottom Sheet - Próximos Passos */}
      <BottomSheetWrapper
        snapPoints={['40%', '60%']}
        index={0}
        onClose={() => {}}
      >
        <View style={styles.bottomSheetContent}>
          <Text style={styles.bottomSheetTitle}>Próximos Passos</Text>
          
          <View style={styles.stepsContainer}>
            <View style={styles.step}>
              <View style={styles.stepIcon}>
                <Icon name="search" type="material" color="#2E8B57" size={20} />
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>1. Buscar Motoristas</Text>
                <Text style={styles.stepDescription}>
                  Encontrando motoristas próximos...
                </Text>
              </View>
            </View>
            
            <View style={styles.step}>
              <View style={styles.stepIcon}>
                <Icon name="person" type="material" color="#2E8B57" size={20} />
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>2. Selecionar Motorista</Text>
                <Text style={styles.stepDescription}>
                  Escolha o motorista de sua preferência
                </Text>
              </View>
            </View>
            
            <View style={styles.step}>
              <View style={styles.stepIcon}>
                <Icon name="directions-car" type="material" color="#2E8B57" size={20} />
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>3. Iniciar Viagem</Text>
                <Text style={styles.stepDescription}>
                  Acompanhe sua viagem em tempo real
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryButton]}
              onPress={handleContinueToTrip}
            >
              <Icon name="search" type="material" color="#fff" size={20} />
              <Text style={styles.actionButtonText}>Buscar Motoristas</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionButton, styles.secondaryButton]}
              onPress={handleViewReceipt}
            >
              <Icon name="receipt" type="material" color="#2E8B57" size={20} />
              <Text style={[styles.actionButtonText, { color: '#2E8B57' }]}>
                Ver Recibo
              </Text>
            </TouchableOpacity>
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
    backgroundColor: '#27AE60',
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
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#27AE60',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  paymentDetails: {
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
  stepsContainer: {
    marginBottom: 30,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f2f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  stepText: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  stepDescription: {
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
    backgroundColor: '#2E8B57',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#2E8B57',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default PaymentSuccessScreen; 