#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const io = require('socket.io-client');

const SERVER_URL = process.env.BACKEND_URL || 'https://api.147.182.204.181.sslip.io';
const BASE_LAT = Number(process.env.QA_BASE_LAT || '37.779026');
const BASE_LNG = Number(process.env.QA_BASE_LNG || '-122.419906');
const RADIUS = Number(process.env.QA_COORD_RADIUS || '0.002');
const ESTIMATED_FARE = Number(process.env.QA_ESTIMATED_FARE || '27.5');
const DRIVER_EMAIL = process.env.QA_DRIVER_EMAIL || 'ana.teste@leaf.com';
const DRIVER_PASSWORD = process.env.QA_DRIVER_PASSWORD || 'teste123';

function randomPoint(lat, lng, radius = 0.0015) {
  return { lat: lat + (Math.random() - 0.5) * radius, lng: lng + (Math.random() - 0.5) * radius };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function interpolatePoints(start, end, steps = 8) {
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    const f = i / steps;
    out.push({ lat: start.lat + (end.lat - start.lat) * f, lng: start.lng + (end.lng - start.lng) * f });
  }
  return out;
}
function getFirebaseApiKey() {
  if (process.env.FIREBASE_API_KEY) return process.env.FIREBASE_API_KEY;
  if (process.env.EXPO_PUBLIC_FIREBASE_API_KEY) return process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  const files = [
    path.join('/Users/izaakdias/Documents/Leaf-new/mobile-app', 'google-services.json'),
    path.join('/Users/izaakdias/Documents/Leaf-new/mobile-app', 'google-services.example.json')
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const key = json?.client?.[0]?.api_key?.[0]?.current_key;
    if (key) return key;
  }
  throw new Error('firebase_api_key_missing');
}
async function signInWithPassword(email, password) {
  const apiKey = getFirebaseApiKey();
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const res = await axios.post(url, { email, password, returnSecureToken: true }, { timeout: 20000 });
  return { uid: res.data.localId, idToken: res.data.idToken, email };
}
function waitEvent(socket, okEvents, errEvents = [], timeoutMs = 60000, label = 'event') {
  const oks = Array.isArray(okEvents) ? okEvents : [okEvents];
  const errs = Array.isArray(errEvents) ? errEvents : [errEvents];
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error(`${label}_timeout`)); }, timeoutMs);
    const okHandlers = oks.map(evt => [evt, payload => { cleanup(); resolve({ event: evt, payload }); }]);
    const errHandlers = errs.filter(Boolean).map(evt => [evt, payload => { cleanup(); reject(new Error(`${label}_${evt}:${payload?.message || payload?.error || 'unknown'}`)); }]);
    function cleanup() {
      clearTimeout(t);
      for (const [evt, h] of okHandlers) socket.off(evt, h);
      for (const [evt, h] of errHandlers) socket.off(evt, h);
    }
    for (const [evt, h] of okHandlers) socket.once(evt, h);
    for (const [evt, h] of errHandlers) socket.once(evt, h);
  });
}
async function main() {
  console.log('driver_bot_start', JSON.stringify({ SERVER_URL, DRIVER_EMAIL, BASE_LAT, BASE_LNG }));
  const driver = await signInWithPassword(DRIVER_EMAIL, DRIVER_PASSWORD);
  console.log('signin_driver_ok', JSON.stringify({ uid: driver.uid }));
  const socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    timeout: 20000,
    reconnection: false,
    forceNew: true,
    auth: { token: driver.idToken }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect_timeout')), 25000);
    socket.on('connect', () => {
      socket.emit('authenticate', { uid: driver.uid, userType: 'driver', token: driver.idToken });
    });
    socket.on('authenticated', payload => { clearTimeout(timer); console.log('ws_driver_auth_ok', JSON.stringify(payload || {})); resolve(); });
    socket.on('auth_error', err => { clearTimeout(timer); reject(new Error(err?.message || err?.error || 'auth_error')); });
    socket.on('authentication_error', err => { clearTimeout(timer); reject(new Error(err?.message || err?.error || 'authentication_error')); });
    socket.on('connect_error', err => { clearTimeout(timer); reject(err); });
  });
  const driverStart = randomPoint(BASE_LAT, BASE_LNG, RADIUS);
  socket.emit('updateLocation', { lat: driverStart.lat, lng: driverStart.lng, heading: 0, speed: 0, isInTrip: false, tripStatus: null });
  socket.emit('setDriverStatus', { status: 'available', isOnline: true });
  console.log('driver_presence_published', JSON.stringify({ driverStart }));
  const presenceTicker = setInterval(() => {
    socket.emit('updateLocation', { lat: driverStart.lat, lng: driverStart.lng, heading: 0, speed: 0, isInTrip: false, tripStatus: null });
    socket.emit('setDriverStatus', { status: 'available', isOnline: true });
  }, 5000);
  try {
    const rideReq = await waitEvent(socket, ['newRideRequest'], ['bookingError'], 180000, 'newRideRequest');
    const bookingId = rideReq?.payload?.bookingId;
    const pickup = rideReq?.payload?.pickupLocation || driverStart;
    const destination = rideReq?.payload?.destinationLocation || randomPoint(BASE_LAT - 0.01, BASE_LNG - 0.01, RADIUS);
    console.log('new_ride_request_received', JSON.stringify({ bookingId, pickup, destination }));
    const acceptWait = waitEvent(socket, ['rideAccepted'], ['acceptRideError'], 30000, 'acceptRide');
    socket.emit('acceptRide', { bookingId });
    await acceptWait;
    console.log('ride_accepted', JSON.stringify({ bookingId }));
    await sleep(2000);
    const startWait = waitEvent(socket, ['tripStarted'], ['tripStartError'], 30000, 'startTrip');
    socket.emit('startTrip', { bookingId, startLocation: pickup });
    await startWait;
    console.log('trip_started', JSON.stringify({ bookingId }));
    const steps = interpolatePoints(pickup, destination, 10);
    for (const [index, point] of steps.entries()) {
      socket.emit('updateTripLocation', { bookingId, lat: point.lat, lng: point.lng, heading: 45, speed: 12 });
      console.log('trip_location_update', JSON.stringify({ bookingId, step: index + 1, total: steps.length, point }));
      await sleep(1800);
    }
    const completeWait = waitEvent(socket, ['tripCompleted'], ['tripCompleteError'], 30000, 'completeTrip');
    socket.emit('completeTrip', { bookingId, endLocation: destination, distance: 3.8, fare: ESTIMATED_FARE });
    await completeWait;
    console.log('trip_completed', JSON.stringify({ bookingId }));
  } finally {
    clearInterval(presenceTicker);
    socket.disconnect();
  }
}
main().catch(error => { console.error('driver_bot_failed', error?.stack || error?.message || String(error)); process.exit(2); });
