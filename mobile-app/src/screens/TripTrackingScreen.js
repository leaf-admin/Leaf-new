import Logger from '../utils/Logger';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
  Image
} from 'react-native';
import { Icon } from 'react-native-elements';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline, UrlTile } from 'react-native-maps';
import BottomSheetWrapper from '../components/BottomSheetWrapper';
import { colors } from '../common-local/theme';
import WebSocketManager from '../services/WebSocketManager';
import useWebSocketListeners from '../hooks/useWebSocketListeners';
import { useSelector } from 'react-redux';


const { width, height } = Dimensions.get('window');

const TripTrackingScreen = ({ navigation, route }) => {
  const mapRef = useRef(null);
  const [driverLocation, setDriverLocation] = useState({
    latitude: -23.5505,
    longitude: -46.6333,
  });
  const [tripStatus, setTripStatus] = useState('a_caminho');
  const [eta, setEta] = useState('5 min');
  const [driverInfo, setDriverInfo] = useState({
    name: 'João Silva',
    photo: null,
    plate: 'ABC-1234',
    vehicle: 'Toyota Corolla',
    rating: 4.8,
    phone: '+55 11 99999-9999'
  });
  const [routeCoordinates, setRouteCoordinates] = useState([
    { latitude: -23.5505, longitude: -46.6333 },
    { latitude: -23.5605, longitude: -46.6433 },
    { latitude: -23.5705, longitude: -46.6533 },
  ]);
  const [destination, setDestination] = useState({
    latitude: -23.5705,
    longitude: -46.6533,
    address: 'Shopping Center, São Paulo'
  });

  // ===== INTEGRAÇÃO WEBSOCKET =====
  const auth = useSelector(state => state.auth);
  const wsManager = WebSocketManager.getInstance();
  const currentUser = auth.profile;
  const userType = currentUser?.userType || currentUser?.usertype;

  // Configurar listeners WebSocket para tracking de viagem
  useWebSocketListeners('TripTracking', {
    onDriverLocationUpdated: (data) => {
      Logger.log('📍 TripTracking - Localização do motorista atualizada:', data);
      // Atualizar posição do motorista em tempo real
      setDriverLocation({
        latitude: data.lat,
        longitude: data.lng,
        heading: data.heading,
        speed: data.speed
      });
      
      // Centralizar mapa na nova posição
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: data.lat,
          longitude: data.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1000);
      }
    },
    onTripStarted: (data) => {
      Logger.log('🚀 TripTracking - Viagem iniciada:', data);
      setTripStatus('em_andamento');
      // Atualizar UI para mostrar viagem em andamento
    },
    onTripCompleted: (data) => {
      Logger.log('🏁 TripTracking - Viagem finalizada:', data);
      setTripStatus('finalizada');
      // Navegar para tela de avaliação
    },
    onRideCancelled: (data) => {
      Logger.log('❌ TripTracking - Viagem cancelada:', data);
      setTripStatus('cancelada');
      // Mostrar mensagem de cancelamento
    },
    onConnect: () => {
      Logger.log('📍 TripTracking - WebSocket conectado');
    },
    onDisconnect: (reason) => {
      Logger.log('📍 TripTracking - WebSocket desconectado:', reason);
    },
    onConnectError: (error) => {
      Logger.error('📍 TripTracking - Erro de conexão WebSocket:', error);
    }
  });

  // Simular atualização da posição do motorista
  useEffect(() => {
    const interval = setInterval(() => {
      updateDriverLocation();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const updateDriverLocation = () => {
    // Simular movimento do motorista
    setDriverLocation(prev => ({
      latitude: prev.latitude + (Math.random() - 0.5) * 0.001,
      longitude: prev.longitude + (Math.random() - 0.5) * 0.001,
    }));
  };

  const getStatusInfo = () => {
    switch (tripStatus) {
      case 'a_caminho':
        return {
          title: '🚗 A caminho',
          subtitle: 'Motorista indo buscar você',
          color: '#2E8B57',
          icon: 'directions-car'
        };
      case 'chegando':
        return {
          title: '🎯 Chegando',
          subtitle: 'Motorista próximo ao ponto',
          color: '#FF6B35',
          icon: 'location-on'
        };
      case 'em_viagem':
        return {
          title: '🚀 Em viagem',
          subtitle: 'Indo para o destino',
          color: '#4A90E2',
          icon: 'navigation'
        };
      case 'chegou':
        return {
          title: '✅ Chegou',
          subtitle: 'Viagem concluída',
          color: '#27AE60',
          icon: 'check-circle'
        };
      default:
        return {
          title: '⏳ Aguardando',
          subtitle: 'Preparando viagem',
          color: '#95A5A6',
          icon: 'schedule'
        };
    }
  };

  const handleCallDriver = () => {
    Alert.alert(
      'Ligar para motorista',
      `Deseja ligar para ${driverInfo.name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Ligar', onPress: () => Logger.log('Ligando...') }
      ]
    );
  };

  const handleCancelTrip = () => {
    Alert.alert(
      'Cancelar viagem',
      'Tem certeza que deseja cancelar?',
      [
        { text: 'Não', style: 'cancel' },
        { text: 'Sim', onPress: () => navigation.goBack() }
      ]
    );
  };

  const statusInfo = getStatusInfo();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2E8B57" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" type="material" color="#fff" size={24} />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Acompanhar Viagem</Text>
          <Text style={styles.headerSubtitle}>{eta}</Text>
        </View>
        
        <TouchableOpacity
          style={styles.helpButton}
          onPress={() => navigation.navigate('Support')}
        >
          <Icon name="help" type="material" color="#fff" size={24} />
        </TouchableOpacity>
      </View>

      {/* Mapa */}
      <MapView
        ref={mapRef}
                    <UrlTile
                        urlTemplate="https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        maximumZ={19}
                        flipY={false}
                    />
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{
          latitude: driverLocation.latitude,
          longitude: driverLocation.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        showsScale={true}
        showsTraffic={false}
        showsBuildings={true}
        rotateEnabled={true}
        scrollEnabled={true}
        pitchEnabled={true}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
      >
        {/* Rota */}
        <Polyline
          coordinates={routeCoordinates}
          strokeColor="#2E8B57"
          strokeWidth={4}
          lineDashPattern={[1]}
        />
        
        {/* Motorista */}
        <Marker
          coordinate={driverLocation}
          title={driverInfo.name}
          description={driverInfo.vehicle}
        >
          <View style={styles.driverMarker}>
            <Icon name="directions-car" type="material" color="#2E8B57" size={24} />
          </View>
        </Marker>
        
        {/* Destino */}
        <Marker
          coordinate={destination}
          title="Destino"
          description={destination.address}
        >
          <View style={styles.destinationMarker}>
            <Icon name="location-on" type="material" color="#FF6B35" size={24} />
          </View>
        </Marker>
      </MapView>

      {/* Status Overlay */}
      <View style={styles.statusOverlay}>
        <View style={[styles.statusCard, { borderLeftColor: statusInfo.color }]}>
          <Icon name={statusInfo.icon} type="material" color={statusInfo.color} size={24} />
          <View style={styles.statusText}>
            <Text style={styles.statusTitle}>{statusInfo.title}</Text>
            <Text style={styles.statusSubtitle}>{statusInfo.subtitle}</Text>
          </View>
        </View>
      </View>

      {/* Bottom Sheet - Informações do Motorista */}
      <BottomSheetWrapper
        snapPoints={['30%', '50%']}
        index={0}
        onClose={() => {}}
      >
        <View style={styles.driverInfoContainer}>
          <View style={styles.driverHeader}>
            <View style={styles.driverAvatar}>
              {driverInfo.photo ? (
                <Image source={{ uri: driverInfo.photo }} style={styles.avatar} />
              ) : (
                <Icon name="person" type="material" color="#666" size={32} />
              )}
            </View>
            
            <View style={styles.driverDetails}>
              <Text style={styles.driverName}>{driverInfo.name}</Text>
              <Text style={styles.driverVehicle}>{driverInfo.vehicle}</Text>
              <Text style={styles.driverPlate}>{driverInfo.plate}</Text>
              
              <View style={styles.ratingContainer}>
                <Icon name="star" type="material" color="#FFD700" size={16} />
                <Text style={styles.ratingText}>{driverInfo.rating}</Text>
              </View>
            </View>
          </View>

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.callButton]}
              onPress={handleCallDriver}
            >
              <Icon name="phone" type="material" color="#fff" size={20} />
              <Text style={styles.actionButtonText}>Ligar</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionButton, styles.chatButton]}
              onPress={() => navigation.navigate('Chat', { driverId: 'driver_123' })}
            >
              <Icon name="chat" type="material" color="#fff" size={20} />
              <Text style={styles.actionButtonText}>Chat</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionButton, styles.cancelButton]}
              onPress={handleCancelTrip}
            >
              <Icon name="close" type="material" color="#fff" size={20} />
              <Text style={styles.actionButtonText}>Cancelar</Text>
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
    backgroundColor: '#2E8B57',
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
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.8,
  },
  helpButton: {
    padding: 8,
  },
  map: {
    flex: 1,
  },
  driverMarker: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 8,
    borderWidth: 2,
    borderColor: '#2E8B57',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  destinationMarker: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 8,
    borderWidth: 2,
    borderColor: '#FF6B35',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  statusOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 120 : 90,
    left: 20,
    right: 20,
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  statusText: {
    marginLeft: 12,
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  statusSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    marginTop: 2,
  },
  driverInfoContainer: {
    padding: 20,
  },
  driverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  driverAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f1f2f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  driverDetails: {
    flex: 1,
  },
  driverName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  driverVehicle: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 2,
  },
  driverPlate: {
    fontSize: 12,
    color: '#95a5a6',
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 14,
    color: '#7f8c8d',
    marginLeft: 4,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  callButton: {
    backgroundColor: '#27AE60',
  },
  chatButton: {
    backgroundColor: '#3498DB',
  },
  cancelButton: {
    backgroundColor: '#E74C3C',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
});

export default TripTrackingScreen; 