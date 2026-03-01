import Logger from '../utils/Logger';
import {
  FETCH_BOOKINGS,
  FETCH_BOOKINGS_SUCCESS,
  FETCH_BOOKINGS_FAILED,
  UPDATE_BOOKING,
  CANCEL_BOOKING
} from "../types.js";
import { fetchBookingLocations } from '../actions/locationactions';
import { RequestPushMsg } from '../other/NotificationFunctions';
import store from '../store/store';
import { firebase } from './config/configureFirebase';
import { addActualsToBooking, saveAddresses, updateDriverQueue } from "../other/sharedFunctions";
import { getUserId } from '../utils/authUtils';


const waitForFirebaseInit = async () => {
  return new Promise((resolve) => {
    const checkFirebase = () => {
      if (firebase && firebase.database) {
        const db = firebase.database;
        if (db) {
          resolve(true);
        } else {
          setTimeout(checkFirebase, 100);
        }
      } else {
        setTimeout(checkFirebase, 100);
      }
    };
    checkFirebase();
  });
};

export const fetchBookings = () => async (dispatch, getState) => {
  Logger.log('=== LOG RASTREADOR fetchBookings (bookinglistactions) ===');
  try {
    dispatch({
      type: FETCH_BOOKINGS,
      payload: null,
    });

    await waitForFirebaseInit();
    Logger.log('fetchBookings - Firebase Database inicializado');

    const {
      bookingListRef,
      database
    } = firebase;

    const uid = await getUserId();
    if (!uid) {
      Logger.error('fetchBookings - UID não encontrado');
      dispatch({
        type: FETCH_BOOKINGS_FAILED,
        payload: 'Usuário não autenticado'
      });
      return;
    }

    const userInfo = getState().auth.profile;
    if (!userInfo || !userInfo.usertype) {
      Logger.error('fetchBookings - Tipo de usuário não encontrado');
      dispatch({
        type: FETCH_BOOKINGS_FAILED,
        payload: 'Tipo de usuário não encontrado'
      });
      return;
    }

    Logger.log('fetchBookings - Iniciando busca com:', { uid, usertype: userInfo.usertype });

    const bookingsRef = bookingListRef(uid, userInfo.usertype);

    firebase.database.ref(bookingsRef).off();

    const listener = firebase.database.ref(bookingsRef).on('value', (snapshot) => {
      if (snapshot.val()) {
        const data = snapshot.val();
        const active = [];
        let tracked = null;
        const bookings = Object.keys(data)
          .map((i) => {
            data[i].id = i;
            data[i].pickupAddress = data[i].pickup.add;
            data[i].dropAddress = data[i].drop.add;
            data[i].discount = data[i].discount
              ? data[i].discount
              : 0;
            data[i].cashPaymentAmount = data[i].cashPaymentAmount
              ? data[i].cashPaymentAmount
              : 0;
            data[i].cardPaymentAmount = data[i].cardPaymentAmount
              ? data[i].cardPaymentAmount
              : 0;
            return data[i];
          });
        for (let i = 0; i < bookings.length; i++) {
          if (['PAYMENT_PENDING','NEW', 'ACCEPTED', 'ARRIVED', 'STARTED', 'REACHED', 'PENDING', 'PAID'].indexOf(bookings[i].status) != -1) {
            active.push(bookings[i]);
          }
          if ((['ACCEPTED', 'ARRIVED', 'STARTED'].indexOf(bookings[i].status) != -1) && userInfo.usertype == 'driver') {
            tracked = bookings[i];
            dispatch(fetchBookingLocations(tracked.id));
          }
        }
        dispatch({
          type: FETCH_BOOKINGS_SUCCESS,
          payload: {
            bookings: bookings.reverse(),
            active: active,
            tracked: tracked
          },
        });
        if (tracked) {
          // Este dispatch parece redundante e pode causar problemas. Vamos removê-lo.
          // dispatch({
          //   type: FETCH_BOOKINGS_SUCCESS,
          //   payload: null
          // });
        }
      } else {
        dispatch({
          type: FETCH_BOOKINGS_FAILED,
          payload: store.getState().languagedata.defaultLanguage.no_bookings,
        });
      }
      // Não desligar o listener aqui, ele será desligado pela action.

    }, (error) => {
      Logger.error('fetchBookings - Erro ao buscar dados:', error);
      dispatch({
        type: FETCH_BOOKINGS_FAILED,
        payload: error.message || 'Erro ao buscar reservas'
      });
    });

    // Retornar o método de desligamento do listener para que possa ser usado fora da action
    return listener;

  } catch (error) {
    Logger.error('fetchBookings - Erro:', error);
    dispatch({
      type: FETCH_BOOKINGS_FAILED,
      payload: error.message || 'Erro ao buscar reservas'
    });
    // Em caso de erro, garantir que nenhum listener fique ativo
    const { bookingListRef, database } = firebase; // Recriar refs se necessário
     if (uid && userInfo && userInfo.usertype && database) {
         const bookingsRef = bookingListRef(uid, userInfo.usertype);
         firebase.database.ref(bookingsRef).off();
     }
  }
};

// Nova action para desligar o listener de bookings
export const unsubscribeBookings = () => (dispatch, getState) => {
    const state = getState();
    const listener = state.bookinglistdata.listener; // Assumindo que o listener é salvo no estado
    if (listener && typeof listener === 'function') {
        Logger.log('Desligando listener de bookings');
        listener(); // Chama a função retornada por onValue para desligar o listener
    } else {
        Logger.warn('Nenhum listener de bookings ativo para desligar');
    }
    // Remover listener do estado Redux, se aplicável
    // dispatch({ type: 'CLEAR_BOOKINGS_LISTENER' }); // Necessário adicionar este tipo de action/reducer
};

export const updateBooking = (booking) => async (dispatch) => {

  const {
    auth,
    trackingRef,
    singleBookingRef,
    singleUserRef,
    walletHistoryRef,
    settingsRef,
    userRatingsRef
  } = firebase;

  dispatch({
    type: UPDATE_BOOKING,
    payload: booking,
  });

  const settingsdata = await firebase.database.ref(settingsRef).once('value');
  const settings = settingsdata.val();
  
  if (booking.status == 'PAYMENT_PENDING') {
    firebase.database.ref(singleBookingRef(booking.id)).set(booking);
  }
  if (booking.status == 'NEW' || booking.status == 'ACCEPTED') {
    firebase.database.ref(singleBookingRef(booking.id)).set(updateDriverQueue(booking));
  }
  if (booking.status == 'ARRIVED') {
    let dt = new Date();
    booking.driver_arrive_time = dt.getTime().toString();
    firebase.database.ref(singleBookingRef(booking.id)).set(booking);
    if(booking.customer_token){
      RequestPushMsg(
        booking.customer_token,
        {
            title: store.getState().languagedata.defaultLanguage.notification_title,
            msg: store.getState().languagedata.defaultLanguage.driver_near,
            screen: 'BookedCab',
            params: { bookingId: booking.id }
        });
    }
  }
  
  if (booking.status == 'STARTED') {
    let dt = new Date();
    let localString = dt.getHours() + ":" + dt.getMinutes() + ":" + dt.getSeconds();
    let timeString = dt.getTime();
    booking.trip_start_time = localString;
    booking.startTime = timeString;
    firebase.database.ref(singleBookingRef(booking.id)).set(booking);

    const driverLocation = store.getState().gpsdata.location;
    
    firebase.database.ref(trackingRef(booking.id)).push({
      at: new Date().getTime(),
      status: 'STARTED',
      lat: driverLocation.lat,
      lng: driverLocation.lng
    });

    if(booking.customer_token){
      RequestPushMsg(
        booking.customer_token,
        {
            title: store.getState().languagedata.defaultLanguage.notification_title,
            msg: store.getState().languagedata.defaultLanguage.driver_journey_msg + booking.reference,
            screen: 'BookedCab',
            params: { bookingId: booking.id }
        });
      }
   }

  if (booking.status == 'REACHED') {

    const driverLocation = store.getState().gpsdata.location;

    firebase.database.ref(trackingRef(booking.id)).push({
      at: new Date().getTime(),
      status: 'REACHED',
      lat: driverLocation.lat,
      lng: driverLocation.lng
    });

    let address = await saveAddresses(booking,driverLocation);

    let bookingObj = await addActualsToBooking(booking, address, driverLocation);
    firebase.database.ref(singleBookingRef(booking.id)).set(bookingObj);

    if(booking.customer_token){
      RequestPushMsg(
        booking.customer_token,
        {
            title: store.getState().languagedata.defaultLanguage.notification_title,
            msg: store.getState().languagedata.defaultLanguage.driver_completed_ride,
            screen: 'BookedCab',
            params: { bookingId: booking.id }
        });
    }
  }

  if (booking.status == 'PENDING') {
    firebase.database.ref(singleBookingRef(booking.id)).set(booking);
    firebase.database.ref(singleUserRef(booking.driver)).set({ queue: false });
  }
  if (booking.status == 'PAID') {
    if(booking.booking_from_web){
      booking.status = 'COMPLETE';
    }
    firebase.database.ref(singleBookingRef(booking.id)).set(booking);
    if(booking.driver == auth.currentUser.uid && (booking.prepaid || booking.payment_mode == 'cash' || booking.payment_mode == 'wallet')){
      firebase.database.ref(singleUserRef(booking.driver)).set({ queue: false });
    }

    if(booking.customer_token){
      RequestPushMsg(
        booking.customer_token,
        {
            title: store.getState().languagedata.defaultLanguage.notification_title,
            msg: store.getState().languagedata.defaultLanguage.success_payment,
            screen: 'BookedCab',
            params: { bookingId: booking.id }
        });
    }

    if(booking.driver_token){
        RequestPushMsg(
          booking.driver_token,
          {
              title: store.getState().languagedata.defaultLanguage.notification_title,
              msg: store.getState().languagedata.defaultLanguage.success_payment,
              screen: 'BookedCab',
              params: { bookingId: booking.id }
          });
      }
    }

  if (booking.status == 'COMPLETE') {
    firebase.database.ref(singleBookingRef(booking.id)).set(booking);
    if (booking.rating) {
      if(booking.driver_token){
        RequestPushMsg(
          booking.driver_token,
          {
              title: store.getState().languagedata.defaultLanguage.notification_title,
              msg:  store.getState().languagedata.defaultLanguage.received_rating.toString().replace("X", booking.rating.toString()),
              screen: 'BookedCab',
              params: { bookingId: booking.id }
          });
      }
      firebase.database.ref(userRatingsRef(booking.driver)).once('value').then((snapshot) => {
        let ratings = snapshot.val();
        let rating;
        if(ratings){
          let sum = 0;
          const arr = Object.values(ratings);
          for (let i = 0; i< arr.length ; i++){
            sum = sum + arr[i].rate
          }
          sum = sum + booking.rating;
          rating = parseFloat(sum / (arr.length + 1)).toFixed(1);
        }else{
          rating =  booking.rating;
        }
        firebase.database.ref(singleUserRef(booking.driver)).set({rating: rating});
        firebase.database.ref(userRatingsRef(booking.driver)).push({
          user: booking.customer,
          rate: booking.rating,
          bookingId: booking.id
        });
      });
    }
  }
};

export const cancelBooking = (data) => (dispatch) => {
  const {
    singleBookingRef,
    singleUserRef,
    requestedDriversRef
  } = firebase;

  dispatch({
    type: CANCEL_BOOKING,
    payload: data,
  });

  firebase.database.ref(singleBookingRef(data.booking.id)).set({
    status: 'CANCELLED',
    reason: data.reason,
    cancelledBy: data.cancelledBy
  }).then(() => {
    if (data.booking.driver && (data.booking.status === 'NEW' || data.booking.status === 'ACCEPTED' || data.booking.status === 'ARRIVED')) {
      firebase.database.ref(singleUserRef(data.booking.driver)).set({ queue: false });
      if(data.booking.driver_token){
        RequestPushMsg(
          data.booking.driver_token,
          {
              title: store.getState().languagedata.defaultLanguage.notification_title,
              msg:  store.getState().languagedata.defaultLanguage.booking_cancelled + data.booking.id,
              screen: 'BookedCab',
              params: { bookingId: data.booking.id }
          });
        }

        if(data.booking.customer_token){
          RequestPushMsg(
            data.booking.customer_token,
            {
                title: store.getState().languagedata.defaultLanguage.notification_title,
                msg:  store.getState().languagedata.defaultLanguage.booking_cancelled + data.booking.id,
                screen: 'BookedCab',
                params: { bookingId: data.booking.id }
            });
        }
   }
    if (data.booking.status === 'NEW') {
      firebase.database.ref(requestedDriversRef(data.booking.id)).remove();
    }
  });
};

export const updateBookingImage = (booking, imageType, imageBlob) => (dispatch) => {
  const   {
    singleBookingRef,
    bookingImageRef
  } = firebase;
  firebase.storage().ref(bookingImageRef(booking.id,imageType)).put(imageBlob).then(() => {
    imageBlob.close()
    return firebase.storage().ref(bookingImageRef(booking.id,imageType)).getDownloadURL()
  }).then((url) => {
    if(imageType == 'pickup_image'){
      booking.pickup_image = url;
    }
    if(imageType == 'deliver_image'){
      booking.deliver_image = url;
    }
    firebase.database.ref(singleBookingRef(booking.id)).set(booking);
    dispatch({
      type: UPDATE_BOOKING,
      payload: booking,
    });
  })
};

export const forceEndBooking = (booking) => async (dispatch) => {

  const {
    trackingRef,
    singleBookingRef,
    singleUserRef,
    walletHistoryRef,
    settingsRef,
  } = firebase;

  dispatch({
    type: UPDATE_BOOKING,
    payload: booking,
  });
  
  if (booking.status == 'STARTED') {

    firebase.database.ref(trackingRef(booking.id)).push({
      at: new Date().getTime(),
      status: 'REACHED',
      lat: booking.drop.lat,
      lng: booking.drop.lng
    });

    const end_time = new Date();
    const diff = (end_time.getTime() - parseFloat(booking.startTime)) / 1000;
    const totalTimeTaken = Math.abs(Math.round(diff));
    booking.trip_end_time = end_time.getHours() + ":" + end_time.getMinutes() + ":" + end_time.getSeconds();
    booking.endTime = end_time.getTime();
    booking.total_trip_time = totalTimeTaken;

    if(booking.customer_token){
      RequestPushMsg(
        booking.customer_token,
        {
            title: store.getState().languagedata.defaultLanguage.notification_title,
            msg: store.getState().languagedata.defaultLanguage.driver_completed_ride,
            screen: 'BookedCab',
            params: { bookingId: booking.id }
        });
    }

    firebase.database.ref(singleUserRef(booking.driver)).set({ queue: false });

    if(booking.prepaid){

      const settingsdata = await firebase.database.ref(settingsRef).once('value');
      const settings = settingsdata.val();

      firebase.database.ref(singleUserRef(booking.driver)).once('value').then((snapshot) => {
        let walletBalance = parseFloat(snapshot.val().walletBalance);
        walletBalance = walletBalance + parseFloat(booking.driver_share);
        if(parseFloat(booking.cashPaymentAmount)>0){
          walletBalance = walletBalance - parseFloat(booking.cashPaymentAmount);
        }
        firebase.database.ref(singleUserRef(booking.driver)).set({"walletBalance": parseFloat(walletBalance.toFixed(settings.decimal))});

        let details = {
          type: 'Credit',
          amount: parseFloat(booking.driver_share).toFixed(settings.decimal),
          date: new Date().getTime(),
          txRef: booking.id
        }
        firebase.database.ref(walletHistoryRef(booking.driver)).push(details);
        
        if(parseFloat(booking.cashPaymentAmount)>0){
          let details = {
            type: 'Debit',
            amount: booking.cashPaymentAmount,
            date: new Date().getTime(),
            txRef: booking.id
          }
          firebase.database.ref(walletHistoryRef(booking.driver)).push(details);
        }  
      });

      if(booking.customer_token){
        RequestPushMsg(
          booking.customer_token,
          {
              title: store.getState().languagedata.defaultLanguage.notification_title,
              msg: store.getState().languagedata.defaultLanguage.success_payment,
              screen: 'BookedCab',
              params: { bookingId: booking.id }
          });
      }

      if(booking.driver_token){
        RequestPushMsg(
          booking.driver_token,
          {
              title: store.getState().languagedata.defaultLanguage.notification_title,
              msg: store.getState().languagedata.defaultLanguage.success_payment,
              screen: 'BookedCab',
              params: { bookingId: booking.id }
          });
        }
      booking.status = 'PAID';
    } else{
      booking.status = 'PENDING';
    }

    firebase.database.ref(singleBookingRef(booking.id)).set(booking);
  }
};