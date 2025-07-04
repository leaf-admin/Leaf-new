// Importar usando ES modules (compatível com o projeto)
import { getFirestore, doc, setDoc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';

class FirestorePersistenceService {
    constructor() {
        this.db = null;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return true;

        try {
            // Verificar se já temos uma instância do Firebase
            if (global.firebase && global.firebase.app) {
                this.db = getFirestore(global.firebase.app);
            } else {
                // Inicializar Firebase com configuração padrão
                const defaultConfig = {
                    projectId: "leaf-reactnative",
                    appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
                    databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
                    storageBucket: "leaf-reactnative.firebasestorage.app",
                    apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
                    authDomain: "leaf-reactnative.firebaseapp.com",
                    messagingSenderId: "106504629884",
                    measurementId: "G-22368DBCY9"
                };

                const app = initializeApp(defaultConfig);
                this.db = getFirestore(app);
            }

            this.isInitialized = true;
            console.log('✅ Serviço de persistência Firestore inicializado');
            return true;
        } catch (error) {
            console.error('❌ Erro ao inicializar Firestore:', error);
            return false;
        }
    }

    // Persistir dados de uma viagem finalizada
    async persistTripData(tripId, tripData) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            if (!this.db) {
                throw new Error('Firestore não disponível');
            }

            const tripRef = doc(this.db, 'trips', tripId);
            
            // Preparar dados para persistência
            const persistenceData = {
                tripId: tripData.tripId,
                driverId: tripData.driverId,
                passengerId: tripData.passengerId,
                status: tripData.status,
                startTime: tripData.startTime,
                endTime: tripData.endTime || new Date().toISOString(),
                startLocation: tripData.startLocation,
                endLocation: tripData.endLocation,
                path: tripData.path || [],
                distance: tripData.distance || 0,
                duration: tripData.duration || 0,
                fare: tripData.fare || 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                // Dados adicionais para analytics
                completedAt: tripData.status === 'COMPLETED' ? new Date().toISOString() : null,
                cancelledAt: tripData.status === 'CANCELLED' ? new Date().toISOString() : null,
                cancelReason: tripData.cancelReason || null
            };

            await setDoc(tripRef, persistenceData, { merge: true });
            console.log('✅ Dados da viagem persistidos no Firestore:', tripId);
            
            return true;
        } catch (error) {
            console.error('❌ Erro ao persistir dados da viagem:', error);
            throw error;
        }
    }

    // Obter histórico de viagens de um usuário
    async getUserTripHistory(userId, userType = 'passenger', limit = 50) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            if (!this.db) {
                throw new Error('Firestore não disponível');
            }

            const field = userType === 'driver' ? 'driverId' : 'passengerId';
            const tripsRef = collection(this.db, 'trips');
            const q = query(
                tripsRef,
                where(field, '==', userId),
                orderBy('createdAt', 'desc'),
                limit(limit)
            );

            const querySnapshot = await getDocs(q);
            const trips = [];

            querySnapshot.forEach((doc) => {
                trips.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            console.log(`✅ Histórico de viagens obtido: ${trips.length} viagens`);
            return trips;
        } catch (error) {
            console.error('❌ Erro ao obter histórico de viagens:', error);
            throw error;
        }
    }

    // Obter estatísticas de viagens
    async getTripStatistics(userId, userType = 'passenger', period = 'month') {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            if (!this.db) {
                throw new Error('Firestore não disponível');
            }

            const field = userType === 'driver' ? 'driverId' : 'passengerId';
            const tripsRef = collection(this.db, 'trips');
            
            // Calcular período
            const now = new Date();
            let startDate;
            
            switch (period) {
                case 'week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                case 'year':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    break;
                default:
                    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            }

            const q = query(
                tripsRef,
                where(field, '==', userId),
                where('createdAt', '>=', startDate.toISOString())
            );

            const querySnapshot = await getDocs(q);
            
            const stats = {
                totalTrips: 0,
                completedTrips: 0,
                cancelledTrips: 0,
                totalDistance: 0,
                totalFare: 0,
                averageRating: 0,
                period: period
            };

            querySnapshot.forEach((doc) => {
                const trip = doc.data();
                stats.totalTrips++;
                
                if (trip.status === 'COMPLETED') {
                    stats.completedTrips++;
                    stats.totalDistance += trip.distance || 0;
                    stats.totalFare += trip.fare || 0;
                } else if (trip.status === 'CANCELLED') {
                    stats.cancelledTrips++;
                }
            });

            console.log(`✅ Estatísticas obtidas para ${userId}:`, stats);
            return stats;
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas:', error);
            throw error;
        }
    }

    // Migrar dados de Redis para Firestore (quando viagem é finalizada)
    async migrateTripFromRedis(tripId, redisData) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            if (!this.db) {
                throw new Error('Firestore não disponível');
            }

            // Preparar dados para migração
            const migrationData = {
                tripId: tripId,
                driverId: redisData.driverId,
                passengerId: redisData.passengerId,
                status: redisData.status,
                startTime: redisData.startTime,
                endTime: redisData.endTime || new Date().toISOString(),
                startLocation: redisData.startLocation,
                endLocation: redisData.endLocation,
                path: redisData.path || [],
                currentLocation: redisData.currentLocation,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                migratedFromRedis: true,
                migrationTimestamp: new Date().toISOString()
            };

            const tripRef = doc(this.db, 'trips', tripId);
            await setDoc(tripRef, migrationData, { merge: true });
            
            console.log('✅ Dados migrados do Redis para Firestore:', tripId);
            return true;
        } catch (error) {
            console.error('❌ Erro na migração do Redis para Firestore:', error);
            throw error;
        }
    }

    // Backup de dados críticos
    async backupCriticalData(data, collectionName = 'backups') {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            if (!this.db) {
                throw new Error('Firestore não disponível');
            }

            const backupRef = doc(this.db, collectionName, `${Date.now()}`);
            const backupData = {
                ...data,
                backupTimestamp: new Date().toISOString(),
                backupType: 'critical_data'
            };

            await setDoc(backupRef, backupData);
            console.log('✅ Backup crítico criado no Firestore');
            return true;
        } catch (error) {
            console.error('❌ Erro ao criar backup:', error);
            throw error;
        }
    }
}

// Singleton instance
const firestorePersistenceService = new FirestorePersistenceService();

export default firestorePersistenceService; 