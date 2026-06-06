import Logger from '../../utils/Logger';
import store from '../../state/appStore';
import { firebase } from './firebaseConfig';
import { RequestPushMsg } from './pushNotificationFunction';
import { fetchAddressfromCoords } from './googleApiFunctions';
import { GetDistance } from './locationService';

const UPDATE_BOOKING = 'UPDATE_BOOKING';

const updateDriverQueue = (booking) => booking;

const calculateDriverShare = (tripCost, tollFee = 0, decimalPrecision = 2) => {
  const grandTotal = parseFloat(tripCost) || 0;
  const pTollFee = parseFloat(tollFee) || 0;
  const rawFare = grandTotal - pTollFee;
  let opFee = 0;

  if (rawFare <= 10.00) opFee = 0.79;
  else if (rawFare <= 25.00) opFee = 0.99;
  else if (rawFare <= 50.00) opFee = 1.49;
  else opFee = rawFare * 0.03;

  let wooviFee = grandTotal * 0.008;
  if (wooviFee < 0.50) wooviFee = 0.50;

  return (grandTotal - opFee - wooviFee).toFixed(decimalPrecision);
};

const getTripDistance = async (trackingVal) => {
  if (!trackingVal) {
    return { distance: 0, coords: [] };
  }

  const arr = Object.keys(trackingVal)
    .filter((key) => trackingVal[key].status === 'STARTED' || trackingVal[key].status === 'REACHED')
    .map((key) => ({ id: key, ...trackingVal[key] }));

  if (arr.length < 2) {
    return { distance: 0, coords: [] };
  }

  let distance = 0;
  const coords = [];
  for (let i = 0; i < arr.length - 1; i += 1) {
    distance += GetDistance(arr[i].lat, arr[i].lng, arr[i + 1].lat, arr[i + 1].lng);
    coords.push({ latitude: arr[i].lat, longitude: arr[i].lng });
  }
  coords.push({ latitude: arr[arr.length - 1].lat, longitude: arr[arr.length - 1].lng });

  return { distance, coords };
};

const calculateFareForActuals = (distance, totalTimeTaken, rateDetails, decimalPrecision) => {
  const baseFare = parseFloat(rateDetails?.base_fare) || 0;
  const fixedFee = parseFloat(rateDetails?.fixed_fee) || 0;
  const minFare = parseFloat(rateDetails?.min_fare) || 0;
  const ratePerKm = parseFloat(rateDetails?.rate_per_unit_distance) || 0;
  const ratePerHour = parseFloat(rateDetails?.rate_per_hour) || 0;
  const distanceFare = distance * ratePerKm;
  const timeFare = (totalTimeTaken / 3600) * ratePerHour;
  const subTotal = Math.max(baseFare + distanceFare + timeFare + fixedFee, minFare);

  return {
    grandTotal: Number(subTotal.toFixed(decimalPrecision)),
    convenience_fees: 0,
  };
};

const saveAddresses = async (booking, driverLocation) => {
  const { singleUserRef } = firebase;
  const latlng = `${driverLocation.lat},${driverLocation.lng}`;
  const address = await fetchAddressfromCoords(latlng);
  const savedRef = singleUserRef(booking.customer).child('savedAddresses');
  const savedSnap = await savedRef.once('value');
  const addresses = savedSnap.val();

  if (addresses) {
    let didNotMatch = true;
    for (const key of Object.keys(addresses)) {
      const entry = addresses[key];
      if (GetDistance(entry.lat, entry.lng, driverLocation.lat, driverLocation.lng) < 0.1) {
        didNotMatch = false;
        await savedRef.child(key).update({ count: entry.count ? entry.count + 1 : 1 });
        break;
      }
    }
    if (!didNotMatch) {
      return address;
    }
  }

  await savedRef.push({
    description: address,
    lat: booking.drop.lat,
    lng: booking.drop.lng,
    count: 1,
  });
  return address;
};

const addActualsToBooking = async (booking, address, driverLocation) => {
  const { settingsRef, trackingRef } = firebase;
  const settingsdata = await settingsRef.once('value');
  const settings = settingsdata.val();
  const endTime = new Date();
  const totalTimeTaken = Math.abs(Math.round((endTime.getTime() - parseFloat(booking.startTime)) / 1000));

  booking.trip_end_time = `${endTime.getHours()}:${endTime.getMinutes()}:${endTime.getSeconds()}`;
  booking.endTime = endTime.getTime();
  booking.total_trip_time = totalTimeTaken;

  if (!settings.prepaid) {
    const cars = store.getState().cartypes.cars;
    let rates = {};
    for (let i = 0; i < cars.length; i += 1) {
      if (cars[i].name === booking.carType) {
        rates = cars[i];
      }
    }

    const trackingSnap = await trackingRef(booking.id).once('value');
    const res = await getTripDistance(trackingSnap.val());
    const distance = settings.convert_to_mile ? res.distance / 1.609344 : res.distance;
    const { grandTotal, convenience_fees } = calculateFareForActuals(
      distance,
      totalTimeTaken,
      rates,
      settings.decimal
    );

    booking.drop = {
      add: address,
      lat: driverLocation.lat,
      lng: driverLocation.lng,
    };
    booking.dropAddress = address;
    booking.trip_cost = grandTotal;
    booking.distance = parseFloat(distance).toFixed(settings.decimal);
    booking.convenience_fees = convenience_fees;
    booking.coords = res.coords;

    const fleetCommissionFee = booking?.fleetadmin
      ? ((parseFloat(booking?.trip_cost) - parseFloat(booking?.convenience_fees)) *
        parseFloat(booking?.fleet_admin_comission) / 100).toFixed(2)
      : 0;

    booking.fleetCommission = fleetCommissionFee ? fleetCommissionFee : '0';
    booking.driver_share = calculateDriverShare(booking.trip_cost, booking.tollFee || 0, settings.decimal);
  }

  return booking;
};

const notifyCustomer = (booking, msg) => {
  if (!booking.customer_token) return;
  RequestPushMsg(booking.customer_token, {
    title: store.getState().languagedata.defaultLanguage.notification_title,
    msg,
    screen: 'BookedCab',
    params: { bookingId: booking.id },
  });
};

const notifyDriver = (booking, msg) => {
  if (!booking.driver_token) return;
  RequestPushMsg(booking.driver_token, {
    title: store.getState().languagedata.defaultLanguage.notification_title,
    msg,
    screen: 'BookedCab',
    params: { bookingId: booking.id },
  });
};

export const updateBooking = (booking) => async (dispatch) => {
  const {
    auth,
    trackingRef,
    singleBookingRef,
    singleUserRef,
    userRatingsRef,
  } = firebase;

  dispatch({
    type: UPDATE_BOOKING,
    payload: booking,
  });

  const language = store.getState().languagedata.defaultLanguage;
  const bookingRef = singleBookingRef(booking.id);

  if (booking.status === 'PAYMENT_PENDING') {
    await bookingRef.set(booking);
  }
  if (booking.status === 'NEW' || booking.status === 'ACCEPTED') {
    await bookingRef.set(updateDriverQueue(booking));
  }
  if (booking.status === 'ARRIVED') {
    const dt = new Date();
    booking.driver_arrive_time = dt.getTime().toString();
    await bookingRef.set(booking);
    notifyCustomer(booking, language.driver_near);
  }
  if (booking.status === 'STARTED') {
    const dt = new Date();
    booking.trip_start_time = `${dt.getHours()}:${dt.getMinutes()}:${dt.getSeconds()}`;
    booking.startTime = dt.getTime();
    await bookingRef.set(booking);

    const driverLocation = store.getState().gpsdata.location;
    await trackingRef(booking.id).push({
      at: new Date().getTime(),
      status: 'STARTED',
      lat: driverLocation.lat,
      lng: driverLocation.lng,
    });

    notifyCustomer(booking, language.driver_journey_msg + booking.reference);
  }
  if (booking.status === 'REACHED') {
    const driverLocation = store.getState().gpsdata.location;
    await trackingRef(booking.id).push({
      at: new Date().getTime(),
      status: 'REACHED',
      lat: driverLocation.lat,
      lng: driverLocation.lng,
    });

    const address = await saveAddresses(booking, driverLocation);
    const bookingObj = await addActualsToBooking(booking, address, driverLocation);
    await bookingRef.set(bookingObj);
    notifyCustomer(booking, language.driver_completed_ride);
  }
  if (booking.status === 'PENDING') {
    await bookingRef.set(booking);
    await singleUserRef(booking.driver).set({ queue: false });
  }
  if (booking.status === 'PAID') {
    if (booking.booking_from_web) {
      booking.status = 'COMPLETE';
    }
    await bookingRef.set(booking);
    if (booking.driver === auth.currentUser.uid && (booking.prepaid || booking.payment_mode === 'cash' || booking.payment_mode === 'wallet')) {
      await singleUserRef(booking.driver).set({ queue: false });
    }
    notifyCustomer(booking, language.success_payment);
    notifyDriver(booking, language.success_payment);
  }
  if (booking.status === 'COMPLETE') {
    await bookingRef.set(booking);
    if (booking.rating) {
      notifyDriver(booking, language.received_rating.toString().replace('X', booking.rating.toString()));
      userRatingsRef(booking.driver).once('value').then((snapshot) => {
        const ratings = snapshot.val();
        let rating;
        if (ratings) {
          let sum = 0;
          const arr = Object.values(ratings);
          for (let i = 0; i < arr.length; i += 1) {
            sum += arr[i].rate;
          }
          sum += booking.rating;
          rating = parseFloat(sum / (arr.length + 1)).toFixed(1);
        } else {
          rating = booking.rating;
        }
        singleUserRef(booking.driver).set({ rating });
        userRatingsRef(booking.driver).push({
          user: booking.customer,
          rate: booking.rating,
          bookingId: booking.id,
        });
      }).catch((error) => {
        Logger.error(error);
      });
    }
  }
};
