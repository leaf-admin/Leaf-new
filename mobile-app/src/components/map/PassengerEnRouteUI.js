import Logger from '../../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';

// import { useTranslation } from 'react-i18next';

const { width } = Dimensions.get('window');

export default function PassengerEnRouteUI({ booking, onDriverLocationUpdate }) {
  // Função de tradução temporária
  const t = (key) => key;
  const [driverLocation, setDriverLocation] = useState(null);
  const [estimatedTime, setEstimatedTime] = useState('--');
  const [estimatedDistance, setEstimatedDistance] = useState('--');

  useEffect(() => {
    if (onDriverLocationUpdate) {
      onDriverLocationUpdate(driverLocation);
    }
  }, [driverLocation, onDriverLocationUpdate]);

  const handleCancelRide = () => {
    Alert.alert(
      t('cancel_ride'),
      t('cancel_ride_confirmation'),
      [
        { text: t('no'), style: 'cancel' },
        { text: t('yes'), onPress: () => Logger.log('Corrida cancelada') }
      ]
    );
  };

  const handleContactDriver = () => {
    if (booking?.driver_phone) {
      // Implementar chamada ou chat
      Logger.log('Contatar motorista:', booking.driver_phone);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header com informações do motorista */}
      <View style={styles.header}>
        <View style={styles.driverInfo}>
          <Image
            source={booking?.driver_image ? { uri: booking.driver_image } : require('../../assets/images/default-avatar.png')}
            style={styles.driverAvatar}
          />
          <View style={styles.driverDetails}>
            <Text style={styles.driverName}>{booking?.driver_name || t('driver')}</Text>
            <Text style={styles.carInfo}>
              {booking?.car_model} • {booking?.car_plate}
            </Text>
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={16} color="#FFD700" />
              <Text style={styles.rating}>{booking?.driver_rating || '5.0'}</Text>
            </View>
          </View>
        </View>
        
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>{t('driver_on_way')}</Text>
          <View style={styles.etaContainer}>
            <Ionicons name="time" size={16} color="#41D274" />
            <Text style={styles.etaText}>{estimatedTime} min</Text>
          </View>
        </View>
      </View>

      {/* Informações da viagem */}
      <View style={styles.tripInfo}>
        <View style={styles.locationRow}>
          <View style={styles.locationIcon}>
            <Ionicons name="location" size={20} color="#41D274" />
          </View>
          <View style={styles.locationText}>
            <Text style={styles.locationLabel}>{t('pickup')}</Text>
            <Text style={styles.locationAddress}>{booking?.pickup_address}</Text>
          </View>
        </View>

        <View style={styles.locationRow}>
          <View style={styles.locationIcon}>
            <Ionicons name="location" size={20} color="#FF6B6B" />
          </View>
          <View style={styles.locationText}>
            <Text style={styles.locationLabel}>{t('destination')}</Text>
            <Text style={styles.locationAddress}>{booking?.drop_address}</Text>
          </View>
        </View>
      </View>

      {/* Botões de ação */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={handleContactDriver}>
          <Ionicons name="call" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('call_driver')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Chat')}>
          <Ionicons name="chatbubble" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('message')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Compartilhar')}>
          <Ionicons name="share" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('share')}</Text>
        </TouchableOpacity>
      </View>

      {/* Botão de cancelar */}
      <TouchableOpacity style={styles.cancelButton} onPress={handleCancelRide}>
        <Text style={styles.cancelButtonText}>{t('cancel_ride')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  driverInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  driverAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  driverDetails: {
    flex: 1,
  },
  driverName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  carInfo: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rating: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  statusContainer: {
    alignItems: 'flex-end',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#41D274',
    marginBottom: 4,
  },
  etaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  etaText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  tripInfo: {
    marginBottom: 20,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  locationIcon: {
    width: 24,
    alignItems: 'center',
    marginTop: 2,
  },
  locationText: {
    flex: 1,
    marginLeft: 15,
  },
  locationLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 2,
  },
  locationAddress: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  actionButton: {
    alignItems: 'center',
    padding: 15,
  },
  actionButtonText: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  cancelButton: {
    backgroundColor: '#FF6B6B',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
}); 