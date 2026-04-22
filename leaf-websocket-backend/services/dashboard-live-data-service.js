const { logError } = require('../utils/logger');
const { countActiveRidesFromActiveHash } = require('./dashboard-ride-monitoring-service');

function normalizeDriverStatus(rawStatus, isOnline) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'busy' || status === 'in_trip' || status === 'started') return 'busy';
  if (status === 'available' || status === 'online') return 'available';
  return isOnline ? 'available' : 'offline';
}

async function getDashboardLiveData(redis) {
  if (!redis) {
    return {
      drivers: [],
      passengers: [],
      trips: [],
      stats: {
        driversOnline: 0,
        driversAvailable: 0,
        driversBusy: 0,
        passengerWaiting: 0,
        activeTrips: 0,
        avgWaitTime: 0,
        avgTripTime: 0
      }
    };
  }

  try {
    const [driverIds, activeTripsHash] = await Promise.all([
      redis.zrange('driver_locations', 0, -1),
      redis.hgetall('bookings:active').catch(() => ({}))
    ]);

    const drivers = [];
    if (Array.isArray(driverIds) && driverIds.length > 0) {
      const pipeline = redis.pipeline();
      driverIds.forEach((driverId) => {
        pipeline.geopos('driver_locations', driverId);
        pipeline.hgetall(`driver:${driverId}`);
      });
      const rows = await pipeline.exec();

      for (let i = 0; i < driverIds.length; i += 1) {
        const driverId = driverIds[i];
        const geoResult = rows[i * 2]?.[1];
        const hash = rows[i * 2 + 1]?.[1] || {};
        const coords = Array.isArray(geoResult) ? geoResult[0] : null;
        if (!coords || coords.length < 2) continue;

        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const isOnline = String(hash?.isOnline || 'true') === 'true';
        const status = normalizeDriverStatus(hash?.status, isOnline);

        drivers.push({
          id: driverId,
          type: 'driver',
          name: hash?.name || hash?.displayName || '',
          location: {
            lat,
            lng,
            heading: Number(hash?.heading || 0),
            speed: Number(hash?.speed || 0),
            lastUpdate: hash?.lastUpdate
              ? new Date(Number(hash.lastUpdate)).toISOString()
              : new Date().toISOString()
          },
          status,
          vehicle: {
            plate: hash?.vehicleNumber || hash?.vehiclePlate || '',
            type: hash?.carType || hash?.vehicleCategory || ''
          },
          rating: Number(hash?.rating || 0)
        });
      }
    }

    const driversAvailable = drivers.filter((driver) => driver.status === 'available').length;
    const driversBusy = drivers.filter((driver) => driver.status === 'busy').length;

    return {
      drivers,
      passengers: [],
      trips: [],
      stats: {
        driversOnline: drivers.length,
        driversAvailable,
        driversBusy,
        passengerWaiting: 0,
        activeTrips: countActiveRidesFromActiveHash(activeTripsHash),
        avgWaitTime: 0,
        avgTripTime: 0
      }
    };
  } catch (error) {
    logError(error, 'Erro ao montar live data via Redis', { service: 'dashboard-live-data-service' });
    return {
      drivers: [],
      passengers: [],
      trips: [],
      stats: {
        driversOnline: 0,
        driversAvailable: 0,
        driversBusy: 0,
        passengerWaiting: 0,
        activeTrips: 0,
        avgWaitTime: 0,
        avgTripTime: 0
      }
    };
  }
}

module.exports = {
  getDashboardLiveData,
  normalizeDriverStatus
};
