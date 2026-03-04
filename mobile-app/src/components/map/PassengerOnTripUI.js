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
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../common-local/theme';
import Typography from '../design-system/Typography';
import AnimatedButton from '../design-system/AnimatedButton';


export default function PassengerOnTripUI({ booking }) {
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

  const navigation = useNavigation();

  const handleEmergency = () => {
    Alert.alert(
      t('emergency'),
      t('emergency_help'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('call_emergency'), onPress: () => Logger.log('Chamada de emergência') }
      ]
    );
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
          </View>
        </View>

        <View style={styles.statusContainer}>
          <Typography variant="label" color={theme.leafGreen || '#41D274'}>{t('on_trip')}</Typography>
          <Typography variant="h2" color={theme.text}>{formatTime(tripTime)}</Typography>
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
        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Chat')}>
          <Ionicons name="chatbubble" size={24} color={theme.leafGreen || '#41D274'} />
          <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 5 }}>{t('message')}</Typography>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => Logger.log('Compartilhar')}>
          <Ionicons name="share" size={24} color={theme.leafGreen || '#41D274'} />
          <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 5 }}>{t('share')}</Typography>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Search')}>
          <Ionicons name="map-outline" size={24} color={theme.leafGreen || '#41D274'} />
          <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 5 }}>{t('change_destination', 'Alterar Destino')}</Typography>
        </TouchableOpacity>
      </View>

      {/* Informações de segurança */}
      <View style={[styles.safetyInfo, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255, 193, 7, 0.1)' : '#FFF3CD', borderLeftColor: '#FFC107' }]}>
        <Typography variant="label" color={theme.card === '#1A1A1A' ? '#FFC107' : '#856404'}>{t('safety_tips')}</Typography>
        <Typography variant="caption" color={theme.card === '#1A1A1A' ? '#FFC107' : '#856404'} style={{ marginTop: 4 }}>
          {t('trip_safety_reminder')}
        </Typography>
      </View>

      <View style={{ marginTop: 20 }}>
        <AnimatedButton
          title={t('emergency')}
          variant="danger"
          onPress={handleEmergency}
        />
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