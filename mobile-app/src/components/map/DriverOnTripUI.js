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
import { useTheme } from '../../common-local/theme';
import Typography from '../design-system/Typography';
import AnimatedButton from '../design-system/AnimatedButton';


export default function DriverOnTripUI({ booking, onFinishTrip }) {
  const { t } = useTranslation();
  const theme = useTheme();
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
    <View style={[styles.container, { backgroundColor: theme.card }]}>
      {/* Header com informações do passageiro */}
      <View style={styles.header}>
        <View style={styles.passengerInfo}>
          <Image
            source={booking?.customer_image ? { uri: booking.customer_image } : require('../../assets/images/default-avatar.png')}
            style={styles.passengerAvatar}
          />
          <View style={styles.passengerDetails}>
            <Typography variant="h2" color={theme.text}>{booking?.customer_name || t('passenger')}</Typography>
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={16} color="#FFD700" />
              <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 4 }}>{booking?.customer_rating || '5.0'}</Typography>
            </View>
          </View>
        </View>

        <View style={styles.statusContainer}>
          <Typography variant="body" weight="bold" color={theme.leafGreen || '#41D274'}>{t('on_trip')}</Typography>
          <Typography variant="caption" color={theme.textSecondary}>{formatTime(tripTime)}</Typography>
        </View>
      </View>

      {/* Informações da viagem */}
      <View style={styles.tripInfo}>
        <View style={styles.locationRow}>
          <View style={styles.locationIcon}>
            <Ionicons name="location" size={20} color={theme.leafGreen || '#41D274'} />
          </View>
          <View style={styles.locationText}>
            <Typography variant="caption" color={theme.textSecondary}>{t('pickup')}</Typography>
            <Typography variant="body" color={theme.text}>{booking?.pickup_address}</Typography>
          </View>
        </View>

        <View style={styles.locationRow}>
          <View style={styles.locationIcon}>
            <Ionicons name="location" size={20} color="#FF6B6B" />
          </View>
          <View style={styles.locationText}>
            <Typography variant="caption" color={theme.textSecondary}>{t('destination')}</Typography>
            <Typography variant="body" color={theme.text}>{booking?.drop_address}</Typography>
          </View>
        </View>

        <View style={[styles.tripDetails, { borderTopColor: theme.border }]}>
          <View style={styles.detailItem}>
            <Ionicons name="time" size={16} color={theme.textSecondary} />
            <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 6 }}>{estimatedArrival}</Typography>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="map" size={16} color={theme.textSecondary} />
            <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 6 }}>{booking?.remaining_distance || '--'}</Typography>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="cash" size={16} color={theme.textSecondary} />
            <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 6 }}>R$ {booking?.current_fare || '--'}</Typography>
          </View>
        </View>
      </View>

      {/* Botões de ação */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={handleContactPassenger}>
          <Ionicons name="call" size={24} color={theme.leafGreen || '#41D274'} />
          <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 5 }}>{t('call_passenger')}</Typography>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Chat')}>
          <Ionicons name="chatbubble" size={24} color={theme.leafGreen || '#41D274'} />
          <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 5 }}>{t('message')}</Typography>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Navegação')}>
          <Ionicons name="navigate" size={24} color={theme.leafGreen || '#41D274'} />
          <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 5 }}>{t('navigate')}</Typography>
        </TouchableOpacity>
      </View>

      {/* Botão principal - Finalizar Viagem */}
      <AnimatedButton
        title={t('finish_trip')}
        onPress={handleFinishTrip}
        style={{ marginBottom: 20 }}
      />

      {/* Informações de segurança */}
      <View style={[styles.safetyInfo, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(65, 210, 116, 0.05)' : '#E8F5E8', borderLeftColor: theme.leafGreen || '#41D274' }]}>
        <Typography variant="label" weight="bold" color={theme.leafGreen || '#2E7D32'} style={{ marginBottom: 5 }}>{t('driver_safety_tips')}</Typography>
        <Typography variant="caption" color={theme.leafGreen || '#2E7D32'} style={{ lineHeight: 18 }}>
          {t('driver_safety_reminder')}
        </Typography>
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