const EARTH_RADIUS_KM = 6371;
const DEFAULT_TOLERANCE_KM = Math.max(
  0.1,
  Number.parseFloat(process.env.ROUTE_TOLL_DETECTION_TOLERANCE_KM || '2') || 2
);

const TOLL_PLAZAS = Object.freeze([
  { id: 'p01_casimiro_de_abreu', name: 'P01 - Casimiro de Abreu', road: 'BR-101', direction: 'bidirectional', lat: -22.476441, lng: -42.088519, fees: { car: { weekday: 7.1, weekend: 7.1 }, truck: { weekday: 14.2, weekend: 14.2 } } },
  { id: 'p02_conselheiro_josino', name: 'P02 - Conselheiro Josino', road: 'BR-101', direction: 'bidirectional', lat: -21.552594, lng: -41.331597, fees: { car: { weekday: 7.1, weekend: 7.1 }, truck: { weekday: 14.2, weekend: 14.2 } } },
  { id: 'p03_rio_bonito', name: 'P03 - Rio Bonito', road: 'BR-101', direction: 'bidirectional', lat: -22.687469, lng: -42.539855, fees: { car: { weekday: 7.1, weekend: 7.1 }, truck: { weekday: 14.2, weekend: 14.2 } } },
  { id: 'p04_sao_goncalo', name: 'P04 - Sao Goncalo', road: 'BR-101', direction: 'north', lat: -22.774713, lng: -42.9455, fees: { car: { weekday: 7.1, weekend: 7.1 }, truck: { weekday: 14.2, weekend: 14.2 } } },
  { id: 'p05_serrinha', name: 'P05 - Serrinha', road: 'BR-101', direction: 'bidirectional', lat: -22.04975, lng: -41.685157, fees: { car: { weekday: 7.1, weekend: 7.1 }, truck: { weekday: 14.2, weekend: 14.2 } } },
  { id: 'p06_viuva_graca', name: 'P06 - Viuva Graca', road: 'BR-116', direction: 'bidirectional', lat: -22.752, lng: -43.5, fees: { car: { weekday: 16.4, weekend: 16.4 }, truck: { weekday: 32.8, weekend: 32.8 } } },
  { id: 'p07_viuva_graca_b', name: 'P07 - Viuva Graca B', road: 'BR-116', direction: 'bidirectional', lat: -22.753, lng: -43.501, fees: { car: { weekday: 16.4, weekend: 16.4 }, truck: { weekday: 32.8, weekend: 32.8 } } },
  { id: 'p08_ponte_rio_niteroi', name: 'P08 - Ponte Rio-Niteroi', road: 'BR-101', direction: 'bidirectional', lat: -22.895, lng: -43.12, fees: { car: { weekday: 6.2, weekend: 6.2 }, truck: { weekday: 12.4, weekend: 12.4 } } },
  { id: 'p09_linha_amarela', name: 'P09 - Linha Amarela', road: 'RJ-065', direction: 'bidirectional', lat: -22.87, lng: -43.3, fees: { car: { weekday: 4, weekend: 4 }, truck: { weekday: 8, weekend: 8 } } },
  { id: 'p11_transoeste', name: 'P11 - Transoeste', road: 'RJ-070', direction: 'bidirectional', lat: -22.89, lng: -43.5, fees: { car: { weekday: 4.7, weekend: 4.7 }, truck: { weekday: 9.4, weekend: 9.4 } } },
  { id: 'p12_transbrasiliana', name: 'P12 - Transbrasiliana', road: 'RJ-071', direction: 'bidirectional', lat: -22.9, lng: -43.6, fees: { car: { weekday: 4.7, weekend: 4.7 }, truck: { weekday: 9.4, weekend: 9.4 } } },
  { id: 'p13_transcarioca', name: 'P13 - Transcarioca', road: 'RJ-072', direction: 'bidirectional', lat: -22.91, lng: -43.7, fees: { car: { weekday: 4.7, weekend: 4.7 }, truck: { weekday: 9.4, weekend: 9.4 } } },
  { id: 'p14_transoeste', name: 'P14 - Transoeste', road: 'RJ-073', direction: 'bidirectional', lat: -22.92, lng: -43.8, fees: { car: { weekday: 4.7, weekend: 4.7 }, truck: { weekday: 9.4, weekend: 9.4 } } },
  { id: 'p15_mangaratiba', name: 'P15 - Mangaratiba', road: 'BR-101', direction: 'bidirectional', lat: -22.959, lng: -44.04, fees: { car: { weekday: 4.7, weekend: 7.9 }, truck: { weekday: 9.4, weekend: 15.8 } } },
  { id: 'p16_paraty', name: 'P16 - Paraty', road: 'BR-101', direction: 'bidirectional', lat: -23.22, lng: -44.72, fees: { car: { weekday: 4.7, weekend: 7.9 }, truck: { weekday: 9.4, weekend: 15.8 } } },
  { id: 'p17_mage', name: 'P17 - Mage', road: 'BR-116', direction: 'bidirectional', lat: -22.663, lng: -43.031, fees: { car: { weekday: 19.3, weekend: 19.3 }, truck: { weekday: 38.6, weekend: 38.6 } } },
  { id: 'p18_sapucaia', name: 'P18 - Sapucaia', road: 'RJ-116', direction: 'bidirectional', lat: -21.994, lng: -42.914, fees: { car: { weekday: 6.5, weekend: 6.5 }, truck: { weekday: 13, weekend: 13 } } },
  { id: 'p19_paraiba_do_sul', name: 'P19 - Paraiba do Sul', road: 'RJ-116', direction: 'bidirectional', lat: -22.158, lng: -43.29, fees: { car: { weekday: 6.5, weekend: 6.5 }, truck: { weekday: 13, weekend: 13 } } },
  { id: 'p20_barra_do_pirai', name: 'P20 - Barra do Pirai', road: 'RJ-116', direction: 'bidirectional', lat: -22.471, lng: -43.826, fees: { car: { weekday: 6.5, weekend: 6.5 }, truck: { weekday: 13, weekend: 13 } } },
  { id: 'p10a_transolimpica', name: 'P10a - Transolimpica', road: 'RJ-066', direction: 'north', lat: -22.9194989223804, lng: -43.3962833, fees: { car: { weekday: 8.95, weekend: 8.95 }, truck: { weekday: 17.9, weekend: 17.9 } } },
  { id: 'p10b_transolimpica', name: 'P10b - Transolimpica', road: 'RJ-066', direction: 'south', lat: -22.9193061842793, lng: -43.3967711, fees: { car: { weekday: 8.95, weekend: 8.95 }, truck: { weekday: 17.9, weekend: 17.9 } } }
]);

function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

function roundMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(Math.max(0, numeric).toFixed(2)) : 0;
}

function normalizeCoordinate(value = {}) {
  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function decodePolyline(encoded = '') {
  const input = String(encoded || '');
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < input.length) {
    let result = 0;
    let shift = 0;
    let byte = null;
    do {
      byte = input.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= input.length);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = input.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= input.length);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5
    });
  }

  return coordinates.filter(normalizeCoordinate);
}

function projectCoordinate(coordinate, referenceLatitude) {
  return {
    x: EARTH_RADIUS_KM * toRad(coordinate.longitude) * Math.cos(toRad(referenceLatitude)),
    y: EARTH_RADIUS_KM * toRad(coordinate.latitude)
  };
}

function distanceToSegmentKm(point, start, end) {
  const referenceLatitude = (point.latitude + start.latitude + end.latitude) / 3;
  const p = projectCoordinate(point, referenceLatitude);
  const v = projectCoordinate(start, referenceLatitude);
  const w = projectCoordinate(end, referenceLatitude);
  const segmentLengthSquared = ((w.x - v.x) ** 2) + ((w.y - v.y) ** 2);

  if (segmentLengthSquared === 0) {
    return Math.sqrt(((p.x - v.x) ** 2) + ((p.y - v.y) ** 2));
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      (((p.x - v.x) * (w.x - v.x)) + ((p.y - v.y) * (w.y - v.y))) /
        segmentLengthSquared
    )
  );
  const projection = {
    x: v.x + t * (w.x - v.x),
    y: v.y + t * (w.y - v.y)
  };

  return Math.sqrt(((p.x - projection.x) ** 2) + ((p.y - projection.y) ** 2));
}

function bearingDegrees(from, to) {
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const deltaLng = toRad(to.longitude - from.longitude);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function bearingToDirection(bearing) {
  if (bearing >= 315 || bearing < 45) return 'north';
  if (bearing >= 45 && bearing < 135) return 'east';
  if (bearing >= 135 && bearing < 225) return 'south';
  return 'west';
}

function directionMatches(toll, routeCoordinates, nearestSegmentIndex) {
  if (!toll.direction || toll.direction === 'bidirectional') {
    return true;
  }

  const start = routeCoordinates[nearestSegmentIndex];
  const end = routeCoordinates[nearestSegmentIndex + 1];
  if (!start || !end) {
    return false;
  }

  return bearingToDirection(bearingDegrees(start, end)) === toll.direction;
}

function normalizeVehicleTollClass(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return normalized.includes('truck') || normalized.includes('caminhao') ? 'truck' : 'car';
}

function getTollFeeForDate(toll, vehicleClass, now = new Date()) {
  const feeTable = toll.fees?.[vehicleClass] || toll.fees?.car;
  const day = now instanceof Date ? now.getDay() : new Date(now).getDay();
  const key = day === 0 || day === 6 ? 'weekend' : 'weekday';
  return roundMoney(feeTable?.[key] ?? feeTable?.weekday ?? 0);
}

function findRouteTolls(routeCoordinates = [], options = {}) {
  const coordinates = routeCoordinates.map(normalizeCoordinate).filter(Boolean);
  if (coordinates.length < 2) {
    return [];
  }

  const toleranceKm = Math.max(0.1, Number(options.toleranceKm) || DEFAULT_TOLERANCE_KM);
  const vehicleClass = normalizeVehicleTollClass(options.vehicleType);
  const now = options.now || new Date();
  const found = [];
  const foundIds = new Set();

  TOLL_PLAZAS.forEach((toll) => {
    const tollCoordinate = normalizeCoordinate({ latitude: toll.lat, longitude: toll.lng });
    if (!tollCoordinate || foundIds.has(toll.id)) {
      return;
    }

    let nearestDistanceKm = Infinity;
    let nearestSegmentIndex = -1;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const distanceKm = distanceToSegmentKm(tollCoordinate, coordinates[index], coordinates[index + 1]);
      if (distanceKm < nearestDistanceKm) {
        nearestDistanceKm = distanceKm;
        nearestSegmentIndex = index;
      }
    }

    if (
      nearestDistanceKm <= toleranceKm &&
      directionMatches(toll, coordinates, nearestSegmentIndex)
    ) {
      foundIds.add(toll.id);
      found.push({
        id: toll.id,
        name: toll.name,
        road: toll.road,
        direction: toll.direction,
        amount: getTollFeeForDate(toll, vehicleClass, now),
        distanceKm: Number(nearestDistanceKm.toFixed(3))
      });
    }
  });

  return found;
}

function estimateRouteTollsFromCoordinates(routeCoordinates = [], options = {}) {
  const tolls = findRouteTolls(routeCoordinates, options);
  const tollFee = roundMoney(tolls.reduce((sum, toll) => sum + Number(toll.amount || 0), 0));
  return {
    tollFee,
    tolls,
    tollCount: tolls.length,
    source: 'leaf_toll_catalog',
    toleranceKm: Math.max(0.1, Number(options.toleranceKm) || DEFAULT_TOLERANCE_KM)
  };
}

function estimateRouteTollsFromPolyline(polylinePoints, options = {}) {
  if (!polylinePoints) {
    return estimateRouteTollsFromCoordinates([], options);
  }
  return estimateRouteTollsFromCoordinates(decodePolyline(polylinePoints), options);
}

function estimateRouteTolls(input = {}, options = {}) {
  const routeCoordinates =
    Array.isArray(input.routeCoordinates) && input.routeCoordinates.length > 0
      ? input.routeCoordinates
      : [];
  if (routeCoordinates.length >= 2) {
    return estimateRouteTollsFromCoordinates(routeCoordinates, options);
  }

  return estimateRouteTollsFromPolyline(
    input.routePolyline ||
      input.polylinePoints ||
      input.encodedPolyline ||
      input.overviewPolyline ||
      '',
    options
  );
}

function resolveTollFeeFromPricingPayload(payload = {}) {
  const tollEstimate = estimateRouteTolls({
    routePolyline:
      payload.routePolyline ||
      payload.polylinePoints ||
      payload.encodedPolyline ||
      payload.routeDetails?.polylinePoints ||
      payload.route?.polylinePoints ||
      '',
    routeCoordinates:
      payload.routeCoordinates ||
      payload.route?.coordinates ||
      payload.routeDetails?.coordinates ||
      []
  }, {
    vehicleType: payload.vehicleTollClass || payload.tollVehicleType || 'car'
  });

  if (tollEstimate.tollFee > 0) {
    return tollEstimate;
  }

  const fallbackTollFee = roundMoney(
    payload.tollFee ||
      payload.tollAmount ||
      payload.routeTollFee ||
      payload.route?.tollFee ||
      payload.routeDetails?.tollFee ||
      0
  );
  return {
    ...tollEstimate,
    tollFee: fallbackTollFee,
    source: fallbackTollFee > 0 ? 'payload_toll_fee_fallback' : tollEstimate.source
  };
}

module.exports = {
  TOLL_PLAZAS,
  decodePolyline,
  findRouteTolls,
  estimateRouteTolls,
  estimateRouteTollsFromCoordinates,
  estimateRouteTollsFromPolyline,
  resolveTollFeeFromPricingPayload
};
