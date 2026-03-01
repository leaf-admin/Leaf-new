import Logger from '../../utils/Logger';
import {
    fetchPlacesAutocomplete as googleFetchPlacesAutocomplete,
    fetchCoordsfromPlace as googleFetchCoordsfromPlace,
    fetchAddressfromCoords as googleFetchAddressfromCoords,
    detectInputType as googleDetectInputType,
    fetchGeocodeAddress as googleFetchGeocodeAddress,
    getDistanceMatrix as googleGetDistanceMatrix,
    getDirectionsApi as googleGetDirectionsApi
} from './GoogleAPIFunctions';

// Utility for fetching from OSM / Nominatim with timeout
const fetchOsm = async (url, timeoutMs = 5000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'LeafMobileApp/1.0 (info@leaf.com)'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`OSM HTTP error: ${response.status}`);
        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
};

export const fetchPlacesAutocomplete = async (searchKeyword, sessionToken, location = null) => {
    Logger.log('🔍 OSM fetchPlacesAutocomplete:', { searchKeyword });
    try {
        if (!searchKeyword || searchKeyword.trim().length < 3) return [];

        let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchKeyword)}&format=json&addressdetails=1&countrycodes=br&limit=5`;
        if (location && location.lat && location.lng) {
            url += `&viewbox=${location.lng - 0.5},${location.lat + 0.5},${location.lng + 0.5},${location.lat - 0.5}&bounded=0`;
        }

        const json = await fetchOsm(url);

        if (json && json.length > 0) {
            return json.map((item, index) => ({
                place_id: `osm_${item.place_id}_${index}`,
                description: item.display_name,
                structured_formatting: {
                    main_text: item.address?.road || item.name || item.display_name.split(',')[0],
                    secondary_text: item.display_name
                },
                types: [item.type || 'establishment'],
                reference: `osm_${item.place_id}`,
                location: {
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon)
                },
                source: 'osm'
            }));
        } else {
            throw new Error('OSM ZERO_RESULTS');
        }
    } catch (error) {
        Logger.log('⚠️ OSM fetchPlacesAutocomplete failed, falling back to Google:', error.message);
        return googleFetchPlacesAutocomplete(searchKeyword, sessionToken, location);
    }
};

export const fetchCoordsfromPlace = async (place_id) => {
    Logger.log('📍 OSM fetchCoordsfromPlace:', { place_id });
    try {
        // Since we injected the location directly in fetchPlacesAutocomplete for OSM, if it's an OSM result, we probably don't need to call this or we handle it gracefully in the calling component.
        // But if forced to fetch by an OSM ID, Nominatim lookup endpoint could be used.
        // For simplicity and matching Google's format, we can just fallback to Google if it's not a known format or if it fails.
        if (String(place_id).startsWith('osm_')) {
            throw new Error('OSM place details not fully supported by ID alone without cached coords.');
        } else {
            throw new Error('Not an OSM place_id');
        }
    } catch (error) {
        Logger.log('⚠️ OSM fetchCoordsfromPlace failed, falling back to Google:', error.message);
        return googleFetchCoordsfromPlace(place_id);
    }
};

export const fetchAddressfromCoords = async (latlng) => {
    Logger.log('🏠 OSM fetchAddressfromCoords:', latlng);
    try {
        let lat, lng;
        if (typeof latlng === 'string') {
            const parts = latlng.split(',');
            lat = parts[0].trim();
            lng = parts[1].trim();
        } else if (latlng.lat && latlng.lng) {
            lat = latlng.lat;
            lng = latlng.lng;
        } else {
            throw new Error("Invalid format");
        }

        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        const json = await fetchOsm(url);

        if (json && json.display_name) {
            return json.display_name;
        } else {
            throw new Error('OSM Reverse Geocoding no results.');
        }
    } catch (error) {
        Logger.log('⚠️ OSM fetchAddressfromCoords failed, falling back to Google:', error.message);
        return googleFetchAddressfromCoords(latlng);
    }
};

export const detectInputType = (text) => {
    // We can reuse the same logic
    return googleDetectInputType(text);
};

export const fetchGeocodeAddress = async (address, location = null) => {
    Logger.log('📍 OSM fetchGeocodeAddress:', { address });
    try {
        // Same logic as autocomplete for OSM Nominatim as it handles both search and geocoding
        return await fetchPlacesAutocomplete(address, null, location);
    } catch (error) {
        Logger.log('⚠️ OSM fetchGeocodeAddress failed, falling back to Google:', error.message);
        return googleFetchGeocodeAddress(address, location);
    }
};

export const getDistanceMatrix = async (startLoc, destLoc) => {
    Logger.log('📐 OSM getDistanceMatrix:', { startLoc, destLoc });
    try {
        // Distance matrix goes to standard Directions API in OSRM
        return await getDirectionsApi(startLoc, destLoc, null);
    } catch (error) {
        Logger.log('⚠️ OSM getDistanceMatrix failed, falling back to Google:', error.message);
        return googleGetDistanceMatrix(startLoc, destLoc);
    }
};

// Polyline decode for OSRM which uses precision 5 by default
import * as DecodePolyLine from '@mapbox/polyline';

export const getDirectionsApi = async (startLoc, destLoc, waypoints) => {
    Logger.log('🚀 OSM getDirectionsApi:', { startLoc, destLoc });
    try {
        const origin = String(startLoc).trim().replace(/\s+/g, '');
        const destination = String(destLoc).trim().replace(/\s+/g, '');

        // Formato para OSRM é {longitude},{latitude} - diferente do Google maps
        let coordinates = `${origin.split(',')[1]},${origin.split(',')[0]};${destination.split(',')[1]},${destination.split(',')[0]}`;

        if (waypoints) {
            // O OSRM espera os waypoints na mesma ordem separada por ';'
            const wpArray = String(waypoints).trim().replace(/\s+/g, '').split('|');
            let wpCoords = wpArray.map(wp => `${wp.split(',')[1]},${wp.split(',')[0]}`).join(';');
            coordinates = `${origin.split(',')[1]},${origin.split(',')[0]};${wpCoords};${destination.split(',')[1]},${destination.split(',')[0]}`;
        }

        const url = `http://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=polyline&steps=true`;

        Logger.log('🌐 OSRM Routing URL:', url);

        // Define explicit timeout check inline to prevent hanging when fetchOsm times out softly
        const response = await Promise.race([
            fetch(url, { headers: { 'User-Agent': 'LeafMobileApp/1.0' } }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('OSRM Server timeout')), 8000))
        ]);

        if (!response.ok) {
            throw new Error('OSM Directions failed HTTP status: ' + response.status);
        }

        const json = await response.json();

        if (json.code === 'Ok' && json.routes && json.routes.length > 0) {
            const route = json.routes[0];
            const polylinePoints = DecodePolyLine.decode(route.geometry).map(point => ({
                latitude: point[0],
                longitude: point[1]
            }));

            return {
                distance_in_km: route.distance / 1000,
                time_in_secs: route.duration,
                polylinePoints: polylinePoints,
                duration_in_traffic: route.duration, // OSRM doesn't have traffic, mock it with base duration
                hasWaypoints: !!waypoints
            };
        } else {
            throw new Error('OSM Directions failed with NO ROUTES code:' + json.code);
        }
    } catch (error) {
        Logger.log('⚠️ OSM getDirectionsApi failed, falling back to Google:', error.message);
        return googleGetDirectionsApi(startLoc, destLoc, waypoints);
    }
};
