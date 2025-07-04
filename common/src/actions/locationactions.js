import {
    FETCH_BOOKING_LOCATION,
    FETCH_BOOKING_LOCATION_SUCCESS,
    FETCH_BOOKING_LOCATION_FAILED,
    STOP_LOCATION_FETCH,
    STORE_ADRESSES
} from "../store/types";
import store from '../store/store';
import { firebase } from '../config/configureFirebase';
import { push, onValue, query, limitToLast, off, set } from 'firebase/database';
import { Platform } from 'react-native';
import { GetDistance } from '../other/GeoFunctions';
import { initializeRedis, USE_REDIS_LOCATION } from '../config/redisConfig';
import { redisLocationService } from '../services/redisLocationService';
import { redisTrackingService } from '../services/redisTrackingService';

// Feature flags para estratégia híbrida
const USE_REDIS_TRACKING = USE_REDIS_LOCATION && Platform.OS === 'web';
const FIREBASE_FALLBACK = true; // Sempre usar Firebase como fallback

// Inicializar serviços Redis se habilitados
let redisInitialized = false;
const initializeRedisServices = async () => {
    if (!redisInitialized && (USE_REDIS_LOCATION || USE_REDIS_TRACKING)) {
        try {
            await redisLocationService.initialize();
            await redisTrackingService.initialize();
            redisInitialized = true;
            console.log('✅ Redis services initialized for location actions');
        } catch (error) {
            console.error('❌ Failed to initialize Redis services:', error);
        }
    }
};

export const saveTracking = async (bookingId, location) => {
    try {
        // Redis (primário) - se habilitado
        if (USE_REDIS_TRACKING) {
            await initializeRedisServices();
            try {
                await redisTrackingService.updateTripLocation(
                    bookingId, 
                    location.lat, 
                    location.lng, 
                    location.at
                );
                console.log('📍 Tracking point saved to Redis:', bookingId);
            } catch (redisError) {
                console.error('❌ Redis tracking failed:', redisError);
                
                // Fallback para Firebase se habilitado
                if (FIREBASE_FALLBACK) {
                    try {
                        const { trackingRef } = firebase;
                        await push(trackingRef(bookingId), location);
                        console.log('🔄 Fallback to Firebase RT:', bookingId);
                    } catch (firebaseError) {
                        console.error('❌ Firebase fallback also failed:', firebaseError);
                        throw redisError; // Throw original error
                    }
                } else {
                    throw redisError;
                }
            }
        } else {
            // Usar apenas Firebase se Redis não estiver habilitado
            const { trackingRef } = firebase;
            await push(trackingRef(bookingId), location);
        }
    } catch (error) {
        console.error('❌ Error saving tracking:', error);
        throw error;
    }
};

export const fetchBookingLocations = (bookingId) => async (dispatch) => {
    const { trackingRef } = firebase;

    dispatch({
        type: FETCH_BOOKING_LOCATION,
        payload: bookingId,
    });

    // Firebase (legado)
    onValue(query(trackingRef(bookingId), limitToLast(1)), (snapshot) => {
        if (snapshot.val()) {
            let data = snapshot.val();
            const locations = Object.keys(data)
                .map((i) => {
                    return data[i]
                });
            if (locations.length == 1) {
                dispatch({
                    type: FETCH_BOOKING_LOCATION_SUCCESS,
                    payload: locations[0]
                });
            } else {
                dispatch({
                    type: FETCH_BOOKING_LOCATION_FAILED,
                    payload: store.getState().languagedata.defaultLanguage.location_fetch_error,
                });
            }
        } else {
            dispatch({
                type: FETCH_BOOKING_LOCATION_FAILED,
                payload: store.getState().languagedata.defaultLanguage.location_fetch_error,
            });
        }
    });

    // Redis (novo) - se habilitado
    if (USE_REDIS_TRACKING) {
        await initializeRedisServices();
        try {
            const lastPoint = await redisTrackingService.getLastTrackingPoint(bookingId);
            if (lastPoint) {
                console.log('Last tracking point from Redis:', lastPoint);
                // Por enquanto, mantemos Firebase como fonte principal
                // Futuramente, podemos usar Redis como fonte primária
            }
        } catch (redisError) {
            console.error('Redis tracking fetch failed:', redisError);
        }
    }
};

export const stopLocationFetch = (bookingId) => (dispatch) => {
    const { trackingRef } = firebase;

    dispatch({
        type: STOP_LOCATION_FETCH,
        payload: bookingId,
    });
    off(trackingRef(bookingId));

    // Redis cleanup se habilitado
    if (USE_REDIS_TRACKING && redisInitialized) {
        try {
            redisTrackingService.unsubscribeFromTracking(bookingId);
        } catch (error) {
            console.error('Error unsubscribing from Redis tracking:', error);
        }
    }
};

export const saveUserLocation = async (location) => {
    try {
        const { auth, userLocationRef } = firebase;
        const uid = auth.currentUser.uid;

        // Redis (primário) - se habilitado
        if (USE_REDIS_LOCATION) {
            await initializeRedisServices();
            try {
                await redisLocationService.updateUserLocation(
                    uid, 
                    location.lat, 
                    location.lng, 
                    location.at || Date.now()
                );
                console.log('📍 User location saved to Redis:', uid);
            } catch (redisError) {
                console.error('❌ Redis location save failed:', redisError);
                
                // Fallback para Firebase se habilitado
                if (FIREBASE_FALLBACK) {
                    try {
                        await set(userLocationRef(uid), location);
                        console.log('🔄 Fallback to Firebase RT:', uid);
                    } catch (firebaseError) {
                        console.error('❌ Firebase fallback also failed:', firebaseError);
                        throw redisError; // Throw original error
                    }
                } else {
                    throw redisError;
                }
            }
        } else {
            // Usar apenas Firebase se Redis não estiver habilitado
            await set(userLocationRef(uid), location);
        }
    } catch (error) {
        console.error('❌ Error saving user location:', error);
        throw error;
    }
};

// Nova função para obter localização do usuário (com fallback)
export const getUserLocation = async (uid) => {
    if (USE_REDIS_LOCATION) {
        await initializeRedisServices();
        try {
            const location = await redisLocationService.getUserLocation(uid);
            if (location) {
                console.log('📍 User location from Redis:', uid);
                return {
                    lat: location.latitude,
                    lng: location.longitude,
                    at: location.timestamp
                };
            }
        } catch (redisError) {
            console.error('❌ Redis location fetch failed:', redisError);
        }
    }

    // Fallback para Firebase
    if (USE_REDIS_LOCATION) {
        try {
            const { userLocationRef } = firebase;
            const snapshot = await get(userLocationRef(uid));
            return snapshot.val();
        } catch (firebaseError) {
            console.error('❌ Firebase location fetch failed:', firebaseError);
        }
    }

    return null;
};

// Nova função para obter motoristas próximos
export const getNearbyDrivers = async (lat, lng, radius = 5) => {
    if (USE_REDIS_LOCATION) {
        await initializeRedisServices();
        try {
            const drivers = await redisLocationService.findNearbyUsers(lat, lng, radius);
            console.log('📍 Nearby drivers from Redis:', drivers.length);
            return drivers;
        } catch (redisError) {
            console.error('❌ Redis nearby drivers fetch failed:', redisError);
        }
    }

    // Fallback para Firebase (implementação futura)
    return [];
};

// Nova função para iniciar tracking de viagem
export const startTripTracking = async (tripId, driverId, passengerId, initialLocation) => {
    if (USE_REDIS_TRACKING) {
        await initializeRedisServices();
        try {
            await redisTrackingService.startTripTracking(tripId, driverId, passengerId, initialLocation);
            console.log('🚗 Trip tracking started in Redis:', tripId);
        } catch (redisError) {
            console.error('❌ Redis trip tracking start failed:', redisError);
            if (!USE_REDIS_LOCATION) {
                throw redisError;
            }
        }
    }
};

// Nova função para finalizar tracking de viagem
export const endTripTracking = async (tripId, endLocation) => {
    if (USE_REDIS_TRACKING) {
        await initializeRedisServices();
        try {
            await redisTrackingService.endTripTracking(tripId, endLocation);
            console.log('✅ Trip tracking ended in Redis:', tripId);
        } catch (redisError) {
            console.error('❌ Redis trip tracking end failed:', redisError);
            if (!USE_REDIS_LOCATION) {
                throw redisError;
            }
        }
    }
};

// Nova função para obter dados da viagem
export const getTripData = async (tripId) => {
    if (USE_REDIS_TRACKING) {
        await initializeRedisServices();
        try {
            const tripData = await redisTrackingService.getTripData(tripId);
            if (tripData) {
                console.log('📍 Trip data from Redis:', tripId);
                return tripData;
            }
        } catch (redisError) {
            console.error('❌ Redis trip data fetch failed:', redisError);
        }
    }
    return null;
};

// Nova função para obter histórico de viagens do usuário (Firestore)
export const getUserTripHistory = async (userId, userType = 'passenger', limit = 50) => {
    if (USE_REDIS_LOCATION) {
        try {
            const history = await firestorePersistenceService.getUserTripHistory(userId, userType, limit);
            console.log('📊 Trip history from Firestore:', history.length, 'trips');
            return history;
        } catch (error) {
            console.error('❌ Error getting trip history:', error);
        }
    }
    return [];
};

// Nova função para obter estatísticas de viagens (Firestore)
export const getTripStatistics = async (userId, userType = 'passenger', period = 'month') => {
    if (USE_REDIS_LOCATION) {
        try {
            const stats = await firestorePersistenceService.getTripStatistics(userId, userType, period);
            console.log('📊 Trip statistics from Firestore:', stats);
            return stats;
        } catch (error) {
            console.error('❌ Error getting trip statistics:', error);
        }
    }
    return null;
};

// Nova função para persistir dados de viagem (Firestore)
export const persistTripData = async (tripId, tripData) => {
    if (USE_REDIS_LOCATION) {
        try {
            await firestorePersistenceService.persistTripData(tripId, tripData);
            console.log('💾 Trip data persisted to Firestore:', tripId);
            return true;
        } catch (error) {
            console.error('❌ Error persisting trip data:', error);
            throw error;
        }
    }
    return false;
};

export const storeAddresses = (data) => (dispatch) => {
    dispatch({
        type: STORE_ADRESSES,
        payload: data,
    });
};