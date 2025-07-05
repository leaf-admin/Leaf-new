const admin = require('firebase-admin');
const firebaseConfig = require('./firebase-config');

// Estrutura do Firestore para sincronização com Redis
const FIRESTORE_STRUCTURE = {
  // Coleção: Localizações dos usuários/motoristas
  USER_LOCATIONS: {
    collection: 'user_locations',
    fields: {
      uid: 'string',           // ID do usuário
      lat: 'number',           // Latitude
      lng: 'number',           // Longitude
      timestamp: 'timestamp',  // Timestamp da atualização
      platform: 'string',      // 'mobile', 'web', etc.
      isOnline: 'boolean',     // Status online/offline
      last_updated: 'timestamp', // Última atualização
      synced_at: 'timestamp',  // Timestamp da sincronização
      source: 'string'         // 'redis-backend'
    }
  },

  // Coleção: Status dos motoristas
  DRIVER_STATUS: {
    collection: 'driver_status',
    fields: {
      uid: 'string',           // ID do motorista
      status: 'string',        // 'available', 'busy', 'offline'
      isOnline: 'boolean',     // Status online/offline
      lat: 'number',           // Latitude atual
      lng: 'number',           // Longitude atual
      lastUpdate: 'timestamp', // Última atualização
      last_updated: 'timestamp', // Timestamp da sincronização
      synced_at: 'timestamp',  // Timestamp da sincronização
      source: 'string'         // 'redis-backend'
    }
  },

  // Coleção: Viagens
  TRIPS: {
    collection: 'trips',
    fields: {
      tripId: 'string',        // ID da viagem
      driverId: 'string',      // ID do motorista
      passengerId: 'string',   // ID do passageiro
      status: 'string',        // 'pending', 'active', 'completed', 'cancelled'
      pickup: {
        lat: 'number',
        lng: 'number',
        address: 'string'
      },
      destination: {
        lat: 'number',
        lng: 'number',
        address: 'string'
      },
      fare: 'number',          // Valor da corrida
      distance: 'number',      // Distância em metros
      duration: 'number',      // Duração em segundos
      createdAt: 'timestamp',  // Data de criação
      updatedAt: 'timestamp',  // Última atualização
      synced_at: 'timestamp',  // Timestamp da sincronização
      source: 'string'         // 'redis-backend'
    }
  },

  // Coleção: Estatísticas
  STATISTICS: {
    collection: 'statistics',
    fields: {
      id: 'string',            // ID único da estatística
      type: 'string',          // 'daily', 'weekly', 'monthly'
      date: 'string',          // Data (YYYY-MM-DD)
      total_users: 'number',   // Total de usuários
      online_users: 'number',  // Usuários online
      offline_users: 'number', // Usuários offline
      total_trips: 'number',   // Total de viagens
      completed_trips: 'number', // Viagens completadas
      cancelled_trips: 'number', // Viagens canceladas
      total_revenue: 'number', // Receita total
      createdAt: 'timestamp',  // Data de criação
      synced_at: 'timestamp',  // Timestamp da sincronização
      source: 'string'         // 'redis-backend'
    }
  }
};

// Estrutura do Realtime Database
const REALTIME_STRUCTURE = {
  // Localizações em tempo real
  LOCATIONS: 'locations/{uid}',
  
  // Status dos motoristas
  DRIVERS: 'drivers/{uid}/status',
  
  // Viagens ativas
  ACTIVE_TRIPS: 'active_trips/{tripId}',
  
  // Estatísticas em tempo real
  REALTIME_STATS: 'realtime_stats'
};

// Função para criar estrutura inicial no Firestore
async function createFirestoreStructure() {
  try {
    const firestore = firebaseConfig.getFirestore();
    
    if (!firestore) {
      console.error('❌ Firestore não disponível');
      return false;
    }

    console.log('🏗️ Criando estrutura inicial no Firestore...');

    // Criar documento de exemplo para cada coleção
    const collections = [
      {
        name: FIRESTORE_STRUCTURE.USER_LOCATIONS.collection,
        docId: 'example_user',
        data: {
          uid: 'example_user',
          lat: -23.5505,
          lng: -46.6333,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          platform: 'mobile',
          isOnline: true,
          last_updated: admin.firestore.FieldValue.serverTimestamp(),
          synced_at: admin.firestore.FieldValue.serverTimestamp(),
          source: 'redis-backend'
        }
      },
      {
        name: FIRESTORE_STRUCTURE.DRIVER_STATUS.collection,
        docId: 'example_driver',
        data: {
          uid: 'example_driver',
          status: 'available',
          isOnline: true,
          lat: -23.5505,
          lng: -46.6333,
          lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
          last_updated: admin.firestore.FieldValue.serverTimestamp(),
          synced_at: admin.firestore.FieldValue.serverTimestamp(),
          source: 'redis-backend'
        }
      },
      {
        name: FIRESTORE_STRUCTURE.TRIPS.collection,
        docId: 'example_trip',
        data: {
          tripId: 'example_trip',
          driverId: 'example_driver',
          passengerId: 'example_user',
          status: 'pending',
          pickup: {
            lat: -23.5505,
            lng: -46.6333,
            address: 'São Paulo, SP'
          },
          destination: {
            lat: -23.5505,
            lng: -46.6333,
            address: 'São Paulo, SP'
          },
          fare: 25.50,
          distance: 5000,
          duration: 900,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          synced_at: admin.firestore.FieldValue.serverTimestamp(),
          source: 'redis-backend'
        }
      },
      {
        name: FIRESTORE_STRUCTURE.STATISTICS.collection,
        docId: 'daily_2024_01_01',
        data: {
          id: 'daily_2024_01_01',
          type: 'daily',
          date: '2024-01-01',
          total_users: 0,
          online_users: 0,
          offline_users: 0,
          total_trips: 0,
          completed_trips: 0,
          cancelled_trips: 0,
          total_revenue: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          synced_at: admin.firestore.FieldValue.serverTimestamp(),
          source: 'redis-backend'
        }
      }
    ];

    // Criar documentos de exemplo
    for (const collection of collections) {
      const docRef = firestore.collection(collection.name).doc(collection.docId);
      await docRef.set(collection.data);
      console.log(`✅ Criado: ${collection.name}/${collection.docId}`);
    }

    console.log('✅ Estrutura do Firestore criada com sucesso!');
    return true;

  } catch (error) {
    console.error('❌ Erro ao criar estrutura do Firestore:', error);
    return false;
  }
}

// Função para criar estrutura inicial no Realtime Database
async function createRealtimeStructure() {
  try {
    const realtimeDB = firebaseConfig.getRealtimeDB();
    
    if (!realtimeDB) {
      console.error('❌ Realtime Database não disponível');
      return false;
    }

    console.log('⚡ Criando estrutura inicial no Realtime Database...');

    // Criar estrutura inicial
    const initialData = {
      locations: {
        example_user: {
          lat: -23.5505,
          lng: -46.6333,
          timestamp: admin.database.ServerValue.TIMESTAMP,
          platform: 'mobile',
          isOnline: true,
          last_updated: admin.database.ServerValue.TIMESTAMP,
          synced_at: admin.database.ServerValue.TIMESTAMP,
          source: 'redis-backend'
        }
      },
      drivers: {
        example_driver: {
          status: {
            status: 'available',
            isOnline: true,
            lat: -23.5505,
            lng: -46.6333,
            lastUpdate: admin.database.ServerValue.TIMESTAMP,
            last_updated: admin.database.ServerValue.TIMESTAMP,
            synced_at: admin.database.ServerValue.TIMESTAMP,
            source: 'redis-backend'
          }
        }
      },
      active_trips: {
        example_trip: {
          tripId: 'example_trip',
          driverId: 'example_driver',
          passengerId: 'example_user',
          status: 'pending',
          pickup: {
            lat: -23.5505,
            lng: -46.6333,
            address: 'São Paulo, SP'
          },
          destination: {
            lat: -23.5505,
            lng: -46.6333,
            address: 'São Paulo, SP'
          },
          fare: 25.50,
          distance: 5000,
          duration: 900,
          createdAt: admin.database.ServerValue.TIMESTAMP,
          updatedAt: admin.database.ServerValue.TIMESTAMP,
          synced_at: admin.database.ServerValue.TIMESTAMP,
          source: 'redis-backend'
        }
      },
      realtime_stats: {
        total_users: 0,
        online_users: 0,
        offline_users: 0,
        total_trips: 0,
        completed_trips: 0,
        cancelled_trips: 0,
        total_revenue: 0,
        last_updated: admin.database.ServerValue.TIMESTAMP,
        source: 'redis-backend'
      }
    };

    await realtimeDB.ref().set(initialData);
    console.log('✅ Estrutura do Realtime Database criada com sucesso!');
    return true;

  } catch (error) {
    console.error('❌ Erro ao criar estrutura do Realtime Database:', error);
    return false;
  }
}

// Função para inicializar toda a estrutura
async function initializeFirebaseStructure() {
  console.log('🚀 Inicializando estrutura completa do Firebase...');
  
  const firestoreResult = await createFirestoreStructure();
  const realtimeResult = await createRealtimeStructure();
  
  if (firestoreResult && realtimeResult) {
    console.log('✅ Estrutura Firebase inicializada com sucesso!');
    return true;
  } else {
    console.error('❌ Erro ao inicializar estrutura Firebase');
    return false;
  }
}

module.exports = {
  FIRESTORE_STRUCTURE,
  REALTIME_STRUCTURE,
  createFirestoreStructure,
  createRealtimeStructure,
  initializeFirebaseStructure
}; 