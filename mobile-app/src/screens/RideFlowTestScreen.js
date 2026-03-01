import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSelector, useDispatch } from 'react-redux';
import { setBooking, clearBooking } from '../common-local/actions/bookingactions';


const { width, height } = Dimensions.get('window');

// Lista de todas as telas do fluxo de corrida
const RIDE_FLOW_SCREENS = {
  // MOTORISTA
  driver: [
    {
      id: 'driver-map',
      name: 'MapScreen - Motorista',
      description: 'Tela principal com mapa e botão "Ficar Online"',
      screen: 'Map',
      setup: (dispatch, auth) => {
        // Estado inicial: motorista offline
        dispatch(clearBooking());
      }
    },
    {
      id: 'driver-online',
      name: 'DriverUI - Online',
      description: 'Motorista online aguardando corrida',
      screen: 'Map',
      setup: (dispatch, auth) => {
        // Simular motorista online
        dispatch(clearBooking());
        // O DriverUI será renderizado automaticamente quando driverActiveStatus = true
      }
    },
    {
      id: 'driver-enroute',
      name: 'DriverEnRouteUI',
      description: 'Motorista aceitou corrida, a caminho do passageiro',
      screen: 'Map',
      setup: (dispatch, auth) => {
        // Simular corrida aceita
        const mockBooking = {
          id: 'test-booking-1',
          status: 'ACCEPTED',
          pickup_address: 'Rua Teste, 123',
          drop_address: 'Avenida Paulista, 1000',
          pickup_location: {
            latitude: -23.5505,
            longitude: -46.6333
          },
          drop_location: {
            latitude: -23.5614,
            longitude: -46.6560
          },
          customer_name: 'João Silva',
          customer_phone: '+5511999999999',
          customer_rating: 4.8,
          fare: 25.50,
          distance: 5.2,
          duration: 15
        };
        dispatch(setBooking(mockBooking));
      }
    },
    {
      id: 'driver-start-trip',
      name: 'DriverStartTripUI',
      description: 'Motorista chegou e iniciou viagem',
      screen: 'Map',
      setup: (dispatch, auth) => {
        const mockBooking = {
          id: 'test-booking-1',
          status: 'REACHED',
          pickup_address: 'Rua Teste, 123',
          drop_address: 'Avenida Paulista, 1000',
          pickup_location: {
            latitude: -23.5505,
            longitude: -46.6333
          },
          drop_location: {
            latitude: -23.5614,
            longitude: -46.6560
          },
          customer_name: 'João Silva',
          customer_phone: '+5511999999999',
          customer_rating: 4.8,
          fare: 25.50,
          distance: 5.2,
          duration: 15
        };
        dispatch(setBooking(mockBooking));
      }
    },
    {
      id: 'driver-rating',
      name: 'RatingUI - Motorista',
      description: 'Avaliação após corrida (motorista avalia passageiro)',
      screen: 'Map',
      setup: (dispatch, auth) => {
        const mockBooking = {
          id: 'test-booking-1',
          status: 'COMPLETE',
          pickup_address: 'Rua Teste, 123',
          drop_address: 'Avenida Paulista, 1000',
          pickup_location: {
            latitude: -23.5505,
            longitude: -46.6333
          },
          drop_location: {
            latitude: -23.5614,
            longitude: -46.6560
          },
          customer_name: 'João Silva',
          driver_name: 'Maria Santos',
          customer_phone: '+5511999999999',
          customer_rating: 4.8,
          fare: 25.50,
          distance: 5.2,
          duration: 15
        };
        dispatch(setBooking(mockBooking));
      }
    },
    {
      id: 'driver-receipt',
      name: 'ReceiptScreen - Motorista',
      description: 'Recibo da corrida',
      screen: 'Receipt',
      setup: (dispatch, auth) => {
        // Navegar para ReceiptScreen com dados mock
      }
    },
  ],
  // PASSAGEIRO
  passenger: [
    {
      id: 'passenger-map',
      name: 'MapScreen - Passageiro',
      description: 'Tela principal com mapa e busca de endereço',
      screen: 'Map',
      setup: (dispatch, auth) => {
        dispatch(clearBooking());
      }
    },
    {
      id: 'passenger-ui',
      name: 'PassengerUI',
      description: 'Selecionando endereço e tipo de veículo',
      screen: 'Map',
      setup: (dispatch, auth) => {
        // PassengerUI será renderizado automaticamente quando não há booking
      }
    },
    {
      id: 'passenger-booked',
      name: 'BookedCabScreen',
      description: 'Aguardando motorista aceitar corrida',
      screen: 'BookedCab',
      setup: (dispatch, auth) => {
        const mockBooking = {
          id: 'test-booking-2',
          status: 'PENDING',
          pickup_address: 'Rua Teste, 123',
          drop_address: 'Avenida Paulista, 1000',
          pickup_location: {
            latitude: -23.5505,
            longitude: -46.6333
          },
          drop_location: {
            latitude: -23.5614,
            longitude: -46.6560
          },
          fare: 25.50,
          distance: 5.2,
          duration: 15
        };
        dispatch(setBooking(mockBooking));
      }
    },
    {
      id: 'passenger-enroute',
      name: 'PassengerEnRouteUI',
      description: 'Motorista aceitou, a caminho do passageiro',
      screen: 'Map',
      setup: (dispatch, auth) => {
        const mockBooking = {
          id: 'test-booking-2',
          status: 'ACCEPTED',
          pickup_address: 'Rua Teste, 123',
          drop_address: 'Avenida Paulista, 1000',
          pickup_location: {
            latitude: -23.5505,
            longitude: -46.6333
          },
          drop_location: {
            latitude: -23.5614,
            longitude: -46.6560
          },
          driver_name: 'Maria Santos',
          driver_phone: '+5511888888888',
          driver_rating: 4.9,
          car_model: 'Honda Civic',
          car_plate: 'ABC-1234',
          car_color: 'Branco',
          fare: 25.50,
          distance: 5.2,
          duration: 15
        };
        dispatch(setBooking(mockBooking));
      }
    },
    {
      id: 'passenger-trip-tracking',
      name: 'TripTrackingScreen',
      description: 'Durante a viagem',
      screen: 'TripTracking',
      setup: (dispatch, auth) => {
        const mockBooking = {
          id: 'test-booking-2',
          status: 'STARTED',
          pickup_address: 'Rua Teste, 123',
          drop_address: 'Avenida Paulista, 1000',
          pickup_location: {
            latitude: -23.5505,
            longitude: -46.6333
          },
          drop_location: {
            latitude: -23.5614,
            longitude: -46.6560
          },
          driver_name: 'Maria Santos',
          driver_phone: '+5511888888888',
          driver_rating: 4.9,
          car_model: 'Honda Civic',
          car_plate: 'ABC-1234',
          car_color: 'Branco',
          fare: 25.50,
          distance: 5.2,
          duration: 15
        };
        dispatch(setBooking(mockBooking));
      }
    },
    {
      id: 'passenger-rating',
      name: 'RatingUI - Passageiro',
      description: 'Avaliação após corrida (passageiro avalia motorista)',
      screen: 'Map',
      setup: (dispatch, auth) => {
        const mockBooking = {
          id: 'test-booking-2',
          status: 'COMPLETE',
          pickup_address: 'Rua Teste, 123',
          drop_address: 'Avenida Paulista, 1000',
          pickup_location: {
            latitude: -23.5505,
            longitude: -46.6333
          },
          drop_location: {
            latitude: -23.5614,
            longitude: -46.6560
          },
          driver_name: 'Maria Santos',
          customer_name: 'João Silva',
          driver_phone: '+5511888888888',
          driver_rating: 4.9,
          car_model: 'Honda Civic',
          car_plate: 'ABC-1234',
          car_color: 'Branco',
          fare: 25.50,
          distance: 5.2,
          duration: 15
        };
        dispatch(setBooking(mockBooking));
      }
    },
    {
      id: 'passenger-receipt',
      name: 'ReceiptScreen - Passageiro',
      description: 'Recibo da corrida',
      screen: 'Receipt',
      setup: (dispatch, auth) => {
        // Navegar para ReceiptScreen com dados mock
      }
    },
  ]
};

export default function RideFlowTestScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const auth = useSelector(state => state.auth);
  const [currentUserType, setCurrentUserType] = useState(null);
  const [currentScreenIndex, setCurrentScreenIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);

  const userType = auth?.profile?.usertype || 'customer';
  const screens = RIDE_FLOW_SCREENS[userType] || RIDE_FLOW_SCREENS.passenger;

  useEffect(() => {
    setCurrentUserType(userType);
  }, [userType]);

  const handleNavigateToScreen = (screenConfig) => {
    Logger.log('🧪 [RideFlowTest] Navegando para:', screenConfig.name);
    
    // Executar setup PRIMEIRO para configurar o Redux
    if (screenConfig.setup) {
      Logger.log('🧪 [RideFlowTest] Executando setup...');
      screenConfig.setup(dispatch, auth);
      
      // Aguardar um pouco para o Redux atualizar
      setTimeout(() => {
        // Navegar para a tela DEPOIS do setup
        if (screenConfig.screen === 'Map') {
          Logger.log('🧪 [RideFlowTest] Navegando para Map...');
          navigation.navigate('Map');
        } else {
          Logger.log('🧪 [RideFlowTest] Navegando para', screenConfig.screen);
          navigation.navigate(screenConfig.screen, {
            booking: screenConfig.setup ? {
              id: 'test-booking',
              status: screenConfig.id.includes('enroute') ? 'ACCEPTED' : 
                     screenConfig.id.includes('start') ? 'REACHED' :
                     screenConfig.id.includes('rating') || screenConfig.id.includes('receipt') ? 'COMPLETED' : 'PENDING'
            } : null
          });
        }
      }, 100);
    } else {
      // Se não há setup, navegar imediatamente
      if (screenConfig.screen === 'Map') {
        navigation.navigate('Map');
      } else {
        navigation.navigate(screenConfig.screen);
      }
    }
  };

  const handleNextScreen = () => {
    if (currentScreenIndex < screens.length - 1) {
      const nextIndex = currentScreenIndex + 1;
      setCurrentScreenIndex(nextIndex);
      handleNavigateToScreen(screens[nextIndex]);
    }
  };

  const handlePreviousScreen = () => {
    if (currentScreenIndex > 0) {
      const prevIndex = currentScreenIndex - 1;
      setCurrentScreenIndex(prevIndex);
      handleNavigateToScreen(screens[prevIndex]);
    }
  };

  const handleAutoPlay = () => {
    if (isAutoPlaying) {
      setIsAutoPlaying(false);
      return;
    }

    setIsAutoPlaying(true);
    let index = currentScreenIndex;

    const playNext = () => {
      if (!isAutoPlaying || index >= screens.length - 1) {
        setIsAutoPlaying(false);
        return;
      }

      index++;
      setCurrentScreenIndex(index);
      handleNavigateToScreen(screens[index]);

      setTimeout(playNext, 5000); // 5 segundos por tela
    };

    setTimeout(playNext, 5000);
  };

  const currentScreen = screens[currentScreenIndex];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Fluxo de Corrida - {userType === 'driver' ? 'Motorista' : 'Passageiro'}</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.progressContainer}>
          <Text style={styles.progressText}>
            Tela {currentScreenIndex + 1} de {screens.length}
          </Text>
          <View style={styles.progressBar}>
            <View 
              style={[
                styles.progressFill, 
                { width: `${((currentScreenIndex + 1) / screens.length) * 100}%` }
              ]} 
            />
          </View>
        </View>

        <View style={styles.currentScreenCard}>
          <Text style={styles.currentScreenName}>{currentScreen?.name}</Text>
          <Text style={styles.currentScreenDescription}>{currentScreen?.description}</Text>
        </View>

        <View style={styles.controlsContainer}>
          <TouchableOpacity
            style={[styles.button, styles.prevButton, currentScreenIndex === 0 && styles.buttonDisabled]}
            onPress={handlePreviousScreen}
            disabled={currentScreenIndex === 0}
          >
            <Text style={styles.buttonText}>← Anterior</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.nextButton, currentScreenIndex === screens.length - 1 && styles.buttonDisabled]}
            onPress={handleNextScreen}
            disabled={currentScreenIndex === screens.length - 1}
          >
            <Text style={styles.buttonText}>Próxima →</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.button, styles.autoPlayButton, isAutoPlaying && styles.autoPlayButtonActive]}
          onPress={handleAutoPlay}
        >
          <Text style={styles.buttonText}>
            {isAutoPlaying ? '⏸ Pausar' : '▶ Reproduzir Automático'}
          </Text>
        </TouchableOpacity>

        <View style={styles.screensList}>
          <Text style={styles.screensListTitle}>Todas as Telas:</Text>
          {screens.map((screen, index) => (
            <TouchableOpacity
              key={screen.id}
              style={[
                styles.screenItem,
                index === currentScreenIndex && styles.screenItemActive
              ]}
              onPress={() => {
                setCurrentScreenIndex(index);
                handleNavigateToScreen(screen);
              }}
            >
              <Text style={styles.screenItemNumber}>{index + 1}</Text>
              <View style={styles.screenItemContent}>
                <Text style={styles.screenItemName}>{screen.name}</Text>
                <Text style={styles.screenItemDescription}>{screen.description}</Text>
              </View>
              {index === currentScreenIndex && (
                <Text style={styles.screenItemActiveIndicator}>●</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#1A330E',
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 15,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  progressContainer: {
    marginBottom: 20,
  },
  progressText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1A330E',
    borderRadius: 4,
  },
  currentScreenCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  currentScreenName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1A330E',
    marginBottom: 8,
  },
  currentScreenDescription: {
    fontSize: 14,
    color: '#666',
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
    gap: 10,
  },
  button: {
    flex: 1,
    backgroundColor: '#1A330E',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  prevButton: {
    backgroundColor: '#666',
  },
  nextButton: {
    backgroundColor: '#1A330E',
  },
  autoPlayButton: {
    backgroundColor: '#4CAF50',
    marginBottom: 20,
  },
  autoPlayButtonActive: {
    backgroundColor: '#FF9800',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  screensList: {
    marginTop: 20,
  },
  screensListTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A330E',
    marginBottom: 15,
  },
  screenItem: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  screenItemActive: {
    backgroundColor: '#E8F5E9',
    borderWidth: 2,
    borderColor: '#1A330E',
  },
  screenItemNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A330E',
    marginRight: 15,
    minWidth: 30,
  },
  screenItemContent: {
    flex: 1,
  },
  screenItemName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  screenItemDescription: {
    fontSize: 12,
    color: '#666',
  },
  screenItemActiveIndicator: {
    fontSize: 20,
    color: '#1A330E',
    marginLeft: 10,
  },
});

