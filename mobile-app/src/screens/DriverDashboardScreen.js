import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Platform,
  Dimensions
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';

const { width } = Dimensions.get('window');

const DriverDashboardScreen = ({ navigation, route }) => {
  const [driverData, setDriverData] = useState({
    earnings: {
      today: 0,
      week: 0,
      month: 0,
      total_balance: 0
    },
    plan: {
      type: 'plus',
      price: 49.90,
      next_payment: '2025-08-04',
      status: 'active'
    },
    leaf_account: {
      balance: 0,
      account_id: '',
      status: 'active'
    },
    recentTrips: [],
    stats: {
      total_trips: 0,
      rating: 4.8,
      online_hours: 0,
      completion_rate: 95
    }
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  useEffect(() => {
    loadDriverData();
  }, []);

  const loadDriverData = async () => {
    try {
      setIsLoading(true);
      
      const response = await api.get(`/api/drivers/${currentUser.id}/dashboard`);
      setDriverData(response.data);
      
    } catch (error) {
      console.error('Erro ao carregar dados do motorista:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDriverData();
    setRefreshing(false);
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerInfo}>
        <Text style={styles.welcomeText}>Olá, {currentUser?.name}</Text>
        <Text style={styles.statusText}>
          {driverData.plan.status === 'active' ? 'Online' : 'Offline'}
        </Text>
      </View>
      
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate('SettingsScreen')}
      >
        <Icon name="settings" type="material" color="#2c3e50" size={24} />
      </TouchableOpacity>
    </View>
  );

  const renderEarningsCard = () => (
    <View style={styles.earningsCard}>
      <Text style={styles.cardTitle}>Seus Ganhos</Text>
      
      <View style={styles.earningsGrid}>
        <View style={styles.earningItem}>
          <Text style={styles.earningLabel}>Hoje</Text>
          <Text style={styles.earningValue}>
            R$ {driverData.earnings.today.toFixed(2).replace('.', ',')}
          </Text>
        </View>
        
        <View style={styles.earningItem}>
          <Text style={styles.earningLabel}>Esta Semana</Text>
          <Text style={styles.earningValue}>
            R$ {driverData.earnings.week.toFixed(2).replace('.', ',')}
          </Text>
        </View>
        
        <View style={styles.earningItem}>
          <Text style={styles.earningLabel}>Este Mês</Text>
          <Text style={styles.earningValue}>
            R$ {driverData.earnings.month.toFixed(2).replace('.', ',')}
          </Text>
        </View>
        
        <View style={styles.earningItem}>
          <Text style={styles.earningLabel}>Saldo Total</Text>
          <Text style={[styles.earningValue, styles.totalBalance]}>
            R$ {driverData.earnings.total_balance.toFixed(2).replace('.', ',')}
          </Text>
        </View>
      </View>
      
      <TouchableOpacity
        style={styles.withdrawButton}
        onPress={() => navigation.navigate('WithdrawMoney')}
      >
        <Text style={styles.withdrawButtonText}>Sacar Dinheiro</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPlanCard = () => (
    <View style={styles.planCard}>
      <View style={styles.planHeader}>
        <Icon name="star" type="material" color="#FF6B35" size={24} />
        <Text style={styles.planTitle}>
          Plano {driverData.plan.type === 'plus' ? 'Plus' : 'Elite'}
        </Text>
      </View>
      
      <View style={styles.planDetails}>
        <View style={styles.planDetail}>
          <Text style={styles.planLabel}>Valor Semanal:</Text>
          <Text style={styles.planValue}>
            R$ {driverData.plan.price.toFixed(2).replace('.', ',')}
          </Text>
        </View>
        
        <View style={styles.planDetail}>
          <Text style={styles.planLabel}>Próximo Pagamento:</Text>
          <Text style={styles.planValue}>
            {new Date(driverData.plan.next_payment).toLocaleDateString('pt-BR')}
          </Text>
        </View>
        
        <View style={styles.planDetail}>
          <Text style={styles.planLabel}>Status:</Text>
          <View style={styles.statusContainer}>
            <View style={[styles.statusIndicator, { backgroundColor: '#4CAF50' }]} />
            <Text style={styles.statusText}>Ativo</Text>
          </View>
        </View>
      </View>
      
      <Text style={styles.planBenefit}>
        ✅ 100% das corridas para você
      </Text>
    </View>
  );

  const renderLeafAccountCard = () => (
    <View style={styles.leafAccountCard}>
      <View style={styles.accountHeader}>
        <Icon name="account-balance" type="material" color="#2E8B57" size={24} />
        <Text style={styles.accountTitle}>Conta Leaf</Text>
      </View>
      
      <View style={styles.accountBalance}>
        <Text style={styles.balanceLabel}>Saldo Disponível</Text>
        <Text style={styles.balanceValue}>
          R$ {driverData.leaf_account.balance.toFixed(2).replace('.', ',')}
        </Text>
      </View>
      
      <View style={styles.accountDetails}>
        <View style={styles.accountDetail}>
          <Text style={styles.accountLabel}>ID da Conta:</Text>
          <Text style={styles.accountValue}>
            {driverData.leaf_account.account_id}
          </Text>
        </View>
        
        <View style={styles.accountDetail}>
          <Text style={styles.accountLabel}>Status:</Text>
          <View style={styles.statusContainer}>
            <View style={[styles.statusIndicator, { backgroundColor: '#4CAF50' }]} />
            <Text style={styles.statusText}>Ativa</Text>
          </View>
        </View>
      </View>
      
      <TouchableOpacity
        style={styles.accountButton}
        onPress={() => navigation.navigate('BaaSAccountScreen')}
      >
        <Text style={styles.accountButtonText}>Gerenciar Conta</Text>
      </TouchableOpacity>
    </View>
  );

  const renderStatsCard = () => (
    <View style={styles.statsCard}>
      <Text style={styles.cardTitle}>Estatísticas</Text>
      
      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Icon name="directions-car" type="material" color="#3498db" size={24} />
          <Text style={styles.statValue}>{driverData.stats.total_trips}</Text>
          <Text style={styles.statLabel}>Viagens</Text>
        </View>
        
        <View style={styles.statItem}>
          <Icon name="star" type="material" color="#f39c12" size={24} />
          <Text style={styles.statValue}>{driverData.stats.rating}</Text>
          <Text style={styles.statLabel}>Avaliação</Text>
        </View>
        
        <View style={styles.statItem}>
          <Icon name="schedule" type="material" color="#e74c3c" size={24} />
          <Text style={styles.statValue}>{driverData.stats.online_hours}h</Text>
          <Text style={styles.statLabel}>Online</Text>
        </View>
        
        <View style={styles.statItem}>
          <Icon name="check-circle" type="material" color="#27ae60" size={24} />
          <Text style={styles.statValue}>{driverData.stats.completion_rate}%</Text>
          <Text style={styles.statLabel}>Conclusão</Text>
        </View>
      </View>
    </View>
  );

  const renderRecentTrips = () => (
    <View style={styles.recentTripsCard}>
      <View style={styles.tripsHeader}>
        <Text style={styles.cardTitle}>Viagens Recentes</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('DriverTrips')}
        >
          <Text style={styles.seeAllText}>Ver Todas</Text>
        </TouchableOpacity>
      </View>
      
      {driverData.recentTrips.length > 0 ? (
        driverData.recentTrips.slice(0, 3).map((trip, index) => (
          <View key={index} style={styles.tripItem}>
            <View style={styles.tripInfo}>
              <Text style={styles.tripDate}>
                {new Date(trip.date).toLocaleDateString('pt-BR')}
              </Text>
              <Text style={styles.tripRoute}>
                {trip.pickup} → {trip.destination}
              </Text>
            </View>
            
            <View style={styles.tripEarnings}>
              <Text style={styles.tripValue}>
                R$ {trip.value.toFixed(2).replace('.', ',')}
              </Text>
              <Text style={styles.tripStatus}>
                {trip.status === 'completed' ? 'Concluída' : 'Em andamento'}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.noTripsText}>Nenhuma viagem recente</Text>
      )}
    </View>
  );

  const renderQuickActions = () => (
    <View style={styles.quickActionsCard}>
      <Text style={styles.cardTitle}>Ações Rápidas</Text>
      
      <View style={styles.actionsGrid}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('MapScreen')}
        >
          <Icon name="map" type="material" color="#2E8B57" size={24} />
          <Text style={styles.actionText}>Iniciar Corrida</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('EarningsReportScreen')}
        >
          <Icon name="assessment" type="material" color="#3498db" size={24} />
          <Text style={styles.actionText}>Relatório</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('MyVehiclesScreen')}
        >
          <Icon name="directions-car" type="material" color="#e74c3c" size={24} />
          <Text style={styles.actionText}>Veículos</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('SupportScreen')}
        >
          <Icon name="support-agent" type="material" color="#f39c12" size={24} />
          <Text style={styles.actionText}>Suporte</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {renderHeader()}
      
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {renderEarningsCard()}
        {renderPlanCard()}
        {renderLeafAccountCard()}
        {renderStatsCard()}
        {renderRecentTrips()}
        {renderQuickActions()}
      </ScrollView>
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
  headerInfo: {
    flex: 1,
  },
  welcomeText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  statusText: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 4,
  },
  settingsButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  earningsCard: {
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
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  earningsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  earningItem: {
    width: '50%',
    marginBottom: 16,
  },
  earningLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    marginBottom: 4,
  },
  earningValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  totalBalance: {
    color: '#2E8B57',
    fontSize: 20,
  },
  withdrawButton: {
    backgroundColor: '#2E8B57',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  withdrawButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  planCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  planTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginLeft: 8,
  },
  planDetails: {
    marginBottom: 16,
  },
  planDetail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  planLabel: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  planValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  planBenefit: {
    fontSize: 14,
    color: '#2E8B57',
    fontWeight: '600',
  },
  leafAccountCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  accountTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginLeft: 8,
  },
  accountBalance: {
    alignItems: 'center',
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    marginBottom: 4,
  },
  balanceValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E8B57',
  },
  accountDetails: {
    marginBottom: 16,
  },
  accountDetail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  accountLabel: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  accountValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
  },
  accountButton: {
    backgroundColor: '#f8f9fa',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  accountButtonText: {
    color: '#2E8B57',
    fontSize: 16,
    fontWeight: '600',
  },
  statsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statItem: {
    width: '50%',
    alignItems: 'center',
    marginBottom: 16,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  recentTripsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tripsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  seeAllText: {
    fontSize: 14,
    color: '#2E8B57',
    fontWeight: '600',
  },
  tripItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tripInfo: {
    flex: 1,
  },
  tripDate: {
    fontSize: 12,
    color: '#7f8c8d',
    marginBottom: 4,
  },
  tripRoute: {
    fontSize: 14,
    color: '#2c3e50',
  },
  tripEarnings: {
    alignItems: 'flex-end',
  },
  tripValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2E8B57',
  },
  tripStatus: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 2,
  },
  noTripsText: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  quickActionsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  actionButton: {
    width: '50%',
    alignItems: 'center',
    paddingVertical: 16,
  },
  actionText: {
    fontSize: 12,
    color: '#2c3e50',
    marginTop: 8,
    textAlign: 'center',
  },
});

export default DriverDashboardScreen; 