import {
    FETCH_BOOKING_LOCATION,
    FETCH_BOOKING_LOCATION_SUCCESS,
    FETCH_BOOKING_LOCATION_FAILED,
    STOP_LOCATION_FETCH,
    STORE_ADRESSES
} from "../types.js";
import { firebase } from '../config/configureFirebase';
import { api } from '../api';
import store from '../store/store';
import { LOCATION_LOADING, LOCATION_LOADED, LOCATION_ERROR } from '../store/types';
import { getAuth } from '@react-native-firebase/auth';
import { push, onValue, query, limitToLast, off, set } from '@react-native-firebase/database';
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
        console.error('❌ Error saving user location:', error);
        throw error;
    }
};

// Funções simplificadas sem Redis
export const getUserLocation = async (uid) => {
    // Implementação futura com Firebase
    return null;
};

export const getNearbyDrivers = async (lat, lng, radius = 5) => {
    // Implementação futura com Firebase
    return [];
};

export const startTripTracking = async (tripId, driverId, passengerId, initialLocation) => {
    // Implementação futura com Firebase
};

export const endTripTracking = async (tripId, endLocation) => {
    // Implementação futura com Firebase
};

export const getTripData = async (tripId) => {
    // Implementação futura com Firebase
    return null;
};

export const getUserTripHistory = async (userId, userType = 'passenger', limit = 50) => {
    // Implementação futura com Firebase
    return [];
};

export const getTripStatistics = async (userId, userType = 'passenger', period = 'month') => {
    // Implementação futura com Firebase
    return null;
};

export const persistTripData = async (tripId, tripData) => {
    // Implementação futura com Firebase
    return false;
};

export const storeAddresses = (data) => (dispatch) => {
    dispatch({
        type: STORE_ADRESSES,
        payload: data,
    });
};