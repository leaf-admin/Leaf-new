import { firebase } from './config/configureFirebase';

export const api = {
    fetchBookings: () => async (dispatch) => {
        const { database } = firebase;
        const bookingsRef = database.ref('bookings');
        
        bookingsRef.on('value', (snapshot) => {
            const bookings = [];
            snapshot.forEach((child) => {
                bookings.push({
                    id: child.key,
                    ...child.val()
                });
            });
            
            dispatch({
                type: 'SET_BOOKINGS',
                payload: bookings
            });
        });

        return () => bookingsRef.off();
    },

    fetchUserCancelReasons: () => async (dispatch) => {
        const { database } = firebase;
        const reasonsRef = database.ref('cancel_reason');
        
        reasonsRef.on('value', (snapshot) => {
            const reasons = [];
            snapshot.forEach((child) => {
                reasons.push({
                    id: child.key,
                    ...child.val()
                });
            });
            
            dispatch({
                type: 'SET_CANCEL_REASONS',
                payload: reasons
            });
        });

        return () => reasonsRef.off();
    },

    fetchUserPromos: () => async (dispatch) => {
        const { database } = firebase;
        const promosRef = database.ref('promos');
        
        promosRef.on('value', (snapshot) => {
            const promos = [];
            snapshot.forEach((child) => {
                promos.push({
                    id: child.key,
                    ...child.val()
                });
            });
            
            dispatch({
                type: 'SET_PROMOS',
                payload: promos
            });
        });

        return () => promosRef.off();
    }
}; 