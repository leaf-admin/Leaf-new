import React, { memo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

const { width } = Dimensions.get('window');

const PriceCard = memo(function PriceCard({ 
  estimatedFare, 
  estimatedTime, 
  estimatedDistance, 
  carType, 
  onSelectCar,
  isSelected = false,
  onPress 
}) {
  const { t } = useTranslation();

  const handlePress = useCallback(() => {
    if (onPress) {
      onPress();
    }
    if (onSelectCar) {
      onSelectCar(carType);
    }
  }, [onPress, onSelectCar, carType]);

  return (
    <TouchableOpacity 
      style={[styles.container, isSelected && styles.selectedContainer]} 
      onPress={handlePress}
      activeOpacity={0.8}
    >
      {/* Header do card */}
      <View style={styles.header}>
        <View style={styles.carInfo}>
          <Ionicons 
            name={carType?.icon || 'car'} 
            size={24} 
            color={isSelected ? '#FFFFFF' : '#41D274'} 
          />
          <Text style={[styles.carName, isSelected && styles.selectedText]}>
            {carType?.name || t('car')}
          </Text>
        </View>
        
        {isSelected && (
          <View style={styles.selectedBadge}>
            <Ionicons name="checkmark" size={16} color="#41D274" />
          </View>
        )}
      </View>

      {/* Informações da viagem */}
      <View style={styles.tripInfo}>
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Ionicons 
              name="time" 
              size={16} 
              color={isSelected ? '#FFFFFF' : '#666'} 
            />
            <Text style={[styles.infoText, isSelected && styles.selectedText]}>
              {estimatedTime || '--'} min
            </Text>
          </View>
          
          <View style={styles.infoItem}>
            <Ionicons 
              name="map" 
              size={16} 
              color={isSelected ? '#FFFFFF' : '#666'} 
            />
            <Text style={[styles.infoText, isSelected && styles.selectedText]}>
              {estimatedDistance || '--'}
            </Text>
          </View>
        </View>
      </View>

      {/* Preço */}
      <View style={styles.priceContainer}>
        <Text style={[styles.priceLabel, isSelected && styles.selectedText]}>
          {t('estimated_price')}
        </Text>
        <Text style={[styles.priceValue, isSelected && styles.selectedText]}>
          R$ {estimatedFare || '--'}
        </Text>
      </View>

      {/* Características do carro */}
      {carType?.features && (
        <View style={styles.featuresContainer}>
          {carType.features.map((feature, index) => (
            <View key={index} style={styles.featureItem}>
              <Ionicons 
                name="checkmark-circle" 
                size={14} 
                color={isSelected ? '#FFFFFF' : '#41D274'} 
              />
              <Text style={[styles.featureText, isSelected && styles.selectedText]}>
                {feature}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Botão de seleção */}
      <TouchableOpacity 
        style={[styles.selectButton, isSelected && styles.selectedButton]} 
        onPress={handlePress}
      >
        <Text style={[styles.selectButtonText, isSelected && styles.selectedButtonText]}>
          {isSelected ? t('selected') : t('select')}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 2,
    borderColor: '#F0F0F0',
  },
  selectedContainer: {
    backgroundColor: '#41D274',
    borderColor: '#41D274',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  carInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  carName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginLeft: 10,
  },
  selectedText: {
    color: '#FFFFFF',
  },
  selectedBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tripInfo: {
    marginBottom: 15,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
  },
  priceContainer: {
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 15,
    backgroundColor: 'rgba(65, 210, 116, 0.1)',
    borderRadius: 10,
  },
  priceLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 5,
  },
  priceValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#41D274',
  },
  featuresContainer: {
    marginBottom: 20,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  featureText: {
    fontSize: 13,
    color: '#666',
    marginLeft: 8,
  },
  selectButton: {
    backgroundColor: '#F0F0F0',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    alignItems: 'center',
  },
  selectedButton: {
    backgroundColor: '#FFFFFF',
  },
  selectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  selectedButtonText: {
    color: '#41D274',
  },
});

export default PriceCard; 