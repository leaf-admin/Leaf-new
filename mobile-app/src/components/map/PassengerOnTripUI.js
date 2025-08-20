import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

export default function PassengerOnTripUI({ booking }) {
  const { t } = useTranslation();
  const [tripTime, setTripTime] = useState(0);
  const [estimatedArrival, setEstimatedArrival] = useState('--');

  useEffect(() => {
    const timer = setInterval(() => {
      setTripTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEmergency = () => {
    Alert.alert(
      t('emergency'),
      t('emergency_help'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('call_emergency'), onPress: () => console.log('Chamada de emergência') }
      ]
    );
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
          </View>
        </View>
        
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>{t('on_trip')}</Text>
          <Text style={styles.tripTime}>{formatTime(tripTime)}</Text>
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

        <View style={styles.tripDetails}>
          <View style={styles.detailItem}>
            <Ionicons name="time" size={16} color="#666" />
            <Text style={styles.detailText}>{estimatedArrival}</Text>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="map" size={16} color="#666" />
            <Text style={styles.detailText}>{booking?.remaining_distance || '--'}</Text>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="cash" size={16} color="#666" />
            <Text style={styles.detailText}>R$ {booking?.current_fare || '--'}</Text>
          </View>
        </View>
      </View>

      {/* Botões de ação */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={() => console.log('Chat')}>
          <Ionicons name="chatbubble" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('message')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => console.log('Compartilhar')}>
          <Ionicons name="share" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('share')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleEmergency}>
          <Ionicons name="warning" size={24} color="#FF6B6B" />
          <Text style={styles.actionButtonText}>{t('emergency')}</Text>
        </TouchableOpacity>
      </View>

      {/* Informações de segurança */}
      <View style={styles.safetyInfo}>
        <Text style={styles.safetyTitle}>{t('safety_tips')}</Text>
        <Text style={styles.safetyText}>
          {t('trip_safety_reminder')}
        </Text>
      </View>
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
  },
  statusContainer: {
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#41D274',
    marginBottom: 4,
  },
  tripTime: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
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
  tripDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
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
  safetyInfo: {
    backgroundColor: '#FFF3CD',
    padding: 15,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#FFC107',
  },
  safetyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#856404',
    marginBottom: 5,
  },
  safetyText: {
    fontSize: 13,
    color: '#856404',
    lineHeight: 18,
  },
}); 