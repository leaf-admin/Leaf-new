import Logger from '../../utils/Logger';
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


export default function DriverOnTripUI({ booking, onFinishTrip }) {
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

  const handleFinishTrip = () => {
    Alert.alert(
      t('finish_trip'),
      t('confirm_finish_trip'),
      [
        { text: t('no'), style: 'cancel' },
        { 
          text: t('yes'), 
          onPress: () => {
            if (onFinishTrip) {
              onFinishTrip();
            }
          }
        }
      ]
    );
  };

  const handleContactPassenger = () => {
    if (booking?.customer_phone) {
      // Implementar chamada ou chat
      Logger.log('Contatar passageiro:', booking.customer_phone);
    }
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
        <TouchableOpacity style={styles.actionButton} onPress={handleContactPassenger}>
          <Ionicons name="call" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('call_passenger')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Chat')}>
          <Ionicons name="chatbubble" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('message')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Navegação')}>
          <Ionicons name="navigate" size={24} color="#41D274" />
          <Text style={styles.actionButtonText}>{t('navigate')}</Text>
        </TouchableOpacity>
      </View>

      {/* Botão principal - Finalizar Viagem */}
      <TouchableOpacity style={styles.finishTripButton} onPress={handleFinishTrip}>
        <Text style={styles.finishTripButtonText}>{t('finish_trip')}</Text>
      </TouchableOpacity>

      {/* Informações de segurança */}
      <View style={styles.safetyInfo}>
        <Text style={styles.safetyTitle}>{t('driver_safety_tips')}</Text>
        <Text style={styles.safetyText}>
          {t('driver_safety_reminder')}
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
  finishTripButton: {
    backgroundColor: '#41D274',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 20,
  },
  finishTripButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  safetyInfo: {
    backgroundColor: '#E8F5E8',
    padding: 15,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#41D274',
  },
  safetyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 5,
  },
  safetyText: {
    fontSize: 13,
    color: '#2E7D32',
    lineHeight: 18,
  },
}); 