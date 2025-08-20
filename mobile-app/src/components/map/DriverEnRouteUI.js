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
import { useTranslation } from 'react-i18next';

const { width } = Dimensions.get('window');

export default function DriverEnRouteUI({ booking, onArrived }) {
  const { t } = useTranslation();
  const [estimatedTime, setEstimatedTime] = useState('--');
  const [estimatedDistance, setEstimatedDistance] = useState('--');

  useEffect(() => {
    // Simular cálculo de tempo e distância
    if (booking?.pickup_location && booking?.driver_location) {
      // Aqui você implementaria a lógica real de cálculo
      setEstimatedTime('5');
      setEstimatedDistance('2.3 km');
    }
  }, [booking]);

  const handleArrived = () => {
    Alert.alert(
      t('arrived_at_pickup'),
      t('confirm_arrival'),
      [
        { text: t('no'), style: 'cancel' },
        { text: t('yes'), onPress: onArrived }
      ]
    );
  };

  const handleContactPassenger = () => {
    if (booking?.customer_phone) {
      // Implementar chamada ou chat
      console.log('Contatar passageiro:', booking.customer_phone);
    }
  };

  const handleNavigateToPickup = () => {
    // Implementar navegação para o local de embarque
    console.log('Navegar para embarque');
  };

  return (
    <View style={styles.container}>
      {/* Header com informações do passageiro */}
      <View style={styles.header}>
        <View style={styles.passengerInfo}>
          <Image
            source={booking?.customer_image ? { uri: booking.customer_image } : require('../../assets/images/default-avatar.png')}
            style={styles.passengerAvatar}
          />
          <View style={styles.passengerDetails}>
            <Text style={styles.passengerName}>{booking?.customer_name || t('passenger')}</Text>
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={16} color="#FFD700" />
              <Text style={styles.rating}>{booking?.customer_rating || '5.0'}</Text>
            </View>
          </View>
        </View>
        
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>{t('heading_to_pickup')}</Text>
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

        <View style={styles.tripDetails}>
          <View style={styles.detailItem}>
            <Ionicons name="time" size={16} color="#666" />
            <Text style={styles.detailText}>{estimatedTime} min</Text>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="map" size={16} color="#666" />
            <Text style={styles.detailText}>{estimatedDistance}</Text>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="cash" size={16} color="#666" />
            <Text style={styles.detailText}>R$ {booking?.estimated_fare || '--'}</Text>
          </View>
        </View>
      </View>

      {/* Botões de ação */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={handleNavigateToPickup}>
          <Ionicons name="navigate" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('navigate')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleContactPassenger}>
          <Ionicons name="call" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('call_passenger')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => console.log('Chat')}>
          <Ionicons name="chatbubble" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('message')}</Text>
        </TouchableOpacity>
      </View>

      {/* Botão principal - Cheguei */}
      <TouchableOpacity style={styles.arrivedButton} onPress={handleArrived}>
        <Text style={styles.arrivedButtonText}>{t('arrived_at_pickup')}</Text>
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
  passengerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  passengerAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  passengerDetails: {
    flex: 1,
  },
  passengerName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
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
  arrivedButton: {
    backgroundColor: '#41D274',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
  },
  arrivedButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
}); 