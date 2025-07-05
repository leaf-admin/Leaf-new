const admin = require('firebase-admin');
const path = require('path');

// Configuração do Firebase Admin SDK
let firebaseApp = null;
let firestore = null;
let realtimeDB = null;

// Inicializar Firebase Admin SDK
function initializeFirebase() {
    try {
        // Verificar se já foi inicializado
        if (firebaseApp) {
            console.log('✅ Firebase já inicializado');
            return firebaseApp;
        }

        // Caminho para o arquivo de credenciais
        const serviceAccountPath = path.join(__dirname, '..', 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
        
        // Inicializar app
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccountPath),
            databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://leaf-reactnative-default-rtdb.firebaseio.com'
        });

        // Inicializar Firestore
        firestore = admin.firestore();
        
        // Inicializar Realtime Database
        realtimeDB = admin.database();

        console.log('✅ Firebase Admin SDK inicializado');
        console.log('📊 Firestore conectado');
        console.log('⚡ Realtime Database conectado');

        return firebaseApp;

    } catch (error) {
        console.error('❌ Erro ao inicializar Firebase:', error);
        return null;
    }
}

// Obter instância do Firestore
function getFirestore() {
    if (!firestore) {
        initializeFirebase();
    }
    return firestore;
}

// Obter instância do Realtime Database
function getRealtimeDB() {
    if (!realtimeDB) {
        initializeFirebase();
    }
    return realtimeDB;
}

// Sincronizar dados do Redis para Firestore
async function syncToFirestore(collection, documentId, data) {
    try {
        if (!firestore) {
            console.warn('⚠️ Firestore não disponível');
            return false;
        }

        const docRef = firestore.collection(collection).doc(documentId);
        await docRef.set({
            ...data,
            synced_at: admin.firestore.FieldValue.serverTimestamp(),
            source: 'redis-backend'
        }, { merge: true });

        console.log(`✅ Dados sincronizados para Firestore: ${collection}/${documentId}`);
        return true;

    } catch (error) {
        console.error('❌ Erro ao sincronizar para Firestore:', error);
        return false;
    }
}

// Sincronizar dados do Redis para Realtime Database
async function syncToRealtimeDB(path, data) {
    try {
        if (!realtimeDB) {
            console.warn('⚠️ Realtime Database não disponível');
            return false;
        }

        const ref = realtimeDB.ref(path);
        await ref.set({
            ...data,
            synced_at: admin.database.ServerValue.TIMESTAMP,
            source: 'redis-backend'
        });

        console.log(`✅ Dados sincronizados para Realtime DB: ${path}`);
        return true;

    } catch (error) {
        console.error('❌ Erro ao sincronizar para Realtime DB:', error);
        return false;
    }
}

// Sincronizar localização para ambos os bancos
async function syncLocation(uid, locationData) {
    const promises = [];
    
    // Sincronizar para Firestore
    promises.push(syncToFirestore('user_locations', uid, {
        ...locationData,
        last_updated: new Date().toISOString()
    }));

    // Sincronizar para Realtime Database
    promises.push(syncToRealtimeDB(`locations/${uid}`, {
        ...locationData,
        last_updated: new Date().toISOString()
    }));

    const results = await Promise.allSettled(promises);
    
    const firestoreSuccess = results[0].status === 'fulfilled' && results[0].value;
    const realtimeSuccess = results[1].status === 'fulfilled' && results[1].value;

    return { firestoreSuccess, realtimeSuccess };
}

// Sincronizar status do motorista
async function syncDriverStatus(uid, statusData) {
    const promises = [];
    
    // Sincronizar para Firestore
    promises.push(syncToFirestore('driver_status', uid, {
        ...statusData,
        last_updated: new Date().toISOString()
    }));

    // Sincronizar para Realtime Database
    promises.push(syncToRealtimeDB(`drivers/${uid}/status`, {
        ...statusData,
        last_updated: new Date().toISOString()
    }));

    const results = await Promise.allSettled(promises);
    
    const firestoreSuccess = results[0].status === 'fulfilled' && results[0].value;
    const realtimeSuccess = results[1].status === 'fulfilled' && results[1].value;

    return { firestoreSuccess, realtimeSuccess };
}

// Sincronizar dados de viagem
async function syncTripData(tripId, tripData) {
    try {
        if (!firestore) {
            console.warn('⚠️ Firestore não disponível');
            return false;
        }

        const docRef = firestore.collection('trips').doc(tripId);
        await docRef.set({
            ...tripData,
            synced_at: admin.firestore.FieldValue.serverTimestamp(),
            source: 'redis-backend'
        }, { merge: true });

        console.log(`✅ Dados de viagem sincronizados: ${tripId}`);
        return true;

    } catch (error) {
        console.error('❌ Erro ao sincronizar dados de viagem:', error);
        return false;
    }
}

// Obter dados do Firestore
async function getFromFirestore(collection, documentId) {
    try {
        if (!firestore) {
            console.warn('⚠️ Firestore não disponível');
            return null;
        }

        const docRef = firestore.collection(collection).doc(documentId);
        const doc = await docRef.get();

        if (doc.exists) {
            return doc.data();
        }

        return null;

    } catch (error) {
        console.error('❌ Erro ao obter dados do Firestore:', error);
        return null;
    }
}

// Obter dados do Realtime Database
async function getFromRealtimeDB(path) {
    try {
        if (!realtimeDB) {
            console.warn('⚠️ Realtime Database não disponível');
            return null;
        }

        const ref = realtimeDB.ref(path);
        const snapshot = await ref.once('value');

        if (snapshot.exists()) {
            return snapshot.val();
        }

        return null;

    } catch (error) {
        console.error('❌ Erro ao obter dados do Realtime DB:', error);
        return null;
    }
}

module.exports = {
    initializeFirebase,
    getFirestore,
    getRealtimeDB,
    syncToFirestore,
    syncToRealtimeDB,
    syncLocation,
    syncDriverStatus,
    syncTripData,
    getFromFirestore,
    getFromRealtimeDB
}; 