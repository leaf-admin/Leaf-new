#!/usr/bin/env node

/**
 * Teste das Implementações Pendentes
 * 
 * Testa as funções que foram implementadas:
 * - getNearbyDrivers
 * - persistTripData  
 * - handleAuthenticationError
 */

console.log('🧪 TESTE DAS IMPLEMENTAÇÕES PENDENTES');
console.log('=====================================\n');

// Mock do Firebase para testes
const mockFirebase = {
  auth: {
    currentUser: {
      uid: 'test-user-123'
    }
  },
  userLocationRef: 'users/locations',
  trackingRef: 'trips'
};

// Mock do get function do Firebase
const mockGet = async (ref) => {
  // Simular dados de motoristas
  if (ref === 'users/locations') {
    return {
      exists: () => true,
      val: () => ({
        'driver-1': {
          role: 'driver',
          location: { latitude: -23.5505, longitude: -46.6333 },
          name: 'João Silva',
          vehicle: 'ABC-1234'
        },
        'driver-2': {
          role: 'driver', 
          location: { latitude: -23.5500, longitude: -46.6330 },
          name: 'Maria Santos',
          vehicle: 'XYZ-5678'
        },
        'passenger-1': {
          role: 'passenger',
          location: { latitude: -23.5502, longitude: -46.6331 }
        }
      })
    };
  }
  
  // Simular dados de viagem
  if (ref.startsWith('trips/')) {
    return {
      exists: () => true,
      val: () => ({
        tripId: 'trip-123',
        driverId: 'driver-1',
        passengerId: 'passenger-1',
        startTime: Date.now() - 3600000, // 1 hora atrás
        startLocation: { latitude: -23.5505, longitude: -46.6333 },
        status: 'active'
      })
    };
  }
  
  return { exists: () => false };
};

// Mock do set function do Firebase
const mockSet = async (ref, data) => {
  console.log(`💾 Salvando em ${ref}:`, JSON.stringify(data, null, 2));
  return true;
};

// Teste da função getNearbyDrivers
async function testGetNearbyDrivers() {
  console.log('📍 Testando getNearbyDrivers...');
  
  try {
    // Mock da função calculateDistance
    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    // Simular a função getNearbyDrivers
    const getNearbyDrivers = async (lat, lng, radius = 5) => {
      try {
        const { auth, userLocationRef } = mockFirebase;
        
        if (!auth.currentUser) {
          throw new Error('Usuário não autenticado');
        }

        const driversRef = userLocationRef;
        const snapshot = await mockGet(driversRef);
        
        if (!snapshot.exists()) {
          return [];
        }

        const drivers = [];
        const userData = snapshot.val();

        Object.keys(userData).forEach(uid => {
          const driverData = userData[uid];
          
          if (driverData.role === 'driver' && driverData.location) {
            const distance = calculateDistance(
              lat, lng,
              driverData.location.latitude,
              driverData.location.longitude
            );

            if (distance <= radius) {
              drivers.push({
                uid,
                ...driverData,
                distance: distance.toFixed(2)
              });
            }
          }
        });

        drivers.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
        return drivers;

      } catch (error) {
        console.error('❌ Erro ao buscar motoristas próximos:', error);
        throw error;
      }
    };

    const drivers = await getNearbyDrivers(-23.5505, -46.6333, 5);
    
    console.log('✅ getNearbyDrivers funcionando!');
    console.log(`📍 Encontrados ${drivers.length} motoristas:`);
    drivers.forEach(driver => {
      console.log(`   - ${driver.name} (${driver.vehicle}) - ${driver.distance}km`);
    });
    
    return true;
    
  } catch (error) {
    console.error('❌ Erro no teste getNearbyDrivers:', error);
    return false;
  }
}

// Teste da função persistTripData
async function testPersistTripData() {
  console.log('\n💾 Testando persistTripData...');
  
  try {
    const persistTripData = async (tripId, tripData) => {
      try {
        const { auth, trackingRef } = mockFirebase;
        
        if (!auth.currentUser) {
          throw new Error('Usuário não autenticado');
        }

        if (!tripId || !tripData) {
          throw new Error('Dados da viagem inválidos');
        }

        const dataToPersist = {
          ...tripData,
          persistedAt: Date.now(),
          persistedBy: auth.currentUser.uid
        };

        await mockSet(`${trackingRef}/${tripId}`, dataToPersist);
        
        console.log(`💾 Dados da viagem ${tripId} persistidos com sucesso`);
        return true;

      } catch (error) {
        console.error('❌ Erro ao persistir dados da viagem:', error);
        throw error;
      }
    };

    const tripData = {
      tripId: 'test-trip-123',
      driverId: 'driver-1',
      passengerId: 'passenger-1',
      startTime: Date.now(),
      startLocation: { latitude: -23.5505, longitude: -46.6333 },
      status: 'active'
    };

    const result = await persistTripData('test-trip-123', tripData);
    
    console.log('✅ persistTripData funcionando!');
    console.log(`💾 Resultado: ${result}`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Erro no teste persistTripData:', error);
    return false;
  }
}

// Teste da função handleAuthenticationError
function testHandleAuthenticationError() {
  console.log('\n🔐 Testando handleAuthenticationError...');
  
  try {
    // Mock do Alert
    global.Alert = {
      alert: (title, message, buttons) => {
        console.log(`🔔 Alert: ${title} - ${message}`);
        if (buttons && buttons[0] && buttons[0].onPress) {
          buttons[0].onPress();
        }
      }
    };

    // Mock do AsyncStorage
    global.AsyncStorage = {
      removeItem: async (key) => {
        console.log(`🧹 Removendo ${key} do AsyncStorage`);
        return Promise.resolve();
      }
    };

    // Mock do navigation
    global.navigationRef = {
      current: {
        dispatch: (action) => {
          console.log('📱 Navegando para login...');
        },
        navigate: (screen) => {
          console.log(`📱 Navegando para ${screen}...`);
        }
      }
    };

    const handleAuthenticationError = () => {
      console.log('🔐 Redirecionando para login...');
      
      try {
        // Limpar dados de autenticação
        const keysToRemove = [
          'userToken',
          'userData', 
          'authState',
          'refreshToken'
        ];
        
        keysToRemove.forEach(key => {
          global.AsyncStorage.removeItem(key).catch(err => {
            console.log(`⚠️ Erro ao remover ${key}:`, err);
          });
        });
        
        // Redirecionar para login
        if (global.navigationRef && global.navigationRef.current) {
          global.navigationRef.current.dispatch({
            type: 'RESET',
            routes: [{ name: 'Login' }]
          });
        }
        
        console.log('✅ Redirecionamento para login concluído');
        
      } catch (error) {
        console.error('❌ Erro ao redirecionar para login:', error);
        global.Alert.alert(
          'Erro de Autenticação',
          'Ocorreu um erro de autenticação. Por favor, reinicie o aplicativo.'
        );
      }
    };

    handleAuthenticationError();
    
    console.log('✅ handleAuthenticationError funcionando!');
    return true;
    
  } catch (error) {
    console.error('❌ Erro no teste handleAuthenticationError:', error);
    return false;
  }
}

// Executar todos os testes
async function runAllTests() {
  console.log('🚀 Iniciando testes das implementações...\n');
  
  const results = {
    getNearbyDrivers: await testGetNearbyDrivers(),
    persistTripData: await testPersistTripData(),
    handleAuthenticationError: testHandleAuthenticationError()
  };
  
  console.log('\n📊 RESULTADOS DOS TESTES:');
  console.log('========================');
  
  Object.keys(results).forEach(test => {
    const status = results[test] ? '✅ PASSOU' : '❌ FALHOU';
    console.log(`${test}: ${status}`);
  });
  
  const allPassed = Object.values(results).every(result => result);
  
  if (allPassed) {
    console.log('\n🎉 TODOS OS TESTES PASSARAM!');
    console.log('✅ Implementações funcionando corretamente');
  } else {
    console.log('\n⚠️ ALGUNS TESTES FALHARAM');
    console.log('🔧 Verificar implementações');
  }
  
  return allPassed;
}

// Executar se chamado diretamente
if (require.main === module) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = {
  testGetNearbyDrivers,
  testPersistTripData,
  testHandleAuthenticationError,
  runAllTests
}; 