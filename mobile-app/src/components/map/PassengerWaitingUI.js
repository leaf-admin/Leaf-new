import Logger from '../../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../common-local/theme';
import Typography from '../design-system/Typography';
import AnimatedButton from '../design-system/AnimatedButton';


export default function PassengerWaitingUI({ booking, onCancel }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [waitingTime, setWaitingTime] = useState(0);
  const [estimatedArrival, setEstimatedArrival] = useState('--');

  useEffect(() => {
    const timer = setInterval(() => {
      setWaitingTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCancelRide = () => {
    Alert.alert(
      t('cancel_ride'),
      t('cancel_ride_confirmation'),
      [
        { text: t('no'), style: 'cancel' },
        { text: t('yes'), onPress: onCancel }
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
    <View style={[styles.container, { backgroundColor: theme.card }]}>
      {/* Header com informações do motorista */}
      <View style={styles.header}>
        <View style={styles.driverInfo}>
          <Image
            source={booking?.driver_image ? { uri: booking.driver_image } : require('../../assets/images/default-avatar.png')}
            style={styles.driverAvatar}
          />
          <View style={styles.driverDetails}>
            <Typography variant="h2" color={theme.text}>{booking?.driver_name || t('driver')}</Typography>
            <Typography variant="body" color={theme.textSecondary}>
              {booking?.car_model} • {booking?.car_plate}
            </Typography>
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={16} color="#FFD700" />
              <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 4 }}>
                {booking?.driver_rating || '5.0'}
              </Typography>
            </View>
          </View>
        </View>

        <View style={styles.statusContainer}>
          <Typography variant="label" color={theme.leafGreen || '#41D274'}>{t('driver_arriving')}</Typography>
          <View style={styles.waitingTimeContainer}>
            <Ionicons name="time" size={16} color="#FF6B6B" />
            <Typography variant="caption" color="#FF6B6B" style={{ marginLeft: 4, fontWeight: '500' }}>
              {formatTime(waitingTime)}
            </Typography>
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
            <Typography variant="caption" color={theme.textSecondary}>{t('pickup')}</Typography>
            <Typography variant="body" color={theme.text} numberOfLines={2}>{booking?.pickup_address}</Typography>
          </View>
        </View>

        <View style={styles.locationRow}>
          <View style={styles.locationIcon}>
            <Ionicons name="location" size={20} color="#FF6B6B" />
          </View>
          <View style={styles.locationText}>
            <Typography variant="caption" color={theme.textSecondary}>{t('destination')}</Typography>
            <Typography variant="body" color={theme.text} numberOfLines={2}>{booking?.drop_address}</Typography>
          </View>
        </View>

        <View style={styles.tripDetails}>
          <View style={styles.detailItem}>
            <Ionicons name="time" size={16} color={theme.textSecondary} />
            <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 6 }}>{estimatedArrival}</Typography>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="map" size={16} color={theme.textSecondary} />
            <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 6 }}>{booking?.estimated_distance || '--'}</Typography>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="cash" size={16} color={theme.textSecondary} />
            <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 6 }}>R$ {booking?.estimated_fare || '--'}</Typography>
          </View>
        </View>
      </View>

      {/* Status do motorista */}
      <View style={[styles.driverStatus, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(65, 210, 116, 0.1)' : '#F0F8FF' }]}>
        <View style={styles.statusIndicator}>
          <ActivityIndicator size="small" color={theme.leafGreen || '#41D274'} />
          <Typography variant="label" color={theme.leafGreen || '#41D274'} style={{ marginLeft: 8 }}>{t('driver_en_route')}</Typography>
        </View>
        <Typography variant="caption" color={theme.textSecondary} align="center">
          {t('driver_en_route_description')}
        </Typography>
      </View>

      {/* Botões de ação */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={handleContactDriver}>
          <Ionicons name="call" size={24} color={theme.leafGreen || '#41D274'} />
          <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 5 }}>{t('call_driver')}</Typography>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Chat')}>
          <Ionicons name="chatbubble" size={24} color={theme.leafGreen || '#41D274'} />
          <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 5 }}>{t('message')}</Typography>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Compartilhar')}>
          <Ionicons name="share" size={24} color={theme.leafGreen || '#41D274'} />
          <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 5 }}>{t('share')}</Typography>
        </TouchableOpacity>
      </View>

      {/* Botão de cancelar */}
      <AnimatedButton
        title={t('cancel_ride')}
        variant="danger"
        onPress={handleCancelRide}
      />
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
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#41D274',
    marginBottom: 4,
  },
  waitingTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  waitingTime: {
    fontSize: 14,
    color: '#FF6B6B',
    marginLeft: 4,
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
  driverStatus: {
    backgroundColor: '#F0F8FF',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDescription: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    lineHeight: 18,
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