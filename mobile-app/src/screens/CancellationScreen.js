import Logger from '../utils/Logger';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  Dimensions,
  Alert,
  ScrollView
} from 'react-native';
import { Icon } from 'react-native-elements';
import BottomSheetWrapper from '../components/BottomSheetWrapper';

const { width, height } = Dimensions.get('window');

const CancellationScreen = ({ navigation, route }) => {
  const { tripData, driverInfo } = route.params || {};
  const [selectedReason, setSelectedReason] = useState(null);

  const cancellationReasons = [
    {
      id: 'long_wait',
      title: 'Tempo de espera muito longo',
      description: 'Motorista demorou muito para chegar',
      icon: 'schedule'
    },
    {
      id: 'wrong_location',
      title: 'Local incorreto',
      description: 'Endereço de origem ou destino errado',
      icon: 'location-off'
    },
    {
      id: 'change_plans',
      title: 'Mudança de planos',
      description: 'Decidiu não fazer a viagem',
      icon: 'change-circle'
    },
    {
      id: 'app_issue',
      title: 'Problema com o app',
      description: 'Erro técnico ou bug',
      icon: 'bug-report'
    },
    {
      id: 'driver_issue',
      title: 'Problema com motorista',
      description: 'Comportamento inadequado ou inseguro',
      icon: 'person-off'
    },
    {
      id: 'other',
      title: 'Outro motivo',
      description: 'Especifique o motivo',
      icon: 'more-horiz'
    }
  ];

  const handleCancelTrip = () => {
    if (!selectedReason) {
      Alert.alert('Atenção', 'Por favor, selecione um motivo para o cancelamento.');
      return;
    }

    Alert.alert(
      'Confirmar Cancelamento',
      'Tem certeza que deseja cancelar esta viagem?',
      [
        { text: 'Não', style: 'cancel' },
        { 
          text: 'Sim, Cancelar', 
          style: 'destructive',
          onPress: () => processCancellation()
        }
      ]
    );
  };

  const processCancellation = () => {
    // Aqui você implementaria a lógica de cancelamento
    Logger.log('Cancelando viagem:', {
      tripId: tripData?.id,
      reason: selectedReason,
      timestamp: new Date().toISOString()
    });

    // Simular processamento
    setTimeout(() => {
      navigation.navigate('CancellationSuccess', {
        tripData,
        reason: selectedReason,
        refundInfo: {
          amount: tripData?.amount,
          percentage: 100, // 100% de reembolso se ainda não iniciou
          estimatedTime: '2-5 dias úteis'
        }
      });
    }, 1000);
  };

  const handleContactSupport = () => {
    navigation.navigate('Support', {
      issue: 'cancellation_help',
      tripData
    });
  };

  const getRefundInfo = () => {
    const tripStatus = tripData?.status || 'pending';
    
    switch (tripStatus) {
      case 'pending':
        return {
          percentage: 100,
          message: 'Reembolso integral (100%)',
          time: '2-5 dias úteis'
        };
      case 'driver_assigned':
        return {
          percentage: 95,
          message: 'Reembolso de 95%',
          time: '2-5 dias úteis'
        };
      case 'driver_arrived':
        return {
          percentage: 90,
          message: 'Reembolso de 90%',
          time: '2-5 dias úteis'
        };
      case 'trip_started':
        return {
          percentage: 50,
          message: 'Reembolso de 50%',
          time: '3-7 dias úteis'
        };
      default:
        return {
          percentage: 100,
          message: 'Reembolso integral',
          time: '2-5 dias úteis'
        };
    }
  };

  const refundInfo = getRefundInfo();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#E67E22" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" type="material" color="#fff" size={24} />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Cancelar Viagem</Text>
        
        <View style={styles.placeholder} />
      </View>

      {/* Conteúdo Principal */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Informações da Viagem */}
        <View style={styles.tripInfo}>
          <Text style={styles.sectionTitle}>Detalhes da Viagem</Text>
          
          <View style={styles.tripDetails}>
            <View style={styles.detailRow}>
              <Icon name="location-on" type="material" color="#2E8B57" size={20} />
              <Text style={styles.detailText}>
                {tripData?.pickup || 'Local de partida'}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Icon name="location-on" type="material" color="#FF6B35" size={20} />
              <Text style={styles.detailText}>
                {tripData?.destination || 'Destino'}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Icon name="attach-money" type="material" color="#3498DB" size={20} />
              <Text style={styles.detailText}>
                R$ {tripData?.amount?.toFixed(2) || '0.00'}
              </Text>
            </View>
          </View>
        </View>

        {/* Informações de Reembolso */}
        <View style={styles.refundInfo}>
          <Text style={styles.sectionTitle}>Informações de Reembolso</Text>
          
          <View style={styles.refundCard}>
            <View style={styles.refundPercentage}>
              <Text style={styles.percentageText}>{refundInfo.percentage}%</Text>
              <Text style={styles.percentageLabel}>de reembolso</Text>
            </View>
            
            <View style={styles.refundDetails}>
              <Text style={styles.refundMessage}>{refundInfo.message}</Text>
              <Text style={styles.refundTime}>
                Tempo estimado: {refundInfo.time}
              </Text>
            </View>
          </View>
        </View>

        {/* Motivos de Cancelamento */}
        <View style={styles.reasonsSection}>
          <Text style={styles.sectionTitle}>Por que você está cancelando?</Text>
          
          {cancellationReasons.map((reason) => (
            <TouchableOpacity
              key={reason.id}
              style={[
                styles.reasonCard,
                selectedReason === reason.id && styles.selectedReason
              ]}
              onPress={() => setSelectedReason(reason.id)}
            >
              <View style={styles.reasonIcon}>
                <Icon 
                  name={reason.icon} 
                  type="material" 
                  color={selectedReason === reason.id ? '#fff' : '#2E8B57'} 
                  size={20} 
                />
              </View>
              
              <View style={styles.reasonText}>
                <Text style={[
                  styles.reasonTitle,
                  selectedReason === reason.id && styles.selectedReasonText
                ]}>
                  {reason.title}
                </Text>
                <Text style={[
                  styles.reasonDescription,
                  selectedReason === reason.id && styles.selectedReasonText
                ]}>
                  {reason.description}
                </Text>
              </View>
              
              {selectedReason === reason.id && (
                <Icon name="check-circle" type="material" color="#fff" size={20} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Bottom Sheet - Ações */}
      <BottomSheetWrapper
        snapPoints={['25%', '35%']}
        index={0}
        onClose={() => {}}
      >
        <View style={styles.bottomSheetContent}>
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.cancelButton]}
              onPress={handleCancelTrip}
            >
              <Icon name="cancel" type="material" color="#fff" size={20} />
              <Text style={styles.actionButtonText}>Cancelar Viagem</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionButton, styles.supportButton]}
              onPress={handleContactSupport}
            >
              <Icon name="support-agent" type="material" color="#E67E22" size={20} />
              <Text style={[styles.actionButtonText, { color: '#E67E22' }]}>
                Falar com Suporte
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
    backgroundColor: '#E67E22',
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
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 15,
  },
  tripInfo: {
    marginTop: 20,
    marginBottom: 20,
  },
  tripDetails: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailText: {
    fontSize: 16,
    color: '#2c3e50',
    marginLeft: 12,
    flex: 1,
  },
  refundInfo: {
    marginBottom: 20,
  },
  refundCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  refundPercentage: {
    alignItems: 'center',
    marginRight: 20,
  },
  percentageText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#27AE60',
  },
  percentageLabel: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  refundDetails: {
    flex: 1,
  },
  refundMessage: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  refundTime: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  reasonsSection: {
    marginBottom: 20,
  },
  reasonCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  selectedReason: {
    backgroundColor: '#2E8B57',
  },
  reasonIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f2f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  reasonText: {
    flex: 1,
  },
  reasonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  reasonDescription: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  selectedReasonText: {
    color: '#fff',
  },
  bottomSheetContent: {
    padding: 20,
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
  cancelButton: {
    backgroundColor: '#E74C3C',
  },
  supportButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E67E22',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default CancellationScreen; 