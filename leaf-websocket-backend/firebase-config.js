const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const circuitBreakerService = require('./services/circuit-breaker-service');
const { logStructured } = require('./utils/logger');

// Configuração do Firebase Admin SDK
let firebaseApp = null;
let firestore = null;
let storage = null;

function parseServiceAccountJson(rawValue, source) {
    try {
        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('invalid_service_account_shape');
        }
        return parsed;
    } catch (_error) {
        // Nunca propagar trechos do JSON da credencial no erro estruturado.
        throw new Error(`Firebase credentials inválidas em ${source}`);
    }
}

function readServiceAccountFile(configuredPath) {
    const resolvedPath = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(process.cwd(), configuredPath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error('Firebase credentials ausentes em GOOGLE_APPLICATION_CREDENTIALS');
    }

    try {
        const rawValue = fs.readFileSync(resolvedPath, 'utf8');
        return parseServiceAccountJson(rawValue, 'GOOGLE_APPLICATION_CREDENTIALS');
    } catch (error) {
        if (error?.message === 'Firebase credentials inválidas em GOOGLE_APPLICATION_CREDENTIALS') {
            throw error;
        }
        throw new Error('Firebase credentials indisponíveis em GOOGLE_APPLICATION_CREDENTIALS');
    }
}

// Inicializar Firebase Admin SDK
function initializeFirebase() {
    try {
        // Só considerar o Firebase pronto quando todos os clientes exigidos pelo
        // runtime (Firestore e Storage; o Realtime Database foi aposentado)
        // tiverem sido materializados.
        if (firebaseApp && firestore && storage) {
            logStructured('info', 'Firebase já inicializado', {
                service: 'firebase',
                operation: 'initialize'
            });
            return firebaseApp;
        }

        let appCandidate = firebaseApp;
        let initializationSource = 'module_cache';

        // Reutilizar app default já inicializado por outro módulo (ex.: helper de token em testes)
        if (!appCandidate && Array.isArray(admin.apps) && admin.apps.length > 0) {
            appCandidate = admin.app();
            initializationSource = 'admin.apps[0]';
        }

        if (!appCandidate) {
            // 1) Prioriza credencial via env (ideal para App Platform/containers)
            const serviceAccountJson =
                process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
                process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
            const serviceAccountFile = String(
                process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
            ).trim();

            if (serviceAccountJson) {
                const parsed = parseServiceAccountJson(
                    serviceAccountJson,
                    'FIREBASE_SERVICE_ACCOUNT_JSON/GOOGLE_APPLICATION_CREDENTIALS_JSON'
                );
                appCandidate = admin.initializeApp({
                    credential: admin.credential.cert(parsed)
                });
                initializationSource = 'inline_credentials';
            } else if (serviceAccountFile) {
                // 2) Em containers, lê o arquivo montado explicitamente pelo runtime.
                const parsed = readServiceAccountFile(serviceAccountFile);
                appCandidate = admin.initializeApp({
                    credential: admin.credential.cert(parsed)
                });
                initializationSource = 'mounted_credentials';
            } else {
                // 3) Fallback para arquivo local (ambiente dev/VPS tradicional)
                const serviceAccountPath = path.join(__dirname, 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
                if (!fs.existsSync(serviceAccountPath)) {
                    throw new Error('Firebase credentials ausentes: configure JSON inline ou GOOGLE_APPLICATION_CREDENTIALS');
                }

                appCandidate = admin.initializeApp({
                    credential: admin.credential.cert(serviceAccountPath)
                });
                initializationSource = 'legacy_local_credentials';
            }
        }

        // Resolver todos os clientes antes de publicar qualquer referência no
        // módulo. Se um deles falhar, a próxima tentativa reutiliza o app
        // default e refaz a inicialização completa.
        const firestoreCandidate = admin.firestore();
        const storageCandidate = admin.storage();

        firebaseApp = appCandidate;
        firestore = firestoreCandidate;
        storage = storageCandidate;

        logStructured('info', 'Firebase Admin SDK inicializado', {
            service: 'firebase',
            operation: 'initialize',
            source: initializationSource
        });
        logStructured('info', 'Firestore conectado', {
            service: 'firebase',
            operation: 'firestore_connect'
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

// Obter instância do Storage
function getStorage() {
    if (!storage) {
        initializeFirebase();
    }
    if (!storage) {
        logStructured('warn', 'Firebase Storage não disponível', {
            service: 'firebase',
            operation: 'getStorage'
        });
        return null;
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

module.exports = {
    initializeFirebase,
    getFirestore,
    getStorage,
    syncToFirestore,
    syncTripData,
    getFromFirestore
}; 
