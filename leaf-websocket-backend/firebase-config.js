const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const circuitBreakerService = require('./services/circuit-breaker-service');
const { logStructured } = require('./utils/logger');
const traceContext = require('./utils/trace-context');

// Configuração do Firebase Admin SDK
let firebaseApp = null;
let firestore = null;
let realtimeDB = null;
let storage = null;

// Inicializar Firebase Admin SDK
function initializeFirebase() {
    try {
        // Verificar se já foi inicializado
        if (firebaseApp) {
            logStructured('info', 'Firebase já inicializado', {
                service: 'firebase',
                operation: 'initialize'
            });
            return firebaseApp;
        }

        const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://leaf-reactnative-default-rtdb.firebaseio.com';

        // 1) Prioriza credencial via env (ideal para App Platform/containers)
        const serviceAccountJson =
            process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
            process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

        if (serviceAccountJson) {
            const parsed = JSON.parse(serviceAccountJson);
            firebaseApp = admin.initializeApp({
                credential: admin.credential.cert(parsed),
                databaseURL
            });
        } else {
            // 2) Fallback para arquivo local (ambiente dev/VPS tradicional)
            const serviceAccountPath = path.join(__dirname, 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
            if (!fs.existsSync(serviceAccountPath)) {
                throw new Error('Firebase credentials ausentes: defina FIREBASE_SERVICE_ACCOUNT_JSON');
            }

            firebaseApp = admin.initializeApp({
                credential: admin.credential.cert(serviceAccountPath),
                databaseURL
            });
        }

        // Inicializar Firestore
        firestore = admin.firestore();

        // Inicializar Realtime Database
        realtimeDB = admin.database();

        // Inicializar Storage
        storage = admin.storage();

        logStructured('info', 'Firebase Admin SDK inicializado', {
            service: 'firebase',
            operation: 'initialize'
        });
        logStructured('info', 'Firestore conectado', {
            service: 'firebase',
            operation: 'firestore_connect'
        });
        logStructured('info', 'Realtime Database conectado', {
            service: 'firebase',
            operation: 'realtime_connect'
        });
        logStructured('info', 'Storage conectado', {
            service: 'firebase',
            operation: 'storage_connect'
        });

        return firebaseApp;

    } catch (error) {
        logStructured('error', 'Erro ao inicializar Firebase', {
            service: 'firebase',
            operation: 'initialize',
            error: error.message,
            stack: error.stack
        });
        return null;
    }
}

// Obter instância do Firestore
function getFirestore() {
    if (!firestore) {
        initializeFirebase();
    }
    if (!firestore) {
        logStructured('warn', 'Firestore não disponível', {
            service: 'firebase',
            operation: 'getFirestore'
        });
        return null;
    }
    return firestore;
}

// Obter instância do Realtime Database
function getRealtimeDB() {
    if (!realtimeDB) {
        initializeFirebase();
    }
    if (!realtimeDB) {
        logStructured('warn', 'Realtime Database não disponível', {
            service: 'firebase',
            operation: 'getRealtimeDB'
        });
        return null;
    }
    return realtimeDB;
}

// Obter instância do Storage
function getStorage() {
    if (!storage) {
        initializeFirebase();
    }
    return storage;
}

// Sincronizar dados do Redis para Firestore (com circuit breaker)
async function syncToFirestore(collection, documentId, data) {
    return await circuitBreakerService.execute(
        'firebase_firestore_sync',
        async () => {
            const firestoreInstance = await getFirestore();
            if (!firestoreInstance) {
                throw new Error('Firestore não disponível');
            }

            const docRef = firestoreInstance.collection(collection).doc(documentId);
            await docRef.set({
                ...data,
                synced_at: admin.firestore.FieldValue.serverTimestamp(),
                source: 'redis-backend'
            }, { merge: true });

            logStructured('info', 'Dados sincronizados para Firestore', {
                service: 'firebase',
                operation: 'syncToFirestore',
                collection,
                documentId
            });
            return true;
        },
        async () => {
            // Fallback: retornar false se circuit breaker aberto
            logStructured('warn', 'Sync Firestore bloqueado', {
                service: 'firebase',
                operation: 'syncToFirestore',
                collection,
                documentId,
                circuitBreaker: 'open'
            });
            return false;
        },
        {
            failureThreshold: 5,
            timeout: 60000
        }
    );
}

// Sincronizar dados do Redis para Realtime Database
async function syncToRealtimeDB(path, data) {
    try {
        if (!realtimeDB) {
            logStructured('warn', 'Realtime Database não disponível', {
                service: 'firebase',
                operation: 'syncToRealtimeDB',
                path: path
            });
            return false;
        }

        const ref = realtimeDB.ref(path);
        await ref.set({
            ...data,
            synced_at: admin.database.ServerValue.TIMESTAMP,
            source: 'redis-backend'
        });

        logStructured('info', 'Dados sincronizados para Realtime DB', {
            service: 'firebase',
            operation: 'syncToRealtimeDB',
            path
        });
        return true;

    } catch (error) {
        logStructured('error', 'Erro ao sincronizar para Realtime DB', {
            service: 'firebase',
            operation: 'syncToRealtimeDB',
            path,
            error: error.message
        });
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
            logStructured('warn', 'Firestore não disponível', {
                service: 'firebase',
                operation: 'syncTripData',
                tripId: tripId
            });
            return false;
        }

        const docRef = firestore.collection('trips').doc(tripId);
        await docRef.set({
            ...tripData,
            synced_at: admin.firestore.FieldValue.serverTimestamp(),
            source: 'redis-backend'
        }, { merge: true });

        logStructured('info', 'Dados de viagem sincronizados', {
            service: 'firebase',
            operation: 'syncTripData',
            tripId
        });
        return true;

    } catch (error) {
        logStructured('error', 'Erro ao sincronizar dados de viagem', {
            service: 'firebase',
            operation: 'syncTripData',
            tripId,
            error: error.message
        });
        return false;
    }
}

// Obter dados do Firestore (com circuit breaker)
async function getFromFirestore(collection, documentId) {
    return await circuitBreakerService.execute(
        'firebase_firestore_get',
        async () => {
            const firestoreInstance = await getFirestore();
            if (!firestoreInstance) {
                throw new Error('Firestore não disponível');
            }

            const docRef = firestoreInstance.collection(collection).doc(documentId);
            const doc = await docRef.get();

            if (doc.exists) {
                return doc.data();
            }

            return null;
        },
        async () => {
            // Fallback: retornar null se circuit breaker aberto
            logStructured('warn', 'Get Firestore bloqueado', {
                service: 'firebase',
                operation: 'getFromFirestore',
                collection,
                documentId,
                circuitBreaker: 'open'
            });
            return null;
        },
        {
            failureThreshold: 5,
            timeout: 60000
        }
    );
}

// Obter dados do Realtime Database
async function getFromRealtimeDB(path) {
    try {
        if (!realtimeDB) {
            logStructured('warn', 'Realtime Database não disponível', {
                service: 'firebase',
                operation: 'getFromRealtimeDB',
                path: path
            });
            return null;
        }

        const ref = realtimeDB.ref(path);
        const snapshot = await ref.once('value');

        if (snapshot.exists()) {
            return snapshot.val();
        }

        return null;

    } catch (error) {
        logStructured('error', 'Erro ao obter dados do Realtime DB', {
            service: 'firebase',
            operation: 'getFromRealtimeDB',
            path,
            error: error.message
        });
        return null;
    }
}

module.exports = {
    initializeFirebase,
    getFirestore,
    getRealtimeDB,
    getStorage,
    syncToFirestore,
    syncToRealtimeDB,
    syncLocation,
    syncDriverStatus,
    syncTripData,
    getFromFirestore,
    getFromRealtimeDB
}; 
