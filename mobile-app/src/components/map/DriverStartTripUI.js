import React, { useState } from 'react';
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

export default function DriverStartTripUI({ booking, onStartTrip }) {
  const { t } = useTranslation();
  const [isStarting, setIsStarting] = useState(false);

  const handleStartTrip = () => {
    Alert.alert(
      t('start_trip'),
      t('confirm_start_trip'),
      [
        { text: t('no'), style: 'cancel' },
        { 
          text: t('yes'), 
          onPress: () => {
            setIsStarting(true);
            if (onStartTrip) {
              onStartTrip();
            }
          }
        }
      ]
    );
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
          <Text style={styles.statusText}>{t('ready_to_start')}</Text>
          <View style={styles.statusIcon}>
            <Ionicons name="checkmark-circle" size={24} color="#41D274" />
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
            <Text style={styles.detailText}>{booking?.estimated_time || '--'} min</Text>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="map" size={16} color="#666" />
            <Text style={styles.detailText}>{booking?.estimated_distance || '--'}</Text>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="cash" size={16} color="#666" />
            <Text style={styles.detailText}>R$ {booking?.estimated_fare || '--'}</Text>
          </View>
        </View>
      </View>

      {/* Instruções */}
      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>{t('trip_instructions')}</Text>
        <Text style={styles.instructionsText}>
          {t('confirm_passenger_boarding')}
        </Text>
      </View>

      {/* Botão principal - Iniciar Viagem */}
      <TouchableOpacity 
        style={[styles.startTripButton, isStarting && styles.startTripButtonDisabled]} 
        onPress={handleStartTrip}
        disabled={isStarting}
      >
        {isStarting ? (
          <View style={styles.loadingContainer}>
            <Ionicons name="hourglass" size={20} color="#FFFFFF" />
            <Text style={styles.startTripButtonText}>{t('starting_trip')}</Text>
          </View>
        ) : (
          <Text style={styles.startTripButtonText}>{t('start_trip')}</Text>
        )}
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
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#41D274',
    marginBottom: 8,
  },
  statusIcon: {
    alignItems: 'center',
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
  instructions: {
    backgroundColor: '#F8F9FA',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  instructionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  instructionsText: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  startTripButton: {
    backgroundColor: '#41D274',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
  },
  startTripButtonDisabled: {
    backgroundColor: '#CCC',
  },
  startTripButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
}); 