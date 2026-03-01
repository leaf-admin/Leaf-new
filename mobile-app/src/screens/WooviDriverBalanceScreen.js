import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator
} from 'react-native';
import { useWooviDriver } from '../hooks/useWooviDriver';
import { SkeletonLoader, LoadingSpinner } from '../components/LoadingStates';
import { useResponsiveLayout } from '../components/ResponsiveLayout';

const WooviDriverBalanceScreen = ({ navigation, route }) => {
  const { driverId, driverData } = route.params || {};
  const { config: responsiveConfig, isTablet, isMobile } = useResponsiveLayout();
  
  const {
    wooviClientId,
    balance,
    charges,
    loading,
    error,
    createWooviClient,
    fetchBalance,
    fetchCharges
  } = useWooviDriver(driverId);

  const [refreshing, setRefreshing] = useState(false);

  // Criar cliente Woovi se ainda não existir
  useEffect(() => {
    if (driverData && !wooviClientId) {
      createWooviClient(driverData);
    }
  }, [driverData, wooviClientId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBalance();
    setRefreshing(false);
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value / 100);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'COMPLETED':
        return '#4CAF50';
      case 'PENDING':
        return '#FF9800';
      case 'EXPIRED':
        return '#F44336';
      default:
        return '#757575';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'COMPLETED':
        return 'Pago';
      case 'PENDING':
        return 'Pendente';
      case 'EXPIRED':
        return 'Expirado';
      default:
        return status;
    }
  };

  if (loading && !wooviClientId) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>← Voltar</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Criando conta Woovi...</Text>
        </View>
        
        <View style={styles.skeletonContainer}>
          <LoadingSpinner
            message="Criando sua conta na Woovi..."
            color="#03d69d"
          />
          <SkeletonLoader width="100%" height={120} style={styles.skeletonCard} />
          <SkeletonLoader width="100%" height={80} style={styles.skeletonCard} />
          <SkeletonLoader width="100%" height={80} style={styles.skeletonCard} />
        </View>
      </View>
    );
  }

  if (error && !wooviClientId) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>← Voltar</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Erro na conta Woovi</Text>
        </View>
        
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>❌ Erro ao criar conta Woovi</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => createWooviClient(driverData)}
          >
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Saldo Woovi</Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={onRefresh}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#03d69d" />
          ) : (
            <Text style={styles.refreshButtonText}>🔄</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#03d69d']}
            tintColor="#03d69d"
          />
        }
      >
        {/* Saldo Principal */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Saldo Disponível</Text>
          <Text style={styles.balanceValue}>
            {formatCurrency(balance)}
          </Text>
          <Text style={styles.balanceSubtext}>
            {charges.length} transações
          </Text>
        </View>

        {/* Informações da Conta */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>📱 Conta Woovi</Text>
          <Text style={styles.infoText}>
            ID: {wooviClientId}
          </Text>
          <Text style={styles.infoText}>
            Status: Ativa
          </Text>
        </View>

        {/* Histórico de Transações */}
        <View style={styles.transactionsCard}>
          <Text style={styles.transactionsTitle}>💰 Histórico de Ganhos</Text>
          
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#03d69d" />
              <Text style={styles.loadingText}>Carregando transações...</Text>
            </View>
          ) : charges.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Nenhuma transação encontrada</Text>
            </View>
          ) : (
            charges.map((charge, index) => (
              <View key={index} style={styles.transactionItem}>
                <View style={styles.transactionInfo}>
                  <Text style={styles.transactionDescription}>
                    {charge.comment}
                  </Text>
                  <Text style={styles.transactionDate}>
                    {formatDate(charge.createdAt)}
                  </Text>
                </View>
                <View style={styles.transactionValue}>
                  <Text style={styles.transactionAmount}>
                    {formatCurrency(charge.value)}
                  </Text>
                  <Text
                    style={[
                      styles.transactionStatus,
                      { color: getStatusColor(charge.status) }
                    ]}
                  >
                    {getStatusText(charge.status)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#03d69d',
    fontWeight: '600',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  refreshButton: {
    padding: 8,
  },
  refreshButtonText: {
    fontSize: 18,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  skeletonContainer: {
    flex: 1,
    padding: 16,
  },
  skeletonCard: {
    marginBottom: 16,
    borderRadius: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F44336',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#03d69d',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  balanceCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  balanceLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  balanceValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#03d69d',
    marginBottom: 4,
  },
  balanceSubtext: {
    fontSize: 14,
    color: '#999',
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  transactionsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  transactionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginLeft: 8,
    color: '#666',
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
  },
  transactionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  transactionInfo: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  transactionDate: {
    fontSize: 12,
    color: '#999',
  },
  transactionValue: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#03d69d',
    marginBottom: 2,
  },
  transactionStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
});

export default WooviDriverBalanceScreen;










