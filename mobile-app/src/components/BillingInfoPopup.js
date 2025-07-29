import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions
} from 'react-native';
import { Icon } from 'react-native-elements';

const { width, height } = Dimensions.get('window');

const BillingInfoPopup = ({ visible, onClose, billingType = 'operational' }) => {
  const renderOperationalFeeInfo = () => (
    <View style={styles.content}>
      <View style={styles.header}>
        <Icon name="info" type="material" color="#2E8B57" size={32} />
        <Text style={styles.title}>Nova Estrutura de Cobrança</Text>
      </View>
      
      <Text style={styles.description}>
        Implementamos uma nova estrutura de cobrança operacional mais transparente e justa:
      </Text>
      
      <View style={styles.feeStructure}>
        <View style={styles.feeItem}>
          <View style={styles.feeHeader}>
            <Icon name="local-taxi" type="material" color="#4CAF50" size={20} />
            <Text style={styles.feeTitle}>Corridas Pequenas</Text>
          </View>
          <Text style={styles.feeValue}>R$ 0,79</Text>
          <Text style={styles.feeDescription}>Corridas com valor menor que R$ 10,00</Text>
        </View>
        
        <View style={styles.feeItem}>
          <View style={styles.feeHeader}>
            <Icon name="directions-car" type="material" color="#FF9800" size={20} />
            <Text style={styles.feeTitle}>Corridas Médias</Text>
          </View>
          <Text style={styles.feeValue}>R$ 0,99</Text>
          <Text style={styles.feeDescription}>Corridas entre R$ 10,00 e R$ 20,00</Text>
        </View>
        
        <View style={styles.feeItem}>
          <View style={styles.feeHeader}>
            <Icon name="airport-shuttle" type="material" color="#E74C3C" size={20} />
            <Text style={styles.feeTitle}>Corridas Grandes</Text>
          </View>
          <Text style={styles.feeValue}>R$ 1,49</Text>
          <Text style={styles.feeDescription}>Corridas com valor maior que R$ 20,00</Text>
        </View>
      </View>
      
      <View style={styles.benefits}>
        <Text style={styles.benefitsTitle}>Benefícios da Nova Estrutura:</Text>
        <View style={styles.benefitItem}>
          <Icon name="check-circle" type="material" color="#4CAF50" size={16} />
          <Text style={styles.benefitText}>Transparência total nos custos</Text>
        </View>
        <View style={styles.benefitItem}>
          <Icon name="check-circle" type="material" color="#4CAF50" size={16} />
          <Text style={styles.benefitText}>Preços mais justos para corridas pequenas</Text>
        </View>
        <View style={styles.benefitItem}>
          <Icon name="check-circle" type="material" color="#4CAF50" size={16} />
          <Text style={styles.benefitText}>Melhor rentabilidade para motoristas</Text>
        </View>
        <View style={styles.benefitItem}>
          <Icon name="check-circle" type="material" color="#4CAF50" size={16} />
          <Text style={styles.benefitText}>Sem surpresas - valor fixo por faixa</Text>
        </View>
      </View>
    </View>
  );

  const renderPartnerBalanceInfo = () => (
    <View style={styles.content}>
      <View style={styles.header}>
        <Icon name="account-balance-wallet" type="material" color="#2E8B57" size={32} />
        <Text style={styles.title}>Sistema de Saldo do Parceiro</Text>
      </View>
      
      <Text style={styles.description}>
        Para garantir a qualidade do serviço, implementamos um sistema de saldo mínimo:
      </Text>
      
      <View style={styles.balanceInfo}>
        <View style={styles.balanceItem}>
          <Icon name="account-balance" type="material" color="#4CAF50" size={24} />
          <View style={styles.balanceText}>
            <Text style={styles.balanceTitle}>Saldo Mínimo</Text>
            <Text style={styles.balanceValue}>R$ 49,90</Text>
            <Text style={styles.balanceDescription}>Necessário para ficar online</Text>
          </View>
        </View>
        
        <View style={styles.balanceItem}>
          <Icon name="qr-code" type="material" color="#FF9800" size={24} />
          <View style={styles.balanceText}>
            <Text style={styles.balanceTitle}>QR Code de Regularização</Text>
            <Text style={styles.balanceValue}>R$ 49,90</Text>
            <Text style={styles.balanceDescription}>Valor padrão para regularizar saldo</Text>
          </View>
        </View>
      </View>
      
      <View style={styles.features}>
        <Text style={styles.featuresTitle}>Como Funciona:</Text>
        <View style={styles.featureItem}>
          <Icon name="check-circle" type="material" color="#4CAF50" size={16} />
          <Text style={styles.featureText}>Saldo é debitado automaticamente da conta Leaf</Text>
        </View>
        <View style={styles.featureItem}>
          <Icon name="check-circle" type="material" color="#4CAF50" size={16} />
          <Text style={styles.featureText}>Botão "Ficar Online" é desabilitado se saldo insuficiente</Text>
        </View>
        <View style={styles.featureItem}>
          <Icon name="check-circle" type="material" color="#4CAF50" size={16} />
          <Text style={styles.featureText}>QR Code é gerado automaticamente para regularização</Text>
        </View>
        <View style={styles.featureItem}>
          <Icon name="check-circle" type="material" color="#4CAF50" size={16} />
          <Text style={styles.featureText}>Notificações em tempo real sobre o status do saldo</Text>
        </View>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Icon name="close" type="material" color="#666666" size={24} />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            {billingType === 'operational' ? renderOperationalFeeInfo() : renderPartnerBalanceInfo()}
          </ScrollView>
          
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.understandButton} onPress={onClose}>
              <Text style={styles.understandButtonText}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  modalContainer: {
    width: width * 0.9,
    maxHeight: height * 0.8,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  
  modalHeader: {
    alignItems: 'flex-end',
    padding: 16,
  },
  
  closeButton: {
    padding: 4,
  },
  
  scrollView: {
    flex: 1,
  },
  
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginTop: 8,
    textAlign: 'center',
  },
  
  description: {
    fontSize: 16,
    color: '#666666',
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 24,
  },
  
  feeStructure: {
    marginBottom: 24,
  },
  
  feeItem: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2E8B57',
  },
  
  feeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  
  feeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginLeft: 8,
  },
  
  feeValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginBottom: 4,
  },
  
  feeDescription: {
    fontSize: 14,
    color: '#666666',
  },
  
  benefits: {
    marginBottom: 24,
  },
  
  benefitsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 16,
  },
  
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  
  benefitText: {
    fontSize: 14,
    color: '#666666',
    marginLeft: 8,
    flex: 1,
  },
  
  balanceInfo: {
    marginBottom: 24,
  },
  
  balanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  
  balanceText: {
    flex: 1,
    marginLeft: 12,
  },
  
  balanceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 4,
  },
  
  balanceValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginBottom: 4,
  },
  
  balanceDescription: {
    fontSize: 14,
    color: '#666666',
  },
  
  features: {
    marginBottom: 24,
  },
  
  featuresTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 16,
  },
  
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  
  featureText: {
    fontSize: 14,
    color: '#666666',
    marginLeft: 8,
    flex: 1,
  },
  
  modalFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  
  understandButton: {
    backgroundColor: '#2E8B57',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  
  understandButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default BillingInfoPopup; 