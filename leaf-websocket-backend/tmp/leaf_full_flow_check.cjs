const WebSocketTestClient = require('../tests/e2e/backend/__helpers__/websocket-test-client');

function sleep(ms){ return new Promise((resolve)=>setTimeout(resolve, ms)); }
function normalizeId(payload){ return payload?.bookingId || payload?.rideId || payload?.tripId || null; }
function countForBooking(client, eventName, bookingId){
  return (client.getEvents(eventName) || []).filter((entry)=> normalizeId(entry.data) === bookingId).length;
}
function httpBase(url){
  if (url.startsWith('ws://')) return `http://${url.replace(/^ws:\/\//, '')}`;
  if (url.startsWith('wss://')) return `https://${url.replace(/^wss:\/\//, '')}`;
  return url;
}
async function waitDriverReady(baseUrl, driverId, timeoutMs = 50000){
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs){
    try {
      const response = await fetch(`${baseUrl}/api/driver-status/${driverId}`);
      if (!response.ok) throw new Error(`status_${response.status}`);
      const data = await response.json();
      const canReceive = data?.canReceiveRequests === true;
      const inGeo = data?.details?.isOnlineInRedis === true;
      if (canReceive && inGeo) return true;
    } catch (_error) {}
    await sleep(800);
  }
  return false;
}

(async()=>{
  const WS_URL = process.env.WS_URL || 'https://api.147.182.204.181.sslip.io';
  const PASSENGER_UID = process.env.TEST_PASSENGER_UID || 'iDiAKrLjeDWbIOYFEqkHLS3JBGN2';
  const DRIVER_UID = process.env.TEST_DRIVER_UID || '5zgeX92yleYa2wH8JnMvqOU76fX2';

  const pickup = { lat: -22.9075, lng: -43.1736, address: 'Centro - Rio de Janeiro' };
  const destination = { lat: -22.9121, lng: -43.1825, address: 'Lapa - Rio de Janeiro' };

  const driver = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  const passenger = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });

  let heartbeat = null;
  let bookingId = null;

  try {
    await driver.connect();
    await passenger.connect();

    await driver.authenticate(DRIVER_UID, 'driver');
    await passenger.authenticate(PASSENGER_UID, 'customer');

    const sendLocation = () => {
      driver.socket.emit('updateLocation', {
        lat: pickup.lat + 0.00025,
        lng: pickup.lng + 0.00025,
        tripStatus: 'idle',
        isInTrip: false,
        seq: Date.now() % 100000
      });
    };
    sendLocation();
    heartbeat = setInterval(sendLocation, 1200);

    const ready = await waitDriverReady(httpBase(WS_URL), DRIVER_UID, 50000);
    if (!ready) throw new Error('driver_not_ready');

    const booking = await passenger.createBooking({
      customerId: PASSENGER_UID,
      pickupLocation: pickup,
      destinationLocation: destination,
      estimatedFare: 27.5,
      paymentMethod: 'pix',
      paymentStatus: 'confirmed',
      paymentData: {
        chargeId: `charge_${Date.now()}`,
        rideId: `ride_${Date.now()}`,
        amountInCents: 2750
      },
      idempotencyKey: `flow_check_${Date.now()}`
    });

    bookingId = booking?.bookingId;
    if (!bookingId) throw new Error(`booking_id_missing:${JSON.stringify(booking)}`);

    await driver.waitForEvent('newRideRequest', 45000, (payload) => normalizeId(payload) === bookingId);

    await driver.acceptRide(bookingId);
    await passenger.waitForEvent('rideAccepted', 15000, (payload) => normalizeId(payload) === bookingId);

    await driver.startTrip({
      bookingId,
      startLocation: { lat: pickup.lat, lng: pickup.lng }
    });
    await passenger.waitForEvent('tripStarted', 15000, (payload) => normalizeId(payload) === bookingId);

    await driver.finishTrip({
      bookingId,
      endLocation: { lat: destination.lat, lng: destination.lng },
      fare: 27.5,
      distance: 6200,
      duration: 900,
      mockPayment: true,
      __mockPayment: true
    });
    await passenger.waitForEvent('tripCompleted', 20000, (payload) => normalizeId(payload) === bookingId);

    passenger.socket.emit('submitRating', {
      tripId: bookingId,
      customerId: PASSENGER_UID,
      driverId: DRIVER_UID,
      rating: 5,
      comment: 'ok'
    });

    const ratingResult = await Promise.race([
      passenger.waitForEvent('ratingSubmitted', 20000, (payload)=> payload?.tripId === bookingId),
      passenger.waitForEvent('ratingError', 20000, () => true).then((payload)=> ({ __error: payload }))
    ]);

    const output = {
      ok: !ratingResult?.__error,
      bookingId,
      ratingResult,
      eventCounts: {
        driver_newRideRequest: countForBooking(driver, 'newRideRequest', bookingId),
        passenger_rideAccepted: countForBooking(passenger, 'rideAccepted', bookingId),
        passenger_tripStarted: countForBooking(passenger, 'tripStarted', bookingId),
        passenger_tripCompleted: countForBooking(passenger, 'tripCompleted', bookingId),
        passenger_ratingSubmitted: countForBooking(passenger, 'ratingSubmitted', bookingId),
        passenger_ratingError: countForBooking(passenger, 'ratingError', bookingId)
      }
    };

    console.log(JSON.stringify(output, null, 2));
    if (ratingResult?.__error) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, bookingId, error: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    passenger.disconnect();
    driver.disconnect();
  }
})();
