import Logger from '../../utils/Logger';
import {
    CONFIRM_BOOKING,
    CONFIRM_BOOKING_SUCCESS,
    CONFIRM_BOOKING_FAILED,
    CLEAR_BOOKING
} from "../types.js";
import { RequestPushMsg } from '../other/NotificationFunctions';
import store from '../store';
import { firebase } from '../config/configureFirebase';
import { formatBookingObject } from '../other/sharedFunctions';
import { Alert } from 'react-native';
import { get } from '@react-native-firebase/database';
import { getSelfHostedApiUrl } from '../../config/ApiConfig';

export const clearBooking = () => (dispatch) => {
    dispatch({
        type: CLEAR_BOOKING,
        payload: null,
    });
}

export const setBooking = (booking) => (dispatch) => {
    dispatch({
        type: 'SET_BOOKING',
        payload: booking
    });
};

export const updateBooking = (booking) => (dispatch) => {
    dispatch({
        type: 'UPDATE_BOOKING',
        payload: booking
    });
};

export const fetchBooking = (bookingId) => (dispatch) => {
    const { database } = firebase;
    const bookingRef = database.ref(`bookings/${bookingId}`);

    bookingRef.on('value', (snapshot) => {
        if (snapshot.exists()) {
            const booking = formatBookingObject(snapshot.val());
            dispatch({
                type: 'SET_BOOKING',
                payload: booking
            });
        }
    });

    return () => bookingRef.off();
};

export const createBooking = (bookingData) => async (dispatch) => {
    try {
        const { database } = firebase;
        const newBookingRef = database.ref('bookings').push();
        const bookingId = newBookingRef.key;

        const booking = {
            ...bookingData,
            id: bookingId,
            status: 'NEW',
            createdAt: Date.now()
        };

        await newBookingRef.set(booking);

        dispatch({
            type: 'SET_BOOKING',
            payload: booking
        });

        return booking;
    } catch (error) {
        Logger.error('Error creating booking:', error);
        throw error;
    }
};

export const addBooking = (bookingData) => async (dispatch) => {

    const {
        bookingRef,
        settingsRef,
        singleUserRef
    } = firebase;

    dispatch({
        type: CONFIRM_BOOKING,
        payload: bookingData,
    });

    const settingsdata = await get(settingsRef);
    const settings = settingsdata.val();

    let data = await formatBookingObject(bookingData, settings);

    if (bookingData.requestedDrivers) {
        const drivers = bookingData.requestedDrivers;
        Object.keys(drivers).map((uid) => {
            onValue(singleUserRef(uid), snapshot => {
                if (snapshot.val()) {
                    const pushToken = snapshot.val().pushToken;
                    const ios = snapshot.val().userPlatform == "IOS" ? true : false
                    if (pushToken) {
                        RequestPushMsg(
                            pushToken,
                            {
                                title: store.getState().languagedata.defaultLanguage.notification_title,
                                msg: store.getState().languagedata.defaultLanguage.new_booking_notification,
                                screen: 'DriverTrips'
                            });
                    }
                }
            }, { onlyOnce: true });
            return drivers[uid];
        })
    }

    try {
        const geofenceUrl = getSelfHostedApiUrl(`/api/geofence/check?lat=${bookingData.pickup.lat}&lng=${bookingData.pickup.lng}`);
        const geofenceResponse = await fetch(geofenceUrl);
        const geofenceData = await geofenceResponse.json();
        if (!geofenceData.success || !geofenceData.isAllowed) {
            dispatch({
                type: CONFIRM_BOOKING_FAILED,
                payload: geofenceData.reason || "A Leaf ainda não opera nesta região.",
            });
            return; // Stop execution, do not push to Firebase
        }
    } catch (e) {
        Logger.warn("Geofence check failed, allowing ride to push...", e);
    }

    push(bookingRef, data).then((res) => {
        var bookingKey = res.key;
        dispatch({
            type: CONFIRM_BOOKING_SUCCESS,
            payload: {
                booking_id: bookingKey,
                mainData: {
                    ...data,
                    id: bookingKey
                }
            }
        });
    }).catch(error => {
        dispatch({
            type: CONFIRM_BOOKING_FAILED,
            payload: error.code + ": " + error.message,
        });
    });
};

