import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
  ActivityIndicator,
  Dimensions
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';
import { useTranslation } from '../components/i18n/LanguageProvider';

const { width } = Dimensions.get('window');

const FreeTrialScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const [trialData, setTrialData] = useState({
    is_first_500: false,
    free_trial_start: null,
    free_trial_end: null,
    free_months: 0,
    max_free_months: 12,
    days_remaining: 0,
    is_active: false,
    plan_type: 'plus',
    billing_status: 'active'
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState({
    days: 0,
    hours: 0,
    minutes: 0
  });
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  useEffect(() => {
    loadTrialData();
    startTimer();
  }, []);

  const loadTrialData = async () => {
    try {
      setIsLoading(true);
      
      const response = await api.get(`/api/baas/trial/${currentUser.id}`);
      const data = response.data;
      
      setTrialData(data);
      
      // Calcular dias restantes
      if (data.free_trial_end) {
        const endDate = new Date(data.free_trial_end);
        const now = new Date();
        const diffTime = endDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        setTrialData(prev => ({
          ...prev,
          days_remaining: diffDays > 0 ? diffDays : 0
        }));
      }
      
    } catch (error) {
      Logger.error('Erro ao carregar dados do período grátis:', error);
      Alert.alert(t('messages.error'), t('freeTrial.loadError'));
    } finally {
      setIsLoading(false);
    }
  };

  const startTimer = () => {
    const interval = setInterval(() => {
      if (trialData.free_trial_end) {
        const endDate = new Date(trialData.free_trial_end);
        const now = new Date();
        const diffTime = endDate - now;
        
        if (diffTime > 0) {
          const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          const hours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
          
          setTimeRemaining({ days, hours, minutes });
        } else {
          setTimeRemaining({ days: 0, hours: 0, minutes: 0 });
        }
      }
    }, 60000); // Atualizar a cada minuto
    
    return () => clearInterval(interval);
  };

  const handleUpgradePlan = () => {
    navigation.navigate('PlanSelection');
  };

  const handleReferralSystem = () => {
    navigation.navigate('ReferralScreen');
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Icon name="arrow-back" type="material" color="#2c3e50" size={24} />
      </TouchableOpacity>
      
      <Text style={styles.headerTitle}>Período Grátis</Text>
      
      <TouchableOpacity style={styles.helpButton}>
        <Icon name="help" type="material" color="#2c3e50" size={24} />
      </TouchableOpacity>
    </View>
  );

  const renderStatusCard = () => (
    <View style={styles.statusCard}>
      <View style={styles.statusHeader}>
        <Icon 
          name={trialData.is_active ? "check-circle" : "schedule"} 
          type="material" 
          color={trialData.is_active ? "#27ae60" : "#f39c12"} 
          size={32} 
        />
        <Text style={styles.statusTitle}>
          {trialData.is_active ? 'Período Grátis Ativo' : 'Período Grátis Expirado'}
        </Text>
      </View>
      
      {trialData.is_first_500 && (
        <View style={styles.badgeContainer}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Primeiros 500</Text>
          </View>
        </View>
      )}
      
      <Text style={styles.statusDescription}>
        {trialData.is_active 
          ? 'Você está aproveitando o período grátis do Leaf App!'
          : 'Seu período grátis expirou. Ative um plano para continuar.'
        }
      </Text>
    </View>
  );

  const renderTimeRemaining = () => {
    if (!trialData.is_active) return null;
    
    return (
      <View style={styles.timeCard}>
        <Text style={styles.timeTitle}>Tempo Restante</Text>
        
        <View style={styles.timeContainer}>
          <View style={styles.timeUnit}>
            <Text style={styles.timeNumber}>{timeRemaining.days}</Text>
            <Text style={styles.timeLabel}>Dias</Text>
          </View>
          
          <View style={styles.timeSeparator}>
            <Text style={styles.timeSeparatorText}>:</Text>
          </View>
          
          <View style={styles.timeUnit}>
            <Text style={styles.timeNumber}>{timeRemaining.hours.toString().padStart(2, '0')}</Text>
            <Text style={styles.timeLabel}>Horas</Text>
          </View>
          
          <View style={styles.timeSeparator}>
            <Text style={styles.timeSeparatorText}>:</Text>
          </View>
          
          <View style={styles.timeUnit}>
            <Text style={styles.timeNumber}>{timeRemaining.minutes.toString().padStart(2, '0')}</Text>
            <Text style={styles.timeLabel}>Min</Text>
          </View>
        </View>
        
        <Text style={styles.timeInfo}>
          Seu período grátis termina em {trialData.free_trial_end ? new Date(trialData.free_trial_end).toLocaleDateString() : 'data não definida'}
        </Text>
      </View>
    );
  };

  const renderStats = () => (
    <View style={styles.statsContainer}>
      <View style={styles.statCard}>
        <Text style={styles.statNumber}>{trialData.free_months}</Text>
        <Text style={styles.statLabel}>Meses Grátis</Text>
      </View>
      
      <View style={styles.statCard}>
        <Text style={styles.statNumber}>{trialData.max_free_months}</Text>
        <Text style={styles.statLabel}>Máximo</Text>
      </View>
      
      <View style={styles.statCard}>
        <Text style={styles.statNumber}>{trialData.days_remaining}</Text>
        <Text style={styles.statLabel}>Dias Restantes</Text>
      </View>
    </View>
  );

  const renderPlanInfo = () => (
    <View style={styles.planCard}>
      <Text style={styles.planTitle}>Informações do Plano</Text>
      
      <View style={styles.planRow}>
        <Text style={styles.planLabel}>Plano Atual:</Text>
        <Text style={styles.planValue}>
          {trialData.plan_type === 'elite' ? 'Leaf Elite' : 'Leaf Plus'}
        </Text>
      </View>
      
      <View style={styles.planRow}>
        <Text style={styles.planLabel}>Status:</Text>
        <View style={[
          styles.statusBadge,
          trialData.billing_status === 'active' ? styles.activeBadge : styles.suspendedBadge
        ]}>
          <Text style={styles.statusBadgeText}>
            {trialData.billing_status === 'active' ? 'Ativo' : 'Suspenso'}
          </Text>
        </View>
      </View>
      
      <View style={styles.planRow}>
        <Text style={styles.planLabel}>Valor Semanal:</Text>
        <Text style={styles.planValue}>
          R$ {trialData.plan_type === 'elite' ? '99,90' : '49,90'}
        </Text>
      </View>
      
      {trialData.free_trial_start && (
        <View style={styles.planRow}>
          <Text style={styles.planLabel}>Início:</Text>
          <Text style={styles.planValue}>
            {new Date(trialData.free_trial_start).toLocaleDateString()}
          </Text>
        </View>
      )}
    </View>
  );

  const renderActions = () => (
    <View style={styles.actionsContainer}>
      {!trialData.is_active && (
        <TouchableOpacity
          style={styles.upgradeButton}
          onPress={handleUpgradePlan}
        >
          <Icon name="upgrade" type="material" color="#fff" size={24} />
          <Text style={styles.upgradeButtonText}>Ativar Plano</Text>
        </TouchableOpacity>
      )}
      
      <TouchableOpacity
        style={styles.referralButton}
        onPress={handleReferralSystem}
      >
        <Icon name="card-giftcard" type="material" color="#fff" size={24} />
        <Text style={styles.referralButtonText}>Ganhar Meses Grátis</Text>
      </TouchableOpacity>
    </View>
  );

  const renderBenefits = () => (
    <View style={styles.benefitsCard}>
      <Text style={styles.benefitsTitle}>Benefícios do Período Grátis</Text>
      
      <View style={styles.benefitItem}>
        <Icon name="check" type="material" color="#27ae60" size={20} />
        <Text style={styles.benefitText}>
          Acesso completo ao Leaf App sem cobrança
        </Text>
      </View>
      
      <View style={styles.benefitItem}>
        <Icon name="check" type="material" color="#27ae60" size={20} />
        <Text style={styles.benefitText}>
          100% das corridas ficam com você
        </Text>
      </View>
      
      <View style={styles.benefitItem}>
        <Icon name="check" type="material" color="#27ae60" size={20} />
        <Text style={styles.benefitText}>
          Sem taxas por corrida
        </Text>
      </View>
      
      <View style={styles.benefitItem}>
        <Icon name="check" type="material" color="#27ae60" size={20} />
        <Text style={styles.benefitText}>
          Suporte completo durante o período
        </Text>
      </View>
      
      <View style={styles.benefitItem}>
        <Icon name="check" type="material" color="#27ae60" size={20} />
        <Text style={styles.benefitText}>
          Possibilidade de ganhar mais meses grátis
        </Text>
      </View>
    </View>
  );

  const renderExpiredInfo = () => {
    if (trialData.is_active) return null;
    
    return (
      <View style={styles.expiredCard}>
        <Icon name="schedule" type="material" color="#e74c3c" size={48} />
        <Text style={styles.expiredTitle}>Período Grátis Expirado</Text>
        <Text style={styles.expiredDescription}>
          Seu período grátis terminou. Para continuar usando o Leaf App, 
          você precisa ativar um plano semanal.
        </Text>
        
        <TouchableOpacity
          style={styles.activateButton}
          onPress={handleUpgradePlan}
        >
          <Text style={styles.activateButtonText}>Ativar Plano Agora</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando dados do período grátis...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8f9fa" />
      
      {renderHeader()}
      
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {renderStatusCard()}
        {renderTimeRemaining()}
        {renderStats()}
        {renderPlanInfo()}
        {renderActions()}
        {renderBenefits()}
        {renderExpiredInfo()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#7f8c8d',
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
    borderBottomColor: '#e9ecef',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  helpButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  statusCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginVertical: 10,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginLeft: 12,
  },
  badgeContainer: {
    marginBottom: 12,
  },
  badge: {
    backgroundColor: '#f39c12',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  statusDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
  },
  timeCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginVertical: 10,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  timeTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
    textAlign: 'center',
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  timeUnit: {
    alignItems: 'center',
    marginHorizontal: 8,
  },
  timeNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2E8B57',
  },
  timeLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 4,
  },
  timeSeparator: {
    marginHorizontal: 4,
  },
  timeSeparatorText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  timeInfo: {
    fontSize: 12,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E8B57',
  },
  statLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 4,
    textAlign: 'center',
  },
  planCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginVertical: 10,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  planTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  planRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  planLabel: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  planValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeBadge: {
    backgroundColor: '#d5f4e6',
  },
  suspendedBadge: {
    backgroundColor: '#fadbd8',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionsContainer: {
    paddingHorizontal: 20,
    marginVertical: 10,
  },
  upgradeButton: {
    backgroundColor: '#2E8B57',
    borderRadius: 8,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  upgradeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  referralButton: {
    backgroundColor: '#3498db',
    borderRadius: 8,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  referralButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  benefitsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginVertical: 10,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  benefitsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  benefitText: {
    fontSize: 14,
    color: '#7f8c8d',
    marginLeft: 12,
    flex: 1,
    lineHeight: 20,
  },
  expiredCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginVertical: 10,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  expiredTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#e74c3c',
    marginTop: 12,
    marginBottom: 8,
  },
  expiredDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  activateButton: {
    backgroundColor: '#e74c3c',
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 32,
  },
  activateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default FreeTrialScreen; 