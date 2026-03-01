import Logger from '../utils/Logger';
import database from '@react-native-firebase/database';
import firestore from '@react-native-firebase/firestore';
import { Platform } from 'react-native';


/**
 * Serviço para armazenar todos os dados da corrida de forma completa
 * Inclui geolocalização em tempo real, dados do motorista, passageiro, pagamento, avaliação
 */
class TripDataService {
    constructor() {
        this.locationUpdateInterval = null;
        this.driverLocationHistory = [];
        this.passengerLocationHistory = [];
        this.maxHistorySize = 1000; // Limitar histórico para não sobrecarregar
    }

    /**
     * Iniciar coleta de dados da corrida
     * @param {string} bookingId - ID da corrida
     * @param {object} initialData - Dados iniciais da corrida
     */
    async startTripTracking(bookingId, initialData) {
        try {
            Logger.log(`📊 [TripDataService] Iniciando tracking da corrida ${bookingId}`);
            Logger.log(`📊 [TripDataService] initialData:`, JSON.stringify(initialData, null, 2));
            Logger.log(`📊 [TripDataService] passengerId:`, initialData.passengerId || initialData.passenger?.id);

            // Estrutura completa dos dados da corrida
            const tripData = {
                bookingId: bookingId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                
                // Dados iniciais
                initialData: {
                    ...initialData,
                    timestamp: new Date().toISOString()
                },
                
                // Dados do motorista
                driver: {
                    id: initialData.driverId || initialData.driver?.id,
                    name: initialData.driverName || initialData.driver?.name,
                    phone: initialData.driverPhone || initialData.driver?.phone,
                    photo: initialData.driverPhoto || initialData.driver?.photo,
                    vehicle: {
                        brand: initialData.vehicleBrand || initialData.driver?.vehicle?.brand,
                        model: initialData.vehicleModel || initialData.driver?.vehicle?.model,
                        color: initialData.vehicleColor || initialData.driver?.vehicle?.color,
                        plate: initialData.vehiclePlate || initialData.driver?.vehicle?.plate,
                        photo: initialData.vehiclePhoto || initialData.driver?.vehicle?.photo
                    },
                    rating: initialData.driverRating || initialData.driver?.rating,
                    totalTrips: initialData.driverTotalTrips || initialData.driver?.totalTrips
                },
                
                // Dados do passageiro
                passenger: {
                    id: initialData.passengerId || initialData.passenger?.id,
                    name: initialData.passengerName || initialData.passenger?.name,
                    phone: initialData.passengerPhone || initialData.passenger?.phone,
                    photo: initialData.passengerPhoto || initialData.passenger?.photo,
                    rating: initialData.passengerRating || initialData.passenger?.rating
                },
                
                // Localização de partida e destino
                pickup: {
                    lat: initialData.pickup?.lat || initialData.pickupLat,
                    lng: initialData.pickup?.lng || initialData.pickupLng,
                    address: initialData.pickup?.address || initialData.pickupAddress,
                    timestamp: new Date().toISOString()
                },
                
                drop: {
                    lat: initialData.drop?.lat || initialData.dropLat,
                    lng: initialData.drop?.lng || initialData.dropLng,
                    address: initialData.drop?.address || initialData.dropAddress,
                    timestamp: null // Será preenchido quando chegar ao destino
                },
                
                // Histórico de localizações
                locationHistory: {
                    driver: [],
                    passenger: []
                },
                
                // Dados de pagamento
                payment: {
                    estimatedFare: initialData.estimatedFare || initialData.fare || 0,
                    finalFare: null,
                    distance: null, // Será calculado ao final
                    duration: null, // Será calculado ao final
                    paymentMethod: initialData.paymentMethod || null,
                    paymentStatus: 'pending', // pending, paid, refunded
                    paymentId: null,
                    paidAt: null,
                    refundedAt: null
                },
                
                // Status da corrida
                status: initialData.status || 'accepted', // accepted, started, completed, cancelled
                statusHistory: [
                    {
                        status: initialData.status || 'accepted',
                        timestamp: new Date().toISOString()
                    }
                ],
                
                // Timestamps importantes
                timestamps: {
                    acceptedAt: initialData.acceptedAt || new Date().toISOString(),
                    startedAt: null,
                    arrivedAtPickup: null,
                    arrivedAtDestination: null,
                    completedAt: null,
                    cancelledAt: null
                },
                
                // Avaliação
                rating: {
                    driverRating: null, // Avaliação do motorista pelo passageiro
                    passengerRating: null, // Avaliação do passageiro pelo motorista
                    driverComment: null,
                    passengerComment: null,
                    driverOptions: [], // Opções selecionadas pelo passageiro
                    passengerOptions: [], // Opções selecionadas pelo motorista
                    ratedAt: null
                },
                
                // Chat (mensagens durante a corrida)
                chat: [],
                
                // Problemas reportados
                reportedProblems: [],
                
                // Mudanças de destino
                destinationChanges: [],
                
                // Metadados
                metadata: {
                    appVersion: initialData.appVersion || '1.0.0',
                    platform: initialData.platform || 'mobile',
                    deviceInfo: initialData.deviceInfo || null
                }
            };

            // ✅ Garantir que passenger.id está presente
            if (!tripData.passenger || !tripData.passenger.id) {
                Logger.error('❌ [TripDataService] passenger.id não está presente!', tripData.passenger);
                throw new Error('passenger.id é obrigatório para salvar trip_data');
            }
            
            Logger.log(`📊 [TripDataService] Salvando tripData com passenger.id:`, tripData.passenger.id);
            
            // Salvar estrutura inicial no Firebase
            await this.saveTripData(bookingId, tripData);

            // Inicializar arrays de histórico
            this.driverLocationHistory = [];
            this.passengerLocationHistory = [];

            Logger.log(`✅ [TripDataService] Tracking iniciado para corrida ${bookingId}`);
            return tripData;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao iniciar tracking:', error);
            throw error;
        }
    }

    /**
     * Atualizar localização do motorista
     * @param {string} bookingId - ID da corrida
     * @param {object} location - {lat, lng, heading?, speed?, timestamp?}
     */
    async updateDriverLocation(bookingId, location) {
        try {
            const locationData = {
                lat: location.lat,
                lng: location.lng,
                heading: location.heading || null,
                speed: location.speed || null,
                timestamp: location.timestamp || new Date().toISOString(),
                accuracy: location.accuracy || null
            };

            // Adicionar ao histórico local (limitado)
            this.driverLocationHistory.push(locationData);
            if (this.driverLocationHistory.length > this.maxHistorySize) {
                this.driverLocationHistory.shift(); // Remover o mais antigo
            }

            // ✅ LOCALIZAÇÃO EM TEMPO REAL: Usar Redis GEO via WebSocket (não Firebase)
            // Firebase é apenas para snapshot inicial e final da corrida
            // As atualizações em tempo real devem ser enviadas via WebSocket para Redis GEO

            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao atualizar localização do motorista:', error);
            return false;
        }
    }

    /**
     * Atualizar localização do passageiro
     * @param {string} bookingId - ID da corrida
     * @param {object} location - {lat, lng, timestamp?}
     */
    async updatePassengerLocation(bookingId, location) {
        try {
            const locationData = {
                lat: location.lat,
                lng: location.lng,
                timestamp: location.timestamp || new Date().toISOString(),
                accuracy: location.accuracy || null
            };

            // Adicionar ao histórico local (limitado)
            this.passengerLocationHistory.push(locationData);
            if (this.passengerLocationHistory.length > this.maxHistorySize) {
                this.passengerLocationHistory.shift();
            }

            // ✅ LOCALIZAÇÃO EM TEMPO REAL: Usar Redis GEO via WebSocket (não Firebase)
            // Firebase é apenas para snapshot inicial e final da corrida
            // As atualizações em tempo real devem ser enviadas via WebSocket para Redis GEO

            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao atualizar localização do passageiro:', error);
            return false;
        }
    }

    /**
     * Atualizar status da corrida
     * @param {string} bookingId - ID da corrida
     * @param {string} status - Novo status
     * @param {object} additionalData - Dados adicionais
     */
    async updateTripStatus(bookingId, status, additionalData = {}) {
        try {
            const timestamp = new Date().toISOString();

            // ✅ Tentar atualizar no Firebase (opcional - não bloquear se falhar)
            try {
                const tripRef = database().ref(`trip_data/${bookingId}`);
                
                // Atualizar status
                await tripRef.child('status').set(status);

                // Adicionar ao histórico de status
                const statusEntry = {
                    status,
                    timestamp,
                    ...additionalData
                };
                await tripRef.child('statusHistory').push(statusEntry);

                // Atualizar timestamp correspondente
                const timestampKey = this.getTimestampKeyForStatus(status);
                if (timestampKey) {
                    await tripRef.child(`timestamps/${timestampKey}`).set(timestamp);
                }

                // Atualizar updatedAt
                await tripRef.child('updatedAt').set(timestamp);

                Logger.log(`✅ [TripDataService] Status atualizado para ${status} na corrida ${bookingId}`);
            } catch (firebaseError) {
                // ✅ Não bloquear se for erro de permissão
                if (firebaseError.code === 'database/permission-denied') {
                    Logger.warn(`⚠️ [TripDataService] Permissão negada no Firebase (status ${status} não salvo)`);
                } else {
                    Logger.warn(`⚠️ [TripDataService] Erro ao atualizar status no Firebase:`, firebaseError.message);
                }
            }

            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao atualizar status:', error);
            return false;
        }
    }

    /**
     * Atualizar dados de pagamento
     * @param {string} bookingId - ID da corrida
     * @param {object} paymentData - Dados do pagamento
     */
    async updatePayment(bookingId, paymentData) {
        try {
            const tripRef = database().ref(`trip_data/${bookingId}`);
            
            const paymentUpdate = {
                ...paymentData,
                updatedAt: new Date().toISOString()
            };

            await tripRef.child('payment').update(paymentUpdate);
            await tripRef.child('updatedAt').set(new Date().toISOString());

            Logger.log(`✅ [TripDataService] Pagamento atualizado para corrida ${bookingId}`);
            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao atualizar pagamento:', error);
            return false;
        }
    }

    /**
     * Salvar avaliação
     * @param {string} bookingId - ID da corrida
     * @param {object} ratingData - Dados da avaliação
     */
    async saveRating(bookingId, ratingData) {
        try {
            const tripRef = database().ref(`trip_data/${bookingId}`);
            
            const ratingUpdate = {
                ...ratingData,
                ratedAt: new Date().toISOString()
            };

            await tripRef.child('rating').update(ratingUpdate);
            await tripRef.child('updatedAt').set(new Date().toISOString());

            Logger.log(`✅ [TripDataService] Avaliação salva para corrida ${bookingId}`);
            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao salvar avaliação:', error);
            return false;
        }
    }

    /**
     * Adicionar mensagem do chat
     * @param {string} bookingId - ID da corrida
     * @param {object} messageData - Dados da mensagem
     */
    async addChatMessage(bookingId, messageData) {
        try {
            const tripRef = database().ref(`trip_data/${bookingId}`);
            
            const message = {
                ...messageData,
                timestamp: new Date().toISOString()
            };

            await tripRef.child('chat').push(message);
            await tripRef.child('updatedAt').set(new Date().toISOString());

            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao adicionar mensagem:', error);
            return false;
        }
    }

    /**
     * Adicionar problema reportado
     * @param {string} bookingId - ID da corrida
     * @param {object} problemData - Dados do problema
     */
    async addReportedProblem(bookingId, problemData) {
        try {
            const tripRef = database().ref(`trip_data/${bookingId}`);
            
            const problem = {
                ...problemData,
                reportedAt: new Date().toISOString()
            };

            await tripRef.child('reportedProblems').push(problem);
            await tripRef.child('updatedAt').set(new Date().toISOString());

            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao adicionar problema:', error);
            return false;
        }
    }

    /**
     * Adicionar mudança de destino
     * @param {string} bookingId - ID da corrida
     * @param {object} destinationData - Dados do novo destino
     */
    async addDestinationChange(bookingId, destinationData) {
        try {
            const tripRef = database().ref(`trip_data/${bookingId}`);
            
            const change = {
                ...destinationData,
                changedAt: new Date().toISOString()
            };

            await tripRef.child('destinationChanges').push(change);
            
            // Atualizar destino atual
            await tripRef.child('drop').update({
                lat: destinationData.lat,
                lng: destinationData.lng,
                address: destinationData.address,
                timestamp: new Date().toISOString()
            });
            
            await tripRef.child('updatedAt').set(new Date().toISOString());

            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao adicionar mudança de destino:', error);
            return false;
        }
    }

    /**
     * Finalizar corrida e salvar dados completos
     * @param {string} bookingId - ID da corrida
     * @param {object} finalData - Dados finais (distância, duração, valor final, etc)
     */
    async completeTrip(bookingId, finalData) {
        try {
            Logger.log(`📊 [TripDataService] Finalizando corrida ${bookingId}`);

            const tripRef = database().ref(`trip_data/${bookingId}`);
            const timestamp = new Date().toISOString();

            // Atualizar status
            await this.updateTripStatus(bookingId, 'completed', finalData);

            // Atualizar dados finais
            const updates = {
                'status': 'completed',
                'timestamps/completedAt': timestamp,
                'updatedAt': timestamp
            };

            // Atualizar pagamento final
            if (finalData.finalFare) {
                updates['payment/finalFare'] = finalData.finalFare;
                updates['payment/paidAt'] = timestamp;
                updates['payment/paymentStatus'] = 'paid';
            }

            if (finalData.distance) {
                updates['payment/distance'] = finalData.distance;
            }

            if (finalData.duration) {
                updates['payment/duration'] = finalData.duration;
            }

            // Atualizar destino final se fornecido
            if (finalData.drop) {
                updates['drop/lat'] = finalData.drop.lat;
                updates['drop/lng'] = finalData.drop.lng;
                updates['drop/address'] = finalData.drop.address;
                updates['drop/timestamp'] = timestamp;
            }

            // Salvar histórico completo de localizações (última vez)
            if (this.driverLocationHistory.length > 0) {
                updates['locationHistory/driver/full'] = this.driverLocationHistory;
            }

            if (this.passengerLocationHistory.length > 0) {
                updates['locationHistory/passenger/full'] = this.passengerLocationHistory;
            }

            await tripRef.update(updates);

            // Salvar também no Firestore para consultas mais eficientes
            try {
                const tripSnapshot = await tripRef.once('value');
                const completeTripData = tripSnapshot.val();

                await firestore().collection('trip_data').doc(bookingId).set({
                    ...completeTripData,
                    completedAt: timestamp,
                    indexedAt: timestamp
                }, { merge: true });

                Logger.log(`✅ [TripDataService] Dados completos salvos no Firestore para corrida ${bookingId}`);
            } catch (firestoreError) {
                // ✅ Tratar especificamente erros de permissão do Firestore
                if (firestoreError.code === 'permission-denied' || firestoreError.code === 'PERMISSION_DENIED') {
                    Logger.warn(`⚠️ [TripDataService] Permissão negada no Firestore para usuário de teste (continuando normalmente):`, firestoreError.message);
                } else {
                    Logger.warn('⚠️ [TripDataService] Erro ao salvar no Firestore (continuando):', firestoreError);
                }
            }

            // Limpar histórico local
            this.driverLocationHistory = [];
            this.passengerLocationHistory = [];

            Logger.log(`✅ [TripDataService] Corrida ${bookingId} finalizada e dados salvos`);
            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao finalizar corrida:', error);
            throw error;
        }
    }

    /**
     * Buscar dados completos da corrida
     * @param {string} bookingId - ID da corrida
     */
    async getTripData(bookingId) {
        try {
            const tripRef = database().ref(`trip_data/${bookingId}`);
            const snapshot = await tripRef.once('value');
            return snapshot.val();

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao buscar dados da corrida:', error);
            throw error;
        }
    }

    /**
     * Exportar dados da corrida em JSON
     * @param {string} bookingId - ID da corrida
     */
    async exportTripDataAsJSON(bookingId) {
        try {
            const tripData = await this.getTripData(bookingId);
            return JSON.stringify(tripData, null, 2);

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao exportar dados:', error);
            throw error;
        }
    }

    /**
     * Salvar dados da corrida (método auxiliar)
     */
    async saveTripData(bookingId, tripData) {
        try {
            const tripRef = database().ref(`trip_data/${bookingId}`);
            await tripRef.set(tripData);
            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao salvar dados:', error);
            // ✅ Não bloquear o fluxo - apenas logar o erro
            // As regras do Firebase agora estão configuradas corretamente
            return false;
        }
    }

    /**
     * Obter chave de timestamp baseada no status
     */
    getTimestampKeyForStatus(status) {
        const statusMap = {
            'accepted': 'acceptedAt',
            'started': 'startedAt',
            'arrived': 'arrivedAtPickup',
            'completed': 'completedAt',
            'cancelled': 'cancelledAt'
        };
        return statusMap[status] || null;
    }

    /**
     * Registrar tempo de busca do motorista (métricas)
     * @param {string} bookingId - ID da corrida
     * @param {number} searchTimeSeconds - Tempo de busca em segundos
     * @param {object} metadata - Metadados adicionais (raio de busca, região, etc)
     */
    async recordDriverSearchTime(bookingId, searchTimeSeconds, metadata = {}) {
        try {
            const timestamp = Date.now();
            const searchTimeMinutes = Math.round((searchTimeSeconds / 60) * 100) / 100; // Arredondar para 2 casas decimais
            
            // Salvar no trip_data para referência na corrida
            const tripRef = database().ref(`trip_data/${bookingId}`);
            await tripRef.update({
                driverSearchTimeSeconds: searchTimeSeconds,
                driverSearchTimeMinutes: searchTimeMinutes,
                driverSearchCompletedAt: timestamp
            });

            // Salvar em coleção de métricas para análises
            const metricsRef = database().ref(`driver_search_metrics/${bookingId}`);
            const now = new Date();
            await metricsRef.set({
                bookingId,
                searchTimeSeconds,
                searchTimeMinutes,
                timestamp,
                date: now.toISOString().split('T')[0], // YYYY-MM-DD para agregações
                hour: now.getHours(), // Hora do dia para análises de pico
                dayOfWeek: now.getDay(), // 0 = domingo, 6 = sábado
                result: metadata.result || 'driver_found', // 'driver_found' ou 'no_driver_found'
                ...metadata
            });

            Logger.log(`📊 [TripDataService] Tempo de busca registrado: ${searchTimeMinutes} minutos (${searchTimeSeconds}s) para corrida ${bookingId}`);
            return true;

        } catch (error) {
            Logger.error('❌ [TripDataService] Erro ao registrar tempo de busca:', error);
            return false;
        }
    }

    /**
     * Parar tracking (limpar intervalos)
     */
    stopTracking() {
        if (this.locationUpdateInterval) {
            clearInterval(this.locationUpdateInterval);
            this.locationUpdateInterval = null;
        }
        this.driverLocationHistory = [];
        this.passengerLocationHistory = [];
    }
}

// Exportar instância singleton
const tripDataService = new TripDataService();
export default tripDataService;



