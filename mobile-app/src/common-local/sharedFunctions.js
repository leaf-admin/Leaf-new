import { firebase } from "./config/configureFirebase";
import { FareCalculator } from "./other/FareCalculator";
import { GetDistance, GetTripDistance } from "./other/GeoFunctions";
import { fetchAddressfromCoords, fetchPlacesAutocomplete, fetchCoordsfromPlace } from './other/OSMAPIFunctions';
import store from './store/store';

// Constantes
export const MAIN_COLOR = '#41D274';

export const formatBookingObject = async (bookingData, settings) => {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const reference = [...Array(6)].map(_ => c[~~(Math.random() * c.length)]).join('');
  const { config } = firebase;

  // Fallback para config se não estiver disponível
  const safeConfig = config || {
    projectId: "leaf-reactnative",
    appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
    databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
    storageBucket: "leaf-reactnative.firebasestorage.app",
    apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
    authDomain: "leaf-reactnative.firebaseapp.com",
    messagingSenderId: "106504629884",
    measurementId: "G-22368DBCY9"
  };

  let today;
  try {
    let res = await fetch(`https://${safeConfig.projectId}.web.app/getservertime`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    const json = await res.json();
    if (json.time) {
      today = json.time;
    } else {
      today = new Date().getTime();
    }
  } catch (err) {
    today = new Date().getTime();
  }

  let pickUp = { lat: bookingData.pickup.coords.lat, lng: bookingData.pickup.coords.lng, add: bookingData.pickup.description };
  let drop = { lat: bookingData.drop.coords.lat, lng: bookingData.drop.coords.lng, add: bookingData.drop.description };

  let coords = [{ latitude: pickUp.lat, longitude: pickUp.lng }];
  if (bookingData.drop.waypointsStr) {
    bookingData.drop.waypointsStr.split("|").forEach((point) => {
      let lat = point.split(',')[0];
      let lng = point.split(',')[1];
      coords.push({ latitude: parseFloat(lat), longitude: parseFloat(lng) });
    });
  }
  coords.push({ latitude: drop.lat, longitude: drop.lng });

  var otp;
  if (bookingData.settings.otp_secure)
    otp = Math.floor(Math.random() * 90000) + 10000;
  else {
    otp = false;
  }

  return {
    carType: bookingData.carDetails.name,
    carImage: bookingData.carDetails.image,
    customer: bookingData.userDetails.uid,
    commission_type: bookingData.carDetails.convenience_fee_type,
    commission_rate: bookingData.carDetails.convenience_fees,
    reference: reference,
    customer_email: bookingData.userDetails.email,
    customer_name: bookingData.userDetails.firstName + ' ' + bookingData.userDetails.lastName,
    customer_contact: bookingData.userDetails.mobile ? bookingData.userDetails.mobile : ' ',
    customer_token: bookingData.userDetails.pushToken ? bookingData.userDetails.pushToken : ' ',
    customer_image: bookingData.userDetails.profile_image ? bookingData.userDetails.profile_image : "",
    drop: drop,
    pickup: pickUp,
    estimate: bookingData.estimate.estimateFare,
    estimateDistance: bookingData.estimate.estimateDistance,
    distance: bookingData.estimate.estimateDistance,
    estimateTime: bookingData.estimate.estimateTime,
    status: bookingData.booking_type_admin || !settings.prepaid || bookingData.booking_type_fleetadmin ? "NEW" : "PAYMENT_PENDING",
    bookLater: bookingData.bookLater,
    tripdate: bookingData.bookLater ? bookingData.tripdate : today,
    bookingDate: today,
    otp: otp,
    booking_type_admin: bookingData.booking_type_admin,
    coords: coords,
    waypoints: bookingData.drop.waypoints ? bookingData.drop.waypoints : null,
    roundTrip: bookingData.roundTrip ? bookingData.roundTrip : null,
    tripInstructions: bookingData.tripInstructions ? bookingData.tripInstructions : null,
    trip_cost: bookingData.estimate.estimateFare,
    convenience_fees: bookingData.estimate.convenience_fees,
    // Novo cálculo: Valor para o motorista = Tarifa total - Custo operacional fixo (R$ 1,55)
    // Pedágios serão pagos diretamente pelo motorista, não são descontados do valor
    driver_share: (parseFloat(bookingData.estimate.estimateFare) - 1.55).toFixed(settings.decimal),
    fleet_admin_comission: bookingData.carDetails.fleet_admin_fee ? bookingData.carDetails.fleet_admin_fee : null,
    paymentPacket: bookingData.paymentPacket ? bookingData.paymentPacket : null,
    preRequestedDrivers: bookingData.preRequestedDrivers ? bookingData.preRequestedDrivers : null,
    requestedDrivers: bookingData.requestedDrivers ? bookingData.requestedDrivers : null,
    driverEstimates: bookingData.driverEstimates ? bookingData.driverEstimates : null,
    ...bookingData.instructionData,
    fleetadmin: bookingData.fleetadmin ? bookingData.fleetadmin : null,
    payment_mode: bookingData.payment_mode,
    booking_from_web: bookingData.booking_from_web ? bookingData.booking_from_web : false,
    booking_type_fleetadmin: bookingData.booking_type_fleetadmin
  }
}

export const saveAddresses = async (booking, driverLocation) => {
  const { singleUserRef } = firebase;
  let latlng = driverLocation.lat + "," + driverLocation.lng;
  let address = await fetchAddressfromCoords(latlng);
  onValue(child(singleUserRef(booking.customer), "savedAddresses"), (savedAdd) => {
    if (savedAdd.val()) {
      let addresses = savedAdd.val();
      let didNotMatch = true;
      for (let key in addresses) {
        let entry = addresses[key];
        if (
          GetDistance(
            entry.lat,
            entry.lng,
            driverLocation.lat,
            driverLocation.lng
          ) < 0.1
        ) {
          didNotMatch = false;
          let count = entry.count ? entry.count + 1 : 1;
          update(child(singleUserRef(booking.customer), "savedAddresses/" + key), { count: count });
          break;
        }
      }
      if (didNotMatch) {
        push(child(singleUserRef(booking.customer), "savedAddresses"), {
          description: address,
          lat: booking.drop.lat,
          lng: booking.drop.lng,
          count: 1,
        });
      }
    } else {
      push(child(singleUserRef(booking.customer), "savedAddresses"), {
        description: address,
        lat: booking.drop.lat,
        lng: booking.drop.lng,
        count: 1,
      });
    }
  }, { onlyOnce: true });
  return address;
};

export const addActualsToBooking = async (booking, address, driverLocation) => {
  const { settingsRef, trackingRef } = firebase;
  const settingsdata = await get(settingsRef);
  const settings = settingsdata.val();
  const end_time = new Date();
  const diff = (end_time.getTime() - parseFloat(booking.startTime)) / 1000;
  const totalTimeTaken = Math.abs(Math.round(diff));
  if (settings.prepaid) {
    booking.trip_end_time = end_time.getHours() + ":" + end_time.getMinutes() + ":" + end_time.getSeconds();
    booking.endTime = end_time.getTime();
    booking.total_trip_time = totalTimeTaken;
  } else {
    booking.trip_end_time = end_time.getHours() + ":" + end_time.getMinutes() + ":" + end_time.getSeconds();
    booking.endTime = end_time.getTime();
    booking.total_trip_time = totalTimeTaken;
    let cars = store.getState().cartypes.cars;
    let rates = {};
    for (var i = 0; i < cars.length; i++) {
      if (cars[i].name == booking.carType) {
        rates = cars[i];
      }
    }
    const trackingSnap = await get(query(trackingRef(booking.id), orderByKey()));
    const trackingVal = trackingSnap.val();
    const res = await GetTripDistance(trackingVal);
    const distance = settings.convert_to_mile
      ? res.distance / 1.609344
      : res.distance;
    const { grandTotal, convenience_fees } = FareCalculator(
      distance,
      totalTimeTaken,
      rates,
      null,
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

    let fleetCommission_fee = booking?.fleetadmin
      ? ((parseFloat(booking?.trip_cost) - parseFloat(booking?.convenience_fees))
        * parseFloat(booking?.fleet_admin_comission) / 100).toFixed(2)
      : 0;
    // Novo cálculo: Valor para o motorista = Tarifa total - Custo operacional fixo (R$ 1,55)
    // Pedágios serão pagos diretamente pelo motorista, não são descontados do valor
    let driver_fee = parseFloat(parseFloat(booking?.trip_cost) - 1.55).toFixed(2);
    booking.fleetCommission = fleetCommission_fee ? fleetCommission_fee : "0";
    booking.driver_share = driver_fee ? driver_fee : "0";

  }
  return booking;
};

export const updateDriverQueue = (booking) => {
  return booking;
};

export const driverQueue = false;

// Função utilitária para gerar código de indicação/referralId
export function generateReferralId() {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return [...Array(6)].map(_ => c[~~(Math.random() * c.length)]).join('');
}

// Função para preparar objeto de estimativa
export const prepareEstimateObject = (estimateData, carType) => {
  return {
    estimateFare: estimateData.estimateFare || '0.00',
    estimateDistance: estimateData.estimateDistance || '0.0',
    estimateTime: estimateData.estimateTime || '0',
    carType: carType || 'standard',
    convenience_fees: estimateData.convenience_fees || '0.00',
    totalFare: estimateData.totalFare || estimateData.estimateFare || '0.00'
  };
};