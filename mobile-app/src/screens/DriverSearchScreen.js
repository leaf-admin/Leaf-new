import Logger from '../utils/Logger';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  StatusBar
} from 'react-native';
import { Icon } from 'react-native-elements';
// Temporariamente removido: import BottomSheet from '@gorhom/bottom-sheet';
import { useSelector, useDispatch } from 'react-redux';
import { api } from '../common-local';
import { useTranslation } from '../components/i18n/LanguageProvider';
import WebSocketManager from '../services/WebSocketManager';


const DriverSearchScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { tripData, onDriverSelect } = route.params || {};
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchRadius, setSearchRadius] = useState(5000); // 5km
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [searchTime, setSearchTime] = useState(0);
  const [searchId, setSearchId] = useState(null);
  
  const bottomSheetRef = useRef(null);
  const snapPoints = React.useMemo(() => ['25%', '50%', '75%'], []);
  
  const auth = useSelector(state => state.auth);
  const dispatch = useDispatch();
  const wsManager = WebSocketManager.getInstance();

  useEffect(() => {
    startDriverSearch();
    const interval = setInterval(() => {
      setSearchTime(prev => prev + 1);
    }, 1000);
    
    return () => {
      clearInterval(interval);
      // Cancelar busca ao sair da tela
      if (searchId) {
        cancelDriverSearch();
      }
    };
  }, []);

  const startDriverSearch = async () => {
    try {
      setIsLoading(true);
      
      // Conectar WebSocket se não estiver conectado
      if (!wsManager.isConnected()) {
        await wsManager.connect();
      }
      
      // USAR NOVO EVENTO: searchDrivers via WebSocket
      const result = await wsManager.searchDrivers(
        tripData.pickup,           // pickupLocation
        tripData.destination,     // destinationLocation
        'standard',               // rideType
        tripData.value,           // estimatedFare
        { 
          vehicleType: tripData.vehicleType || 'car',
          radius: searchRadius 
        }                        // preferences
      );
      
      if (result.success) {
        setDrivers(result.drivers);
        setSearchId(result.searchId || `search_${Date.now()}`);
        Logger.log(`✅ ${result.drivers.length} motoristas encontrados via WebSocket`);
        
        // Configurar listeners para atualizações em tempo real
        setupWebSocketListeners();
      }
      
    } catch (error) {
      Logger.error('Erro ao buscar motoristas via WebSocket:', error);
      
      // Fallback para API REST se WebSocket falhar
      try {
        const nearbyDrivers = await searchNearbyDrivers();
        setDrivers(nearbyDrivers);
        Logger.log('✅ Fallback para API REST funcionou');
      } catch (fallbackError) {
        Logger.error('Erro no fallback:', fallbackError);
        Alert.alert(t('messages.error'), t('driverSearch.searchError'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const setupWebSocketListeners = () => {
    // Listener para novos motoristas em tempo real
    wsManager.on('driversFound', (data) => {
      if (data.success && data.drivers) {
        setDrivers(prevDrivers => {
          // Atualizar lista de motoristas
          const updatedDrivers = [...prevDrivers, ...data.drivers];
          return updatedDrivers;
        });
        Logger.log('🔄 Lista de motoristas atualizada em tempo real');
      }
    });

    // Listener para mudanças de status dos motoristas
    wsManager.on('driverStatusChanged', (data) => {
      setDrivers(prevDrivers => 
        prevDrivers.map(driver => 
          driver.id === data.driverId 
            ? { ...driver, status: data.status, isOnline: data.isOnline }
            : driver
        )
      );
    });

    // Listener para atualizações de localização dos motoristas
    wsManager.on('driverLocationUpdated', (data) => {
      setDrivers(prevDrivers => 
        prevDrivers.map(driver => 
          driver.id === data.driverId 
            ? { 
                ...driver, 
                location: data.location,
                distance: calculateDistance(tripData.pickup, data.location)
              }
            : driver
        )
      );
    });
  };

  const cancelDriverSearch = async () => {
    try {
      if (searchId) {
        await wsManager.cancelDriverSearch(searchId, 'Cancelado pelo usuário');
        Logger.log('✅ Busca de motoristas cancelada');
      }
    } catch (error) {
      Logger.error('Erro ao cancelar busca:', error);
    }
  };

  const calculateDistance = (point1, point2) => {
    // Função simples para calcular distância (em km)
    const R = 6371; // Raio da Terra em km
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLon = (point2.lng - point1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const searchNearbyDrivers = async () => {
    try {
      const response = await api.post('/api/drivers/nearby', {
        latitude: tripData.pickup.latitude,
        longitude: tripData.pickup.longitude,
        radius: searchRadius,
        tripValue: tripData.value,
        vehicleType: tripData.vehicleType || 'car'
      });
      
      return response.data.drivers || [];
    } catch (error) {
      Logger.error('Erro na busca de motoristas:', error);
      return [];
    }
  };

  const handleDriverSelect = async (driver) => {
    try {
      setSelectedDriver(driver);
      
      // USAR NOVO EVENTO: cancelDriverSearch antes de selecionar
      if (searchId) {
        await wsManager.cancelDriverSearch(searchId, 'Motorista selecionado');
      }
      
      // Notificar motorista sobre a corrida
      await notifyDriver(driver.id, tripData);
      
      // Aguardar resposta do motorista
      const response = await waitForDriverResponse(driver.id, tripData.id);
      
      if (response.accepted) {
        // Motorista aceitou
        onDriverSelect?.(driver);
        navigation.navigate('TripTrackingScreen', {
          tripData,
          driverData: driver
        });
      } else {
        // Motorista recusou
        setSelectedDriver(null);
        Alert.alert(t('driverSearch.unavailable'), t('driverSearch.unavailableMessage'));
        startDriverSearch();
      }
      
    } catch (error) {
      Logger.error('Erro ao selecionar motorista:', error);
      setSelectedDriver(null);
      Alert.alert(t('messages.error'), t('driverSearch.selectionError'));
    }
  };

  const notifyDriver = async (driverId, tripData) => {
    try {
      await api.post(`/api/drivers/${driverId}/notify`, {
        tripId: tripData.id,
        pickup: tripData.pickup,
        destination: tripData.destination,
        value: tripData.value,
        estimatedTime: tripData.estimatedTime
      });
    } catch (error) {
      Logger.error('Erro ao notificar motorista:', error);
      throw error;
    }
  };

  const waitForDriverResponse = async (driverId, tripId) => {
    // Aguardar resposta do motorista (timeout de 30 segundos)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout - Motorista não respondeu'));
      }, 30000);
      
      // Implementar WebSocket para aguardar resposta
      // Esta é uma simulação
      setTimeout(() => {
        clearTimeout(timeout);
        resolve({ accepted: true }); // Simular aceitação
      }, 5000);
    });
  };

  const calculateETA = (distance) => {
    const avgSpeed = 30; // km/h
    const timeInMinutes = Math.round((distance / 1000) / (avgSpeed / 60));
    return timeInMinutes;
  };

  const formatDistance = (distance) => {
    if (distance < 1000) {
      return `${Math.round(distance)}m`;
    } else {
      return `${(distance / 1000).toFixed(1)}km`;
    }
  };

  const renderDriverCard = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.driverCard,
        selectedDriver?.id === item.id && styles.selectedDriverCard
      ]}
      onPress={() => handleDriverSelect(item)}
      disabled={selectedDriver !== null}
    >
      <View style={styles.driverHeader}>
        <View style={styles.driverInfo}>
          <Text style={styles.driverName}>{item.name}</Text>
          <View style={styles.ratingContainer}>
            <Icon name="star" type="material" color="#FFD700" size={16} />
            <Text style={styles.ratingText}>{item.rating}</Text>
            <Text style={styles.tripCount}>({item.tripCount} viagens)</Text>
          </View>
        </View>
        
        <View style={styles.driverStatus}>
          <View style={[styles.statusIndicator, { backgroundColor: item.online ? '#4CAF50' : '#FF5722' }]} />
          <Text style={styles.statusText}>
            {item.online ? 'Online' : 'Offline'}
          </Text>
        </View>
      </View>
      
      <View style={styles.vehicleInfo}>
        <Icon name="directions-car" type="material" color="#2E8B57" size={20} />
        <Text style={styles.vehicleText}>
          {item.vehicle.model} - {item.vehicle.plate}
        </Text>
      </View>
      
      <View style={styles.tripInfo}>
        <View style={styles.infoItem}>
          <Icon name="access-time" type="material" color="#666" size={16} />
          <Text style={styles.infoText}>
            {calculateETA(item.distance)} min
          </Text>
        </View>
        
        <View style={styles.infoItem}>
          <Icon name="place" type="material" color="#666" size={16} />
          <Text style={styles.infoText}>
            {formatDistance(item.distance)}
          </Text>
        </View>
        
        <View style={styles.infoItem}>
          <Icon name="attach-money" type="material" color="#666" size={16} />
          <Text style={styles.infoText}>
            R$ {item.estimatedFare}
          </Text>
        </View>
      </View>
      
      {selectedDriver?.id === item.id && (
        <View style={styles.selectingIndicator}>
          <ActivityIndicator size="small" color="#2E8B57" />
          <Text style={styles.selectingText}>Aguardando resposta...</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Icon name="search" type="material" color="#ccc" size={64} />
      <Text style={styles.emptyTitle}>Nenhum motorista encontrado</Text>
      <Text style={styles.emptySubtitle}>
        No momento, não há motoristas disponíveis nesta região. Tente novamente em alguns instantes ou verifique outras áreas próximas.
      </Text>
      <Text style={styles.searchTime}>
        Tempo de busca: {Math.floor(searchTime / 60)}:{(searchTime % 60).toString().padStart(2, '0')}
      </Text>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerInfo}>
        <Text style={styles.headerTitle}>Motoristas Próximos</Text>
        <Text style={styles.headerSubtitle}>
          {drivers.length} motoristas encontrados
        </Text>
      </View>
      
      <TouchableOpacity
        style={styles.refreshButton}
        onPress={startDriverSearch}
        disabled={isLoading}
      >
        <Icon 
          name="refresh" 
          type="material" 
          color="#2E8B57" 
          size={24}
        />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <BottomSheet
        ref={bottomSheetRef}
        index={1}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        backgroundStyle={styles.bottomSheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <View style={styles.content}>
          {renderHeader()}
          
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#2E8B57" />
              <Text style={styles.loadingText}>Buscando motoristas...</Text>
            </View>
          ) : (
            <FlatList
              data={drivers}
              renderItem={renderDriverCard}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContainer}
              ListEmptyComponent={renderEmptyState}
            />
          )}
        </View>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  bottomSheetBackground: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handleIndicator: {
    backgroundColor: '#ccc',
    width: 40,
    height: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 4,
  },
  refreshButton: {
    padding: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#7f8c8d',
  },
  listContainer: {
    paddingVertical: 10,
  },
  driverCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  selectedDriverCard: {
    borderColor: '#2E8B57',
    borderWidth: 2,
    backgroundColor: '#f0f8f0',
  },
  driverHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f39c12',
    marginLeft: 4,
  },
  tripCount: {
    fontSize: 12,
    color: '#7f8c8d',
    marginLeft: 8,
  },
  driverStatus: {
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
  vehicleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  vehicleText: {
    fontSize: 14,
    color: '#34495e',
    marginLeft: 8,
  },
  tripInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  selectingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  selectingText: {
    fontSize: 14,
    color: '#2E8B57',
    marginLeft: 8,
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
    marginBottom: 16,
  },
  searchTime: {
    fontSize: 12,
    color: '#bdc3c7',
  },
});

export default DriverSearchScreen; 