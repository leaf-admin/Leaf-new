import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import BottomSheetWrapper from './BottomSheetWrapper';
import DriverSearchCard from './DriverSearchCard';

const DriverSearchBottomSheet = ({ 
  isVisible, 
  onClose, 
  onDriverSelected,
  userLocation,
  destination 
}) => {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchRadius, setSearchRadius] = useState(1000); // 1km

  useEffect(() => {
    if (isVisible) {
      startDriverSearch();
    }
  }, [isVisible]);

  const startDriverSearch = async () => {
    setLoading(true);
    try {
      // Simular busca de motoristas próximos
      const nearbyDrivers = await searchNearbyDrivers(userLocation, searchRadius);
      setDrivers(nearbyDrivers);
    } catch (error) {
      console.error('Erro na busca de motoristas:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchNearbyDrivers = async (location, radius) => {
    // Implementar busca real via API
    return [
      {
        id: '1',
        name: 'João Silva',
        rating: 4.8,
        vehicle: 'Toyota Corolla',
        plate: 'ABC-1234',
        distance: 0.5,
        eta: '2 min',
        photo: 'https://example.com/driver1.jpg'
      },
      {
        id: '2',
        name: 'Maria Santos',
        rating: 4.9,
        vehicle: 'Honda Civic',
        plate: 'XYZ-5678',
        distance: 0.8,
        eta: '3 min',
        photo: 'https://example.com/driver2.jpg'
      },
      {
        id: '3',
        name: 'Pedro Costa',
        rating: 4.7,
        vehicle: 'Hyundai HB20',
        plate: 'DEF-9012',
        distance: 1.2,
        eta: '4 min',
        photo: null
      }
    ];
  };

  const handleDriverSelect = (driver) => {
    onDriverSelected(driver);
    onClose();
  };

  const renderDriverCard = ({ item }) => (
    <DriverSearchCard
      driver={item}
      onSelect={() => handleDriverSelect(item)}
    />
  );

  const renderContent = () => (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Motoristas Próximos</Text>
        <Text style={styles.subtitle}>
          Encontramos {drivers.length} motoristas na sua região
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2E8B57" />
          <Text style={styles.loadingText}>Buscando motoristas...</Text>
        </View>
      ) : (
        <FlatList
          data={drivers}
          renderItem={renderDriverCard}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContainer}
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Expandindo busca em {searchRadius}m...
        </Text>
      </View>
    </View>
  );

  return (
    <BottomSheetWrapper
      snapPoints={['50%', '70%', '90%']}
      index={isVisible ? 1 : -1}
      onClose={onClose}
    >
      {renderContent()}
    </BottomSheetWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  listContainer: {
    paddingHorizontal: 20,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
});

export default DriverSearchBottomSheet; 