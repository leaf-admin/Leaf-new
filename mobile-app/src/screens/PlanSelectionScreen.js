import Logger from '../utils/Logger';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
  Dimensions
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';
import { useTranslation } from '../components/i18n/LanguageProvider';


const { width } = Dimensions.get('window');

const PlanSelectionScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  const plans = [
    {
      id: 'plus',
      name: 'Leaf Plus',
      price: 49.90,
      period: 'semana',
      color: '#2E8B57',
      gradient: ['#41D274', '#2E8B57'],
      features: [
        'Corridas ilimitadas',
        'Suporte básico',
        '100% das corridas para você',
        'App premium',
        'Sem taxa por corrida'
      ],
      popular: false
    },
    {
      id: 'elite',
      name: 'Leaf Elite',
      price: 99.90,
      period: 'semana',
      color: '#FF6B35',
      gradient: ['#FF6B35', '#E55A2B'],
      features: [
        'Corridas ilimitadas',
        'Suporte premium 24/7',
        '100% das corridas para você',
        'Prioridade nas corridas',
        'App premium',
        'Sem taxa por corrida',
        'Relatórios avançados',
        'Treinamento exclusivo'
      ],
      popular: true
    }
  ];

  const handlePlanSelection = async (plan) => {
    try {
      setSelectedPlan(plan);
      setIsLoading(true);
      
      // Verificar se usuário já tem plano ativo
      const currentPlan = await checkCurrentPlan();
      
      if (currentPlan && currentPlan.status === 'active') {
        Alert.alert(
          t('planSelection.activePlan'),
          t('planSelection.activePlanMessage'),
          [
            { text: t('messages.cancel'), style: 'cancel' },
            { text: t('planSelection.change'), onPress: () => proceedWithPlan(plan) }
          ]
        );
      } else {
        await proceedWithPlan(plan);
      }
      
    } catch (error) {
      Logger.error('Erro ao selecionar plano:', error);
      Alert.alert(t('messages.error'), t('planSelection.selectError'));
      setSelectedPlan(null);
    } finally {
      setIsLoading(false);
    }
  };

  const checkCurrentPlan = async () => {
    try {
      const response = await api.get(`/api/user/${currentUser.id}/plan`);
      return response.data.plan;
    } catch (error) {
      Logger.error('Erro ao verificar plano atual:', error);
      return null;
    }
  };

  const proceedWithPlan = async (plan) => {
    try {
      // Criar cobrança semanal
      const weeklyCharge = await createWeeklyPlanCharge(plan);
      
      // Navegar para tela de pagamento
      navigation.navigate('WeeklyPaymentScreen', {
        plan: plan,
        charge: weeklyCharge
      });
      
    } catch (error) {
      Logger.error('Erro ao processar plano:', error);
      Alert.alert(t('messages.error'), t('planSelection.processError'));
    }
  };

  const createWeeklyPlanCharge = async (plan) => {
    try {
      const response = await api.post('/api/plans/create-charge', {
        planId: plan.id,
        userId: currentUser.id,
        amount: plan.price,
        period: 'weekly'
      });
      
      return response.data;
    } catch (error) {
      Logger.error('Erro ao criar cobrança:', error);
      throw error;
    }
  };

  const renderPlanCard = (plan) => (
    <TouchableOpacity
      key={plan.id}
      style={[
        styles.planCard,
        selectedPlan?.id === plan.id && styles.selectedPlanCard,
        { borderColor: plan.color }
      ]}
      onPress={() => handlePlanSelection(plan)}
      disabled={isLoading}
    >
      {plan.popular && (
        <View style={[styles.popularBadge, { backgroundColor: plan.color }]}>
          <Text style={styles.popularText}>MAIS POPULAR</Text>
        </View>
      )}
      
      <View style={styles.planHeader}>
        <Text style={[styles.planName, { color: plan.color }]}>
          {plan.name}
        </Text>
        <View style={styles.priceContainer}>
          <Text style={styles.currency}>R$</Text>
          <Text style={[styles.price, { color: plan.color }]}>
            {plan.price.toFixed(2).replace('.', ',')}
          </Text>
          <Text style={styles.period}>/{plan.period}</Text>
        </View>
      </View>
      
      <View style={styles.featuresContainer}>
        {plan.features.map((feature, index) => (
          <View key={index} style={styles.featureItem}>
            <Icon 
              name="check-circle" 
              type="material" 
              color={plan.color} 
              size={20} 
            />
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>
      
      <View style={styles.planFooter}>
        <Text style={styles.planDescription}>
          {plan.id === 'plus' 
            ? 'Ideal para motoristas que querem começar'
            : 'Para motoristas que querem maximizar seus ganhos'
          }
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderComparisonTable = () => (
    <View style={styles.comparisonContainer}>
      <Text style={styles.comparisonTitle}>Comparação de Planos</Text>
      
      <View style={styles.comparisonTable}>
        <View style={styles.tableHeader}>
          <Text style={styles.tableHeaderText}>Recurso</Text>
          <Text style={styles.tableHeaderText}>Plus</Text>
          <Text style={styles.tableHeaderText}>Elite</Text>
        </View>
        
        {comparisonData.map((item, index) => (
          <View key={index} style={styles.tableRow}>
            <Text style={styles.tableFeature}>{item.feature}</Text>
            <Icon 
              name={item.plus ? "check" : "close"} 
              type="material" 
              color={item.plus ? "#2E8B57" : "#FF5722"} 
              size={20} 
            />
            <Icon 
              name={item.elite ? "check" : "close"} 
              type="material" 
              color={item.elite ? "#FF6B35" : "#FF5722"} 
              size={20} 
            />
          </View>
        ))}
      </View>
    </View>
  );

  const comparisonData = [
    { feature: 'Corridas Ilimitadas', plus: true, elite: true },
    { feature: '100% das Corridas', plus: true, elite: true },
    { feature: 'Suporte Premium', plus: false, elite: true },
    { feature: 'Prioridade nas Corridas', plus: false, elite: true },
    { feature: 'Relatórios Avançados', plus: false, elite: true },
    { feature: 'Treinamento Exclusivo', plus: false, elite: true },
    { feature: 'App Premium', plus: true, elite: true },
    { feature: 'Sem Taxa por Corrida', plus: true, elite: true }
  ];

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
        
        <Text style={styles.headerTitle}>Escolha seu Plano</Text>
        
        <View style={styles.headerSpacer} />
      </View>
      
      <ScrollView 
        style={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introSection}>
          <Text style={styles.introTitle}>
            Maximize seus ganhos com Leaf
          </Text>
          <Text style={styles.introSubtitle}>
            Escolha o plano ideal para você e receba 100% do valor das suas corridas
          </Text>
        </View>
        
        <View style={styles.plansContainer}>
          {plans.map(renderPlanCard)}
        </View>
        
        {renderComparisonTable()}
        
        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Icon name="info" type="material" color="#3498db" size={24} />
            <Text style={styles.infoTitle}>Como funciona?</Text>
            <Text style={styles.infoText}>
              Você paga uma taxa semanal fixa e recebe 100% do valor de todas as suas corridas. 
              Sem surpresas, sem taxas ocultas.
            </Text>
          </View>
          
          <View style={styles.infoCard}>
            <Icon name="security" type="material" color="#27ae60" size={24} />
            <Text style={styles.infoTitle}>Segurança Garantida</Text>
            <Text style={styles.infoText}>
              Seus pagamentos são processados com segurança pela Woovi. 
              Dados protegidos e transações seguras.
            </Text>
          </View>
        </View>
      </ScrollView>
      
      {selectedPlan && (
        <View style={styles.bottomButton}>
          <TouchableOpacity
            style={[styles.selectButton, { backgroundColor: selectedPlan.color }]}
            onPress={() => handlePlanSelection(selectedPlan)}
            disabled={isLoading}
          >
            <Text style={styles.selectButtonText}>
              {isLoading ? 'Processando...' : `Escolher ${selectedPlan.name}`}
            </Text>
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
  introSection: {
    padding: 20,
    backgroundColor: '#fff',
    marginBottom: 20,
  },
  introTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 8,
  },
  introSubtitle: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
    lineHeight: 22,
  },
  plansContainer: {
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  planCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    position: 'relative',
  },
  selectedPlanCard: {
    borderWidth: 3,
    elevation: 8,
    shadowOpacity: 0.2,
  },
  popularBadge: {
    position: 'absolute',
    top: -12,
    right: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  popularText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  planHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  planName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  currency: {
    fontSize: 18,
    fontWeight: '600',
    color: '#7f8c8d',
  },
  price: {
    fontSize: 32,
    fontWeight: 'bold',
    marginHorizontal: 4,
  },
  period: {
    fontSize: 16,
    color: '#7f8c8d',
  },
  featuresContainer: {
    marginBottom: 20,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 16,
    color: '#2c3e50',
    marginLeft: 12,
    flex: 1,
  },
  planFooter: {
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 16,
  },
  planDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  comparisonContainer: {
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  comparisonTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 20,
  },
  comparisonTable: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  tableHeaderText: {
    flex: 1,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tableFeature: {
    flex: 1,
    fontSize: 14,
    color: '#2c3e50',
  },
  infoSection: {
    paddingHorizontal: 20,
    marginBottom: 100,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: 12,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
  },
  bottomButton: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  selectButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  selectButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default PlanSelectionScreen; 