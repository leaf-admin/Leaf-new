import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Icon } from 'react-native-elements';

const DriverSearchCard = ({ driver, onSelect }) => {
  const renderRating = () => {
    const stars = [];
    const rating = driver.rating || 0;
    
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Icon
          key={i}
          name={i <= rating ? 'star' : 'star-border'}
          type="material"
          size={16}
          color={i <= rating ? '#FFD700' : '#D1D5DB'}
        />
      );
    }
    
    return <View style={styles.ratingContainer}>{stars}</View>;
  };

  return (
    <TouchableOpacity style={styles.card} onPress={() => onSelect(driver)}>
      <View style={styles.driverInfo}>
        <View style={styles.avatarContainer}>
          {driver.photo ? (
            <Image source={{ uri: driver.photo }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Icon name="person" type="material" size={24} color="#666" />
            </View>
          )}
        </View>
        
        <View style={styles.driverDetails}>
          <Text style={styles.driverName}>{driver.name}</Text>
          <Text style={styles.vehicleInfo}>{driver.vehicle}</Text>
          <Text style={styles.plateInfo}>{driver.plate}</Text>
          {renderRating()}
        </View>
      </View>
      
      <View style={styles.tripInfo}>
        <View style={styles.infoRow}>
          <Icon name="location-on" type="material" size={16} color="#2E8B57" />
          <Text style={styles.infoText}>{driver.distance} km</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Icon name="access-time" type="material" size={16} color="#2E8B57" />
          <Text style={styles.infoText}>{driver.eta}</Text>
        </View>
      </View>
      
      <View style={styles.selectButton}>
        <Icon name="check-circle" type="material" size={24} color="#2E8B57" />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  driverInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  driverDetails: {
    flex: 1,
  },
  driverName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  vehicleInfo: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 2,
  },
  plateInfo: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tripInfo: {
    marginRight: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 4,
  },
  selectButton: {
    padding: 8,
  },
});

export default DriverSearchCard; 