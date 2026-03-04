import Logger from '../../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert
} from 'react-native';
import { useSelector } from 'react-redux';
import { useTheme } from '../../common-local/theme';
import Typography from '../design-system/Typography';
import AnimatedButton from '../design-system/AnimatedButton';
import { Ionicons } from '@expo/vector-icons';

// import { useTranslation } from 'react-i18next';

const { width } = Dimensions.get('window');

export default function PassengerEnRouteUI({ booking, onDriverLocationUpdate }) {
  const theme = useTheme();
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
          <Typography variant="label" color={theme.leafGreen || '#41D274'}>{t('driver_on_way')}</Typography>
          <View style={styles.etaContainer}>
            <Ionicons name="time" size={16} color={theme.leafGreen || '#41D274'} />
            <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 4 }}>
              {estimatedTime} min
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
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 15,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
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
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 15,
    backgroundColor: '#F5F5F5',
  },
  driverDetails: {
    flex: 1,
  },
  // driverName: { // Removed as per new styles
  //   fontSize: 18,
  //   fontWeight: '600',
  //   color: '#333',
  //   marginBottom: 4,
  // },
  // carInfo: { // Removed as per new styles
  //   fontSize: 14,
  //   color: '#666',
  //   marginBottom: 4,
  // },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  // rating: { // Removed as per new styles
  //   fontSize: 14,
  //   color: '#666',
  //   marginLeft: 4,
  // },
  statusContainer: {
    alignItems: 'flex-end',
  },
  // statusText: { // Removed as per new styles
  //   fontSize: 16,
  //   fontWeight: '600',
  //   color: '#41D274',
  //   marginBottom: 4,
  // },
  etaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // etaText: { // Removed as per new styles
  //   fontSize: 14,
  //   color: '#666',
  //   marginLeft: 4,
  // },
  tripInfo: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: 16,
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
  // locationLabel: { // Removed as per new styles
  //   fontSize: 12,
  //   color: '#999',
  //   marginBottom: 2,
  // },
  // locationAddress: { // Removed as per new styles
  //   fontSize: 14,
  //   color: '#333',
  //   lineHeight: 20,
  // },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: 16,
    paddingVertical: 8,
  },
  actionButton: {
    alignItems: 'center',
    padding: 12,
    flex: 1,
  },
  // actionButtonText: { // Removed as per new styles
  //   fontSize: 12,
  //   color: '#666',
  //   marginTop: 5,
  // },
  // cancelButton: { // Removed as per new styles
  //   backgroundColor: '#FF6B6B',
  //   paddingVertical: 15,
  //   paddingHorizontal: 30,
  //   borderRadius: 25,
  //   alignItems: 'center',
  // },
  // cancelButtonText: { // Removed as per new styles
  //   color: '#FFFFFF',
  //   fontSize: 16,
  //   fontWeight: '600',
  // },
});