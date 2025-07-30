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
  Alert,
  ActivityIndicator
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';

const BaaSAccountScreen = ({ navigation, route }) => {
  const [accountData, setAccountData] = useState({
    account_id: '',
    balance: 0,
    status: 'active',
    created_at: '',
    bank_info: {
      bank_name: '',
      account_type: '',
      account_number: '',
      agency: ''
    },
    transactions: [],
    limits: {
      daily_transfer: 5000,
      monthly_transfer: 50000,
      daily_withdrawal: 2000,
      monthly_withdrawal: 20000
    }
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState('overview');
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  useEffect(() => {
    loadAccountData();
  }, []);

  const loadAccountData = async () => {
    try {
      setIsLoading(true);
      
      const response = await api.get(`/api/baas/account/${currentUser.id}`);
      setAccountData(response.data);
      
    } catch (error) {
      console.error('Erro ao carregar dados da conta:', error);
      Alert.alert('Erro', 'Não foi possível carregar os dados da conta');
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAccountData();
    setRefreshing(false);
  };

  const handleTransfer = () => {
    navigation.navigate('TransferMoney', {
      accountData: accountData
    });
  };

  const handleWithdraw = () => {
    navigation.navigate('WithdrawMoney', {
      accountData: accountData
    });
  };

  const handleUpdateBankInfo = () => {
    navigation.navigate('UpdateBankInfo', {
      accountData: accountData
    });
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Icon name="arrow-back" type="material" color="#2c3e50" size={24} />
      </TouchableOpacity>
      
      <Text style={styles.headerTitle}>Conta Leaf</Text>
      
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate('AccountSettings')}
      >
        <Icon name="settings" type="material" color="#2c3e50" size={24} />
      </TouchableOpacity>
    </View>
  );

  const renderTabs = () => (
    <View style={styles.tabsContainer}>
      <TouchableOpacity
        style={[styles.tab, selectedTab === 'overview' && styles.activeTab]}
        onPress={() => setSelectedTab('overview')}
      >
        <Text style={[styles.tabText, selectedTab === 'overview' && styles.activeTabText]}>
          Visão Geral
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.tab, selectedTab === 'transactions' && styles.activeTab]}
        onPress={() => setSelectedTab('transactions')}
      >
        <Text style={[styles.tabText, selectedTab === 'transactions' && styles.activeTabText]}>
          Transações
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.tab, selectedTab === 'settings' && styles.activeTab]}
        onPress={() => setSelectedTab('settings')}
      >
        <Text style={[styles.tabText, selectedTab === 'settings' && styles.activeTabText]}>
          Configurações
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderOverview = () => (
    <View style={styles.overviewContainer}>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Saldo Disponível</Text>
        <Text style={styles.balanceValue}>
          R$ {accountData.balance.toFixed(2).replace('.', ',')}
        </Text>
        <Text style={styles.balanceSubtitle}>
          Conta Leaf ativa
        </Text>
      </View>
      
      <View style={styles.accountInfoCard}>
        <Text style={styles.cardTitle}>Informações da Conta</Text>
        
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>ID da Conta:</Text>
          <Text style={styles.infoValue}>{accountData.account_id}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Status:</Text>
          <View style={styles.statusContainer}>
            <View style={[styles.statusIndicator, { backgroundColor: '#4CAF50' }]} />
            <Text style={styles.statusText}>Ativa</Text>
          </View>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Criada em:</Text>
          <Text style={styles.infoValue}>
            {new Date(accountData.created_at).toLocaleDateString('pt-BR')}
          </Text>
        </View>
      </View>
      
      <View style={styles.bankInfoCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Dados Bancários</Text>
          <TouchableOpacity onPress={handleUpdateBankInfo}>
            <Icon name="edit" type="material" color="#2E8B57" size={20} />
          </TouchableOpacity>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Banco:</Text>
          <Text style={styles.infoValue}>{accountData.bank_info.bank_name}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Tipo de Conta:</Text>
          <Text style={styles.infoValue}>{accountData.bank_info.account_type}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Agência:</Text>
          <Text style={styles.infoValue}>{accountData.bank_info.agency}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Conta:</Text>
          <Text style={styles.infoValue}>{accountData.bank_info.account_number}</Text>
        </View>
      </View>
      
      <View style={styles.limitsCard}>
        <Text style={styles.cardTitle}>Limites da Conta</Text>
        
        <View style={styles.limitsGrid}>
          <View style={styles.limitItem}>
            <Text style={styles.limitLabel}>Transferência Diária</Text>
            <Text style={styles.limitValue}>
              R$ {accountData.limits.daily_transfer.toFixed(2).replace('.', ',')}
            </Text>
          </View>
          
          <View style={styles.limitItem}>
            <Text style={styles.limitLabel}>Transferência Mensal</Text>
            <Text style={styles.limitValue}>
              R$ {accountData.limits.monthly_transfer.toFixed(2).replace('.', ',')}
            </Text>
          </View>
          
          <View style={styles.limitItem}>
            <Text style={styles.limitLabel}>Saque Diário</Text>
            <Text style={styles.limitValue}>
              R$ {accountData.limits.daily_withdrawal.toFixed(2).replace('.', ',')}
            </Text>
          </View>
          
          <View style={styles.limitItem}>
            <Text style={styles.limitLabel}>Saque Mensal</Text>
            <Text style={styles.limitValue}>
              R$ {accountData.limits.monthly_withdrawal.toFixed(2).replace('.', ',')}
            </Text>
          </View>
        </View>
      </View>
      
      <View style={styles.actionsCard}>
        <Text style={styles.cardTitle}>Ações</Text>
        
        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleTransfer}
          >
            <Icon name="account-balance-wallet" type="material" color="#3498db" size={24} />
            <Text style={styles.actionText}>Transferir</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleWithdraw}
          >
            <Icon name="account-balance" type="material" color="#e74c3c" size={24} />
            <Text style={styles.actionText}>Sacar</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('TransactionHistory')}
          >
            <Icon name="history" type="material" color="#f39c12" size={24} />
            <Text style={styles.actionText}>Histórico</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('AccountStatement')}
          >
            <Icon name="description" type="material" color="#9b59b6" size={24} />
            <Text style={styles.actionText}>Extrato</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderTransactions = () => (
    <View style={styles.transactionsContainer}>
      <View style={styles.transactionsHeader}>
        <Text style={styles.cardTitle}>Transações Recentes</Text>
        <TouchableOpacity onPress={() => navigation.navigate('TransactionHistory')}>
          <Text style={styles.seeAllText}>Ver Todas</Text>
        </TouchableOpacity>
      </View>
      
      {accountData.transactions.length > 0 ? (
        accountData.transactions.slice(0, 10).map((transaction, index) => (
          <View key={index} style={styles.transactionItem}>
            <View style={styles.transactionInfo}>
              <Text style={styles.transactionType}>{transaction.type}</Text>
              <Text style={styles.transactionDate}>
                {new Date(transaction.date).toLocaleDateString('pt-BR')}
              </Text>
            </View>
            
            <View style={styles.transactionAmount}>
              <Text style={[
                styles.transactionValue,
                { color: transaction.type === 'credit' ? '#4CAF50' : '#e74c3c' }
              ]}>
                {transaction.type === 'credit' ? '+' : '-'} R$ {transaction.amount.toFixed(2).replace('.', ',')}
              </Text>
              <Text style={styles.transactionStatus}>
                {transaction.status}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.noTransactionsText}>Nenhuma transação encontrada</Text>
      )}
    </View>
  );

  const renderSettings = () => (
    <View style={styles.settingsContainer}>
      <View style={styles.settingsCard}>
        <Text style={styles.cardTitle}>Configurações da Conta</Text>
        
        <TouchableOpacity style={styles.settingItem}>
          <Icon name="security" type="material" color="#3498db" size={24} />
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Segurança</Text>
            <Text style={styles.settingSubtitle}>Configurar senhas e autenticação</Text>
          </View>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={24} />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.settingItem}>
          <Icon name="notifications" type="material" color="#f39c12" size={24} />
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Notificações</Text>
            <Text style={styles.settingSubtitle}>Configurar alertas e notificações</Text>
          </View>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={24} />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.settingItem}>
          <Icon name="account-balance" type="material" color="#e74c3c" size={24} />
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Dados Bancários</Text>
            <Text style={styles.settingSubtitle}>Atualizar informações bancárias</Text>
          </View>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={24} />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.settingItem}>
          <Icon name="description" type="material" color="#9b59b6" size={24} />
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Documentos</Text>
            <Text style={styles.settingSubtitle}>Visualizar documentos da conta</Text>
          </View>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={24} />
        </TouchableOpacity>
      </View>
      
      <View style={styles.dangerZoneCard}>
        <Text style={styles.cardTitle}>Zona de Perigo</Text>
        
        <TouchableOpacity style={styles.dangerItem}>
          <Icon name="block" type="material" color="#e74c3c" size={24} />
          <View style={styles.settingInfo}>
            <Text style={styles.dangerTitle}>Bloquear Conta</Text>
            <Text style={styles.dangerSubtitle}>Bloquear temporariamente a conta</Text>
          </View>
          <Icon name="chevron-right" type="material" color="#e74c3c" size={24} />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.dangerItem}>
          <Icon name="delete-forever" type="material" color="#e74c3c" size={24} />
          <View style={styles.settingInfo}>
            <Text style={styles.dangerTitle}>Fechar Conta</Text>
            <Text style={styles.dangerSubtitle}>Fechar permanentemente a conta</Text>
          </View>
          <Icon name="chevron-right" type="material" color="#e74c3c" size={24} />
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando dados da conta...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {renderHeader()}
      {renderTabs()}
      
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {selectedTab === 'overview' && renderOverview()}
        {selectedTab === 'transactions' && renderTransactions()}
        {selectedTab === 'settings' && renderSettings()}
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
  settingsButton: {
    padding: 8,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#2E8B57',
  },
  tabText: {
    fontSize: 14,
    color: '#7f8c8d',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  overviewContainer: {
    padding: 20,
  },
  balanceCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 8,
  },
  balanceValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginBottom: 4,
  },
  balanceSubtitle: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  accountInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
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
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  infoValue: {
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
  bankInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  limitsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  limitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  limitItem: {
    width: '50%',
    marginBottom: 16,
  },
  limitLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    marginBottom: 4,
  },
  limitValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  actionsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
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
  transactionsContainer: {
    padding: 20,
  },
  transactionsHeader: {
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
  transactionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionType: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  transactionDate: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  transactionAmount: {
    alignItems: 'flex-end',
  },
  transactionValue: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  transactionStatus: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  noTransactionsText: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  settingsContainer: {
    padding: 20,
  },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  settingInfo: {
    flex: 1,
    marginLeft: 12,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  dangerZoneCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  dangerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e74c3c',
    marginBottom: 2,
  },
  dangerSubtitle: {
    fontSize: 12,
    color: '#7f8c8d',
  },
});

export default BaaSAccountScreen; 