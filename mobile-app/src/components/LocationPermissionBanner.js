import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

/**
 * Banner não bloqueante para informar sobre permissão de localização negada
 * Segue as recomendações da Apple e Google para apps de mobilidade
 * Aparece no mapa quando localização está desativada
 */
const LocationPermissionBanner = ({
  visible,
  onDismiss,
  onEnable,
  userType = 'customer', // 'driver' ou 'customer'
  locationType = 'foreground', // 'foreground' ou 'background'
}) => {
  if (!visible) return null;

  const getBannerInfo = () => {
    // Passageiro - Localização foreground negada
    if (userType === 'customer' && locationType === 'foreground') {
      return {
        text: '📍 Habilite a localização para solicitar corridas e encontrar motoristas próximos.',
        buttonText: 'Ativar localização',
      };
    }

    // Motorista - Localização foreground negada
    if (userType === 'driver' && locationType === 'foreground') {
      return {
        text: '📍 Ative a localização para navegar até passageiros e iniciar viagens.',
        buttonText: 'Ativar localização',
      };
    }

    // Motorista - Localização background negada (quando está online)
    if (userType === 'driver' && locationType === 'background') {
      return {
        text: '🚗 Para receber corridas com o app em segundo plano, ative a localização em segundo plano.',
        buttonText: 'Abrir configurações',
      };
    }

    // Fallback padrão
    return {
      text: '📍 Ative a localização para usar os serviços da Leaf.',
      buttonText: 'Ativar localização',
    };
  };

  const bannerInfo = getBannerInfo();

  const handleEnable = async () => {
    if (locationType === 'background') {
      // Para background, sempre abrir configurações (já foi negada)
      if (Platform.OS === 'ios') {
        Linking.openURL('app-settings:');
      } else {
        Linking.openSettings();
      }
    } else {
      // Para foreground, verificar se já pediu permissão
      const { status } = await Location.getForegroundPermissionsAsync();
      
      if (status === 'denied' || status === 'blocked') {
        // Já foi negada, abrir configurações
        if (Platform.OS === 'ios') {
          Linking.openURL('app-settings:');
        } else {
          Linking.openSettings();
        }
      } else {
        // Ainda não pediu ou pode pedir novamente, tentar solicitar
        if (onEnable) {
          onEnable();
        }
      }
    }
    
    if (onEnable && locationType === 'foreground') {
      // onEnable já vai tentar solicitar permissão
      onEnable();
    }
  };

  return (
    <View style={styles.banner} pointerEvents="box-none">
      <View style={styles.bannerCard}>
        <Text style={styles.message}>{bannerInfo.text}</Text>
        <TouchableOpacity
          style={styles.enableButton}
          onPress={handleEnable}
          activeOpacity={0.8}
        >
          <Text style={styles.enableButtonText}>{bannerInfo.buttonText}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    zIndex: 1000,
    pointerEvents: 'box-none',
  },
  bannerCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 48, 2, 0.1)',
  },
  message: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    lineHeight: 20,
    marginBottom: 12,
    textAlign: 'center',
  },
  enableButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#003002',
    alignItems: 'center',
    justifyContent: 'center',
  },
  enableButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default LocationPermissionBanner;


