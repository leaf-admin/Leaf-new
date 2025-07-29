import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from 'common';

const NotificationCenterScreen = ({ navigation, route }) => {
  const [notifications, setNotifications] = useState([]);
  const [filteredNotifications, setFilteredNotifications] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  const filters = [
    { id: 'all', label: 'Todas', icon: 'notifications' },
    { id: 'trip', label: 'Viagens', icon: 'directions-car' },
    { id: 'payment', label: 'Pagamentos', icon: 'payment' },
    { id: 'support', label: 'Suporte', icon: 'support-agent' },
    { id: 'system', label: 'Sistema', icon: 'settings' }
  ];

  useEffect(() => {
    loadNotifications();
  }, []);

  useEffect(() => {
    filterNotifications();
  }, [selectedFilter, notifications]);

  const loadNotifications = async () => {
    try {
      setIsLoading(true);
      
      const response = await api.get(`/api/notifications/${currentUser.id}`);
      setNotifications(response.data.notifications || []);
      
    } catch (error) {
      console.error('Erro ao carregar notificações:', error);
      Alert.alert('Erro', 'Não foi possível carregar as notificações');
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  };

  const filterNotifications = () => {
    if (selectedFilter === 'all') {
      setFilteredNotifications(notifications);
    } else {
      const filtered = notifications.filter(notification => 
        notification.type === selectedFilter
      );
      setFilteredNotifications(filtered);
    }
  };

  const markAsRead = async (notificationId) => {
    try {
      await api.put(`/api/notifications/${notificationId}/read`);
      
      setNotifications(prev => 
        prev.map(notification => 
          notification.id === notificationId 
            ? { ...notification, read: true }
            : notification
        )
      );
      
    } catch (error) {
      console.error('Erro ao marcar como lida:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.put(`/api/notifications/${currentUser.id}/read-all`);
      
      setNotifications(prev => 
        prev.map(notification => ({ ...notification, read: true }))
      );
      
    } catch (error) {
      console.error('Erro ao marcar todas como lidas:', error);
    }
  };

  const deleteNotification = async (notificationId) => {
    try {
      await api.delete(`/api/notifications/${notificationId}`);
      
      setNotifications(prev => 
        prev.filter(notification => notification.id !== notificationId)
      );
      
    } catch (error) {
      console.error('Erro ao deletar notificação:', error);
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'trip':
        return { name: 'directions-car', color: '#3498db' };
      case 'payment':
        return { name: 'payment', color: '#27ae60' };
      case 'support':
        return { name: 'support-agent', color: '#f39c12' };
      case 'system':
        return { name: 'settings', color: '#9b59b6' };
      default:
        return { name: 'notifications', color: '#7f8c8d' };
    }
  };

  const getNotificationColor = (type) => {
    switch (type) {
      case 'trip':
        return '#3498db';
      case 'payment':
        return '#27ae60';
      case 'support':
        return '#f39c12';
      case 'system':
        return '#9b59b6';
      default:
        return '#7f8c8d';
    }
  };

  const formatTime = (timestamp) => {
    const now = new Date();
    const notificationTime = new Date(timestamp);
    const diffInMinutes = Math.floor((now - notificationTime) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Agora';
    if (diffInMinutes < 60) return `${diffInMinutes} min atrás`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h atrás`;
    return notificationTime.toLocaleDateString('pt-BR');
  };

  const handleNotificationPress = (notification) => {
    // Marcar como lida
    if (!notification.read) {
      markAsRead(notification.id);
    }
    
    // Navegar para tela específica baseada no tipo
    switch (notification.type) {
      case 'trip':
        navigation.navigate('TripDetails', { tripId: notification.data?.tripId });
        break;
      case 'payment':
        navigation.navigate('PaymentDetails', { paymentId: notification.data?.paymentId });
        break;
      case 'support':
        navigation.navigate('SupportScreen');
        break;
      default:
        // Notificação geral - não navega
        break;
    }
  };

  const renderNotification = ({ item }) => {
    const icon = getNotificationIcon(item.type);
    const color = getNotificationColor(item.type);
    
    return (
      <TouchableOpacity
        style={[styles.notificationCard, !item.read && styles.unreadCard]}
        onPress={() => handleNotificationPress(item)}
      >
        <View style={styles.notificationHeader}>
          <View style={styles.notificationIcon}>
            <Icon name={icon.name} type="material" color={icon.color} size={24} />
          </View>
          
          <View style={styles.notificationInfo}>
            <Text style={styles.notificationTitle}>{item.title}</Text>
            <Text style={styles.notificationTime}>
              {formatTime(item.timestamp)}
            </Text>
          </View>
          
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => deleteNotification(item.id)}
          >
            <Icon name="delete" type="material" color="#e74c3c" size={20} />
          </TouchableOpacity>
        </View>
        
        <Text style={styles.notificationMessage}>
          {item.message}
        </Text>
        
        {item.data && (
          <View style={styles.notificationData}>
            {item.data.amount && (
              <Text style={styles.dataText}>
                Valor: R$ {item.data.amount.toFixed(2).replace('.', ',')}
              </Text>
            )}
            {item.data.tripId && (
              <Text style={styles.dataText}>
                Viagem: #{item.data.tripId}
              </Text>
            )}
          </View>
        )}
        
        {!item.read && (
          <View style={[styles.unreadIndicator, { backgroundColor: color }]} />
        )}
      </TouchableOpacity>
    );
  };

  const renderFilterTabs = () => (
    <View style={styles.filtersContainer}>
      <FlatList
        data={filters}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.filterTab,
              selectedFilter === item.id && styles.activeFilterTab
            ]}
            onPress={() => setSelectedFilter(item.id)}
          >
            <Icon 
              name={item.icon} 
              type="material" 
              color={selectedFilter === item.id ? '#2E8B57' : '#7f8c8d'} 
              size={16} 
            />
            <Text style={[
              styles.filterText,
              selectedFilter === item.id && styles.activeFilterText
            ]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.filtersList}
      />
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Icon name="notifications-none" type="material" color="#ccc" size={64} />
      <Text style={styles.emptyTitle}>Nenhuma notificação</Text>
      <Text style={styles.emptySubtitle}>
        {selectedFilter === 'all' 
          ? 'Você não tem notificações no momento'
          : `Nenhuma notificação de ${filters.find(f => f.id === selectedFilter)?.label.toLowerCase()}`
        }
      </Text>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerInfo}>
        <Text style={styles.headerTitle}>Notificações</Text>
        <Text style={styles.headerSubtitle}>
          {notifications.filter(n => !n.read).length} não lidas
        </Text>
      </View>
      
      <TouchableOpacity
        style={styles.markAllButton}
        onPress={markAllAsRead}
        disabled={!notifications.some(n => !n.read)}
      >
        <Icon name="done-all" type="material" color="#2E8B57" size={20} />
        <Text style={styles.markAllText}>Marcar todas</Text>
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando notificações...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <View style={styles.mainHeader}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
        
        <Text style={styles.mainHeaderTitle}>Centro de Notificações</Text>
        
        <View style={styles.headerSpacer} />
      </View>
      
      {renderHeader()}
      {renderFilterTabs()}
      
      <FlatList
        data={filteredNotifications}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderNotification}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.notificationsList}
      />
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
  mainHeader: {
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
  mainHeaderTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  headerSpacer: {
    width: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 2,
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
  },
  markAllText: {
    fontSize: 12,
    color: '#2E8B57',
    marginLeft: 4,
  },
  filtersContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filtersList: {
    paddingHorizontal: 16,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 16,
    backgroundColor: '#f8f9fa',
  },
  activeFilterTab: {
    backgroundColor: '#e8f5e8',
  },
  filterText: {
    fontSize: 12,
    color: '#7f8c8d',
    marginLeft: 4,
  },
  activeFilterText: {
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  notificationsList: {
    padding: 16,
  },
  notificationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    position: 'relative',
  },
  unreadCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#2E8B57',
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  notificationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  notificationInfo: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 2,
  },
  notificationTime: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  deleteButton: {
    padding: 4,
  },
  notificationMessage: {
    fontSize: 14,
    color: '#2c3e50',
    lineHeight: 20,
    marginBottom: 8,
  },
  notificationData: {
    backgroundColor: '#f8f9fa',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  dataText: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  unreadIndicator: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#7f8c8d',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#95a5a6',
    textAlign: 'center',
  },
});

export default NotificationCenterScreen; 