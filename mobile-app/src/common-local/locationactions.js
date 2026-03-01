import Logger from '../utils/Logger';
import {
    FETCH_BOOKING_LOCATION,
    FETCH_BOOKING_LOCATION_SUCCESS,
    FETCH_BOOKING_LOCATION_FAILED,
    STOP_LOCATION_FETCH,
    STORE_ADRESSES
} from "../types";
import { firebase } from './config/configureFirebase';
import { api } from '../api';
import store from '../store/store';
import { LOCATION_LOADING, LOCATION_LOADED, LOCATION_ERROR } from '../store/types';
import { getAuth } from '@react-native-firebase/auth';
import { push, onValue, query, limitToLast, off, set, get } from '@react-native-firebase/database';
import { Platform } from 'react-native';
import { GetDistance } from '../other/GeoFunctions';


// Feature flags para estratégia híbrida
const USE_REDIS_TRACKING = false; // Redis desabilitado
const FIREBASE_FALLBACK = true; // Sempre usar Firebase como fallback

export const saveTracking = async (bookingId, location) => {
    try {
        // Usar apenas Firebase
        const { trackingRef } = firebase;
        await push(trackingRef(bookingId), location);
    } catch (error) {
        Logger.error('❌ Error saving tracking:', error);
        throw error;
    }
};

export const fetchBookingLocations = (bookingId) => async (dispatch) => {
    const { trackingRef } = firebase;

    dispatch({
        type: FETCH_BOOKING_LOCATION,
        payload: bookingId,
    });

    // Firebase
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
};

export const stopLocationFetch = (bookingId) => (dispatch) => {
    const { trackingRef } = firebase;

    dispatch({
        type: STOP_LOCATION_FETCH,
        payload: bookingId,
    });
    off(trackingRef(bookingId));
};

export const saveUserLocation = async (location) => {
    try {
        const { auth, userLocationRef } = firebase;
        const uid = auth.currentUser.uid;

        // Usar apenas Firebase
        await set(userLocationRef(uid), location);
    } catch (error) {
        Logger.error('❌ Error saving user location:', error);
        throw error;
    }
};

// Funções simplificadas sem Redis
export const getUserLocation = async (uid) => {
    // Implementação futura com Firebase
    return null;
};

export const getNearbyDrivers = async (lat, lng, radius = 5) => {
    try {
        const { auth, userLocationRef } = firebase;
        
        // Verificar se usuário está autenticado
        if (!auth.currentUser) {
            throw new Error('Usuário não autenticado');
        }

        // Buscar motoristas próximos no Firebase
        const driversRef = userLocationRef;
        const snapshot = await get(driversRef);
        
        if (!snapshot.exists()) {
            return [];
        }

        const drivers = [];
        const userData = snapshot.val();

        // Filtrar motoristas por distância
        Object.keys(userData).forEach(uid => {
            const driverData = userData[uid];
            
            // Verificar se é um motorista (tem role = 'driver')
            if (driverData.role === 'driver' && driverData.location) {
                const distance = calculateDistance(
                    lat, lng,
                    driverData.location.latitude,
                    driverData.location.longitude
                );

                // Se está dentro do raio especificado
                if (distance <= radius) {
                    drivers.push({
                        uid,
                        ...driverData,
                        distance: distance.toFixed(2)
                    });
                }
            }
        });

        // Ordenar por distância (mais próximo primeiro)
        drivers.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

        Logger.log(`📍 Encontrados ${drivers.length} motoristas próximos`);
        return drivers;

    } catch (error) {
        Logger.error('❌ Erro ao buscar motoristas próximos:', error);
        throw error;
    }
};

// Função auxiliar para calcular distância
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
};

export const startTripTracking = async (tripId, driverId, passengerId, initialLocation) => {
    try {
        const { auth, trackingRef } = firebase;
        
        if (!auth.currentUser) {
            throw new Error('Usuário não autenticado');
        }

        const tripData = {
            tripId,
            driverId,
            passengerId,
            startTime: Date.now(),
            startLocation: initialLocation,
            status: 'active',
            updates: []
        };

        await set(trackingRef(tripId), tripData);
        Logger.log(`🚗 Iniciado tracking da viagem ${tripId}`);
        
        return tripData;

    } catch (error) {
        Logger.error('❌ Erro ao iniciar tracking:', error);
        throw error;
    }
};

export const endTripTracking = async (tripId, endLocation) => {
    try {
        const { auth, trackingRef } = firebase;
        
        if (!auth.currentUser) {
            throw new Error('Usuário não autenticado');
        }

        const tripRef = trackingRef(tripId);
        const snapshot = await get(tripRef);
        
        if (!snapshot.exists()) {
            throw new Error('Viagem não encontrada');
        }

        const tripData = snapshot.val();
        tripData.endTime = Date.now();
        tripData.endLocation = endLocation;
        tripData.status = 'completed';
        tripData.duration = tripData.endTime - tripData.startTime;

        await set(tripRef, tripData);
        Logger.log(`✅ Finalizado tracking da viagem ${tripId}`);
        
        return tripData;

    } catch (error) {
        Logger.error('❌ Erro ao finalizar tracking:', error);
        throw error;
    }
};

export const getTripData = async (tripId) => {
    try {
        const { auth, trackingRef } = firebase;
        
        if (!auth.currentUser) {
            throw new Error('Usuário não autenticado');
        }

        const snapshot = await get(trackingRef(tripId));
        
        if (!snapshot.exists()) {
            return null;
        }

        return snapshot.val();

    } catch (error) {
        Logger.error('❌ Erro ao obter dados da viagem:', error);
        throw error;
    }
};

export const getUserTripHistory = async (userId, userType = 'passenger', limit = 50) => {
    try {
        const { auth, trackingRef } = firebase;
        
        if (!auth.currentUser) {
            throw new Error('Usuário não autenticado');
        }

        // Buscar viagens do usuário
        const tripsRef = trackingRef;
        const snapshot = await get(tripsRef);
        
        if (!snapshot.exists()) {
            return [];
        }

        const trips = [];
        const allTrips = snapshot.val();

        Object.keys(allTrips).forEach(tripId => {
            const trip = allTrips[tripId];
            
            // Filtrar por tipo de usuário
            if (userType === 'passenger' && trip.passengerId === userId) {
                trips.push({ tripId, ...trip });
            } else if (userType === 'driver' && trip.driverId === userId) {
                trips.push({ tripId, ...trip });
            }
        });

        // Ordenar por data (mais recente primeiro) e limitar
        trips.sort((a, b) => b.startTime - a.startTime);
        return trips.slice(0, limit);

    } catch (error) {
        Logger.error('❌ Erro ao obter histórico de viagens:', error);
        throw error;
    }
};

export const getTripStatistics = async (userId, userType = 'passenger', period = 'month') => {
    try {
        const trips = await getUserTripHistory(userId, userType, 1000);
        
        if (trips.length === 0) {
            return {
                totalTrips: 0,
                totalDistance: 0,
                totalDuration: 0,
                averageDistance: 0,
                averageDuration: 0
            };
        }

        const now = Date.now();
        const periodMs = {
            'day': 24 * 60 * 60 * 1000,
            'week': 7 * 24 * 60 * 60 * 1000,
            'month': 30 * 24 * 60 * 60 * 1000,
            'year': 365 * 24 * 60 * 60 * 1000
        };

        // Filtrar por período
        const filteredTrips = trips.filter(trip => 
            (now - trip.startTime) <= periodMs[period]
        );

        const stats = {
            totalTrips: filteredTrips.length,
            totalDistance: 0,
            totalDuration: 0,
            averageDistance: 0,
            averageDuration: 0
        };

        filteredTrips.forEach(trip => {
            if (trip.duration) {
                stats.totalDuration += trip.duration;
            }
            // Calcular distância se necessário
            if (trip.startLocation && trip.endLocation) {
                const distance = calculateDistance(
                    trip.startLocation.latitude, trip.startLocation.longitude,
                    trip.endLocation.latitude, trip.endLocation.longitude
                );
                stats.totalDistance += distance;
            }
        });

        if (stats.totalTrips > 0) {
            stats.averageDistance = stats.totalDistance / stats.totalTrips;
            stats.averageDuration = stats.totalDuration / stats.totalTrips;
        }

        return stats;

    } catch (error) {
        Logger.error('❌ Erro ao obter estatísticas:', error);
        throw error;
    }
};

export const persistTripData = async (tripId, tripData) => {
    try {
        const { auth, trackingRef } = firebase;
        
        if (!auth.currentUser) {
            throw new Error('Usuário não autenticado');
        }

        // Validar dados da viagem
        if (!tripId || !tripData) {
            throw new Error('Dados da viagem inválidos');
        }

        // Adicionar timestamp de persistência
        const dataToPersist = {
            ...tripData,
            persistedAt: Date.now(),
            persistedBy: auth.currentUser.uid
        };

        // Salvar no Firebase
        await set(trackingRef(tripId), dataToPersist);
        
        Logger.log(`💾 Dados da viagem ${tripId} persistidos com sucesso`);
        return true;

    } catch (error) {
        Logger.error('❌ Erro ao persistir dados da viagem:', error);
        throw error;
    }
};

export const storeAddresses = (data) => (dispatch) => {
    dispatch({
        type: STORE_ADRESSES,
        payload: data,
    });
};