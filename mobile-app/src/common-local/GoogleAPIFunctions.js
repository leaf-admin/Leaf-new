import Logger from '../utils/Logger';
import base64 from 'react-native-base64';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebase } from './config/configureFirebase';
import AccessKey from './AccessKey';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import { allowClientDirectGoogleFallback } from '../config/runtimeAccessPolicy';
import rideCostTelemetryService, {
    RIDE_TELEMETRY_GOOGLE_SKUS
} from '../services/RideCostTelemetryService';


// Fallback para config se não estiver disponível
const getSafeConfig = () => {
    const { config } = firebase;
    return config || {
        projectId: "leaf-reactnative",
        appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
        databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
        storageBucket: "leaf-reactnative.firebasestorage.app",
        apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
        authDomain: "leaf-reactnative.firebaseapp.com",
        messagingSenderId: "106504629884",
        measurementId: "G-22368DBCY9"
    };
};

const normalizeQuery = (query = '') => query.trim().toLowerCase();
const getLocalCacheKey = (query) => `@places_cache:${normalizeQuery(query)}`;
const sanitizeSensitiveUrl = (url = '') =>
    String(url)
        .replace(/([?&]key=)[^&]+/gi, '$1***')
        .replace(/([?&]sessiontoken=)[^&]+/gi, '$1***');

const isBrazilCoordinate = (location) => {
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return false;
    }

    return lat >= -34 && lat <= 6 && lng >= -74.5 && lng <= -28;
};

const shouldUseAutocompleteCache = (query = '') => {
    const normalized = normalizeQuery(query);
    if (!normalized) {
        return false;
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
        return true;
    }

    return normalized.length >= 8;
};

const normalizeOptionalText = (value) => {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
};

const normalizePlaceLocation = (value = null) => {
    const lat = Number(value?.lat ?? value?.latitude);
    const lng = Number(value?.lng ?? value?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    return { lat, lng };
};

const sanitizeLocalPlaceCacheEntry = (entry = null) => {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const sanitized = { ...entry };
    const resolvedLocation = normalizePlaceLocation(entry.location);
    if (entry.locationSource === 'place_coordinates' && resolvedLocation) {
        sanitized.location = resolvedLocation;
        sanitized.locationSource = 'place_coordinates';
    } else {
        delete sanitized.location;
        delete sanitized.locationSource;
    }

    return sanitized;
};

const buildBackendRideTelemetryPayload = (telemetryContext = null, fallbackSurface = 'mobile_google_functions') => {
    if (!telemetryContext || typeof telemetryContext !== 'object') {
        return null;
    }

    const bookingId = normalizeOptionalText(telemetryContext?.bookingId);
    const sourceKey = normalizeOptionalText(telemetryContext?.sourceKey);
    const sourceMeta = {
        ...(telemetryContext?.sourceMeta || {}),
        surface:
            normalizeOptionalText(telemetryContext?.surface) ||
            normalizeOptionalText(telemetryContext?.sourceMeta?.surface) ||
            fallbackSurface,
    };

    return {
        bookingId,
        sourceKey,
        sourceMeta,
        requestMeta: {
            contextId: normalizeOptionalText(telemetryContext?.contextId),
            caller: 'mobile-app',
        },
    };
};

const getFromLocalCache = async (query) => {
    try {
        const cacheKey = getLocalCacheKey(query);
        const cached = await AsyncStorage.getItem(cacheKey);
        return cached ? sanitizeLocalPlaceCacheEntry(JSON.parse(cached)) : null;
    } catch (error) {
        Logger.log('⚠️ [PlacesCache] Erro ao ler cache local:', error.message);
        return null;
    }
};

const saveToLocalCache = async (query, placeData) => {
    try {
        const cacheKey = getLocalCacheKey(query);
        await AsyncStorage.setItem(cacheKey, JSON.stringify(sanitizeLocalPlaceCacheEntry({
            ...placeData,
            cachedAt: Date.now()
        })));
        Logger.log('💾 [PlacesCache] Resultado salvo no cache local.');
    } catch (error) {
        Logger.log('⚠️ [PlacesCache] Erro ao salvar cache local:', error.message);
    }
};

const MAPS_CACHE = new Map();
const MAPS_INFLIGHT = new Map();
const MAPS_CACHE_TTL_MS = {
    directions: 90 * 1000,
    matrix: 60 * 1000
};
const DIRECTIONS_REQUEST_TIMEOUT_MS = 12000;
const MAX_MATRIX_DESTINATIONS = 8;

const normalizeCoord = (value) => Number.parseFloat(value || 0).toFixed(4);
const buildCacheKey = (prefix, payload = '') => `${prefix}:${String(payload)}`;
const parseCoordPair = (coordStr) => {
    const [latRaw, lngRaw] = String(coordStr || '').split(',');
    return {
        lat: Number.parseFloat(latRaw),
        lng: Number.parseFloat(lngRaw)
    };
};
const stripHtmlInstruction = (value) =>
    String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
const normalizeDirectionsStep = (step = {}) => {
    const startLat = Number(step?.start_location?.lat);
    const startLng = Number(step?.start_location?.lng);
    const endLat = Number(step?.end_location?.lat);
    const endLng = Number(step?.end_location?.lng);

    if (
        !Number.isFinite(startLat) ||
        !Number.isFinite(startLng) ||
        !Number.isFinite(endLat) ||
        !Number.isFinite(endLng)
    ) {
        return null;
    }

    const distanceMeters = Number(step?.distance?.value);
    const durationSeconds = Number(step?.duration?.value);

    return {
        instruction: stripHtmlInstruction(step?.html_instructions) || 'Siga em frente',
        startLocation: {
            lat: startLat,
            lng: startLng
        },
        endLocation: {
            lat: endLat,
            lng: endLng
        },
        distanceMeters: Number.isFinite(distanceMeters) && distanceMeters >= 0 ? distanceMeters : 0,
        durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : 0,
        polylinePoints: step?.polyline?.points || null
    };
};
const normalizeDirectionsSteps = (steps = []) => (
    Array.isArray(steps) ? steps.map(normalizeDirectionsStep).filter(Boolean) : []
);
const getCached = (key, ttlMs) => {
    const cached = MAPS_CACHE.get(key);
    if (!cached) return null;
    if (Date.now() - cached.at > ttlMs) {
        MAPS_CACHE.delete(key);
        return null;
    }
    return cached.value;
};
const setCached = (key, value) => {
    MAPS_CACHE.set(key, { at: Date.now(), value });
};
const withInFlight = async (key, executor) => {
    if (MAPS_INFLIGHT.has(key)) return MAPS_INFLIGHT.get(key);
    const promise = (async () => {
        try {
            return await executor();
        } finally {
            MAPS_INFLIGHT.delete(key);
        }
    })();
    MAPS_INFLIGHT.set(key, promise);
    return promise;
};
const shouldForceFreshDirectionsRoute = ({
    normalizedCacheMode,
    normalizedRouteScope,
    normalizedSurface,
    telemetryContext
}) => {
    if (telemetryContext?.forceFresh === true) {
        return true;
    }

    if (normalizedCacheMode === 'force_fresh' || normalizedCacheMode === 'fresh_quote') {
        return true;
    }

    const routeContext = [
        normalizedRouteScope,
        normalizedSurface
    ].join('|').toLowerCase();

    return [
        'prebooking_quote',
        'fare_quote',
        'quote_refresh',
        'quote_finalize',
        'ride_request_quote',
        'extension_quote'
    ].some((marker) => routeContext.includes(marker));
};
const resolveDirectionsCachePolicy = ({
    originPoint,
    destinationPoint,
    normalizedWaypoints,
    trafficEnabled,
    alternativesEnabled,
    telemetryContext
}) => {
    const normalizedBookingId = String(telemetryContext?.bookingId || '').trim() || 'no-booking';
    const normalizedSourceKey = String(telemetryContext?.sourceKey || '').trim();
    const normalizedSurface = String(
        telemetryContext?.sourceMeta?.surface || telemetryContext?.surface || ''
    ).trim();
    const normalizedRouteScope = String(
        telemetryContext?.routeScope || telemetryContext?.routeFamily || ''
    ).trim();
    const normalizedCacheMode = String(telemetryContext?.cacheMode || '').trim().toLowerCase();
    const forceFresh = shouldForceFreshDirectionsRoute({
        normalizedCacheMode,
        normalizedRouteScope,
        normalizedSurface,
        telemetryContext
    });

    if (normalizedCacheMode === 'sticky_destination') {
        return {
            mode: normalizedCacheMode,
            forceFresh,
            key: buildCacheKey(
                'directions',
                [
                    'sticky',
                    normalizedBookingId,
                    normalizedSourceKey || normalizedSurface || 'unknown-source',
                    normalizedRouteScope || normalizedSurface || 'default-route',
                    `${normalizeCoord(destinationPoint.lat)},${normalizeCoord(destinationPoint.lng)}`,
                    normalizedWaypoints,
                    `traffic:${trafficEnabled}`,
                    `alt:${alternativesEnabled}`
                ].join('|')
            )
        };
    }

    return {
        mode: 'exact',
        forceFresh,
        key: buildCacheKey(
            'directions',
            `${normalizeCoord(originPoint.lat)},${normalizeCoord(originPoint.lng)}|${normalizeCoord(destinationPoint.lat)},${normalizeCoord(destinationPoint.lng)}|${normalizedWaypoints}|traffic:${trafficEnabled}|alt:${alternativesEnabled}`
        )
    };
};

const buildRideTelemetryMetadata = (telemetryContext = null, extras = {}) => ({
    telemetrySurface: telemetryContext?.sourceMeta?.surface || telemetryContext?.surface || null,
    telemetrySourceKey: telemetryContext?.sourceKey || null,
    routeScope: telemetryContext?.routeScope || telemetryContext?.routeFamily || null,
    routeFamily: telemetryContext?.routeFamily || telemetryContext?.routeScope || null,
    cacheMode: telemetryContext?.cacheMode || null,
    ...extras
});

const routeHasTrafficTiming = (route = null) => {
    const baseDuration = Number(route?.duration_without_traffic ?? route?.durationWithoutTraffic);
    const trafficDuration = Number(route?.duration_in_traffic ?? route?.durationInTraffic);
    return (
        Number.isFinite(baseDuration) &&
        Number.isFinite(trafficDuration) &&
        baseDuration > 0 &&
        trafficDuration > 0
    );
};

const shouldBypassStaleTrafficDirectionsCache = (cachedRoute, telemetryContext = null) => {
    if (!cachedRoute || routeHasTrafficTiming(cachedRoute)) {
        return false;
    }

    const routeContext = [
        telemetryContext?.routeScope,
        telemetryContext?.routeFamily,
        telemetryContext?.sourceMeta?.surface,
        telemetryContext?.surface,
    ]
        .filter(Boolean)
        .join('|')
        .toLowerCase();

    return routeContext.includes('passenger_home_preview');
};

const haversineKm = (aLat, aLng, bLat, bLng) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad((bLat || 0) - (aLat || 0));
    const dLng = toRad((bLng || 0) - (aLng || 0));
    const aa =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(aLat || 0)) * Math.cos(toRad(bLat || 0)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
    return R * c;
};
const buildApproxMatrix = (startLoc, destinations = []) => {
    const origin = parseCoordPair(startLoc);
    return destinations.map((dest) => {
        const point = parseCoordPair(dest);
        const distanceKm = haversineKm(origin.lat, origin.lng, point.lat, point.lng);
        const estimatedMinutes = Math.max(2, Math.round((distanceKm / 28) * 60));
        return {
            found: true,
            timein_text: `${estimatedMinutes} min`,
            distance_km: Number(distanceKm.toFixed(2)),
            source: 'approx'
        };
    });
};

export const fetchPlacesAutocomplete = (searchKeyword, sessionToken, location = null, telemetryContext = null) => {
    return new Promise(async (resolve, reject) => {
        Logger.log('🔍 fetchPlacesAutocomplete chamado com:', {
            searchKeyword,
            hasSessionToken: !!sessionToken,
            location
        });

        const canUseAutocompleteCache = shouldUseAutocompleteCache(searchKeyword);
        
        // ✅ ESTRATÉGIA: Backend autoritativo no release.
        // O fallback Google direto só é permitido em runtime de desenvolvimento/teste.
        
        try {
            // 0️⃣ Tentar cache local rápido
            if (canUseAutocompleteCache) {
                const localCached = await getFromLocalCache(searchKeyword);
                if (localCached) {
                    Logger.log('✅ [PlacesCache] Cache local HIT! Retornando sem chamar API.');
                    rideCostTelemetryService.recordGoogleCache('autocompleteLocalHit', {
                        metadata: {
                            queryLength: String(searchKeyword || '').trim().length
                        }
                    }, telemetryContext);
                    resolve([localCached]);
                    return;
                }
            }

            // 1️⃣ Backend autoritativo (cache + Google) para melhor observabilidade
            const backendAutocompleteUrl = getSelfHostedApiUrl('/api/places/autocomplete');
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000);
                const backendTelemetry = buildBackendRideTelemetryPayload(
                    telemetryContext,
                    'places_autocomplete_mobile',
                );
                const backendResponse = await fetch(backendAutocompleteUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: searchKeyword,
                        sessionToken: sessionToken || null,
                        location: location || null,
                        telemetry: backendTelemetry,
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                if (backendResponse.ok) {
                    const backendResult = await backendResponse.json();
                    if (Array.isArray(backendResult?.predictions) && backendResult.predictions.length > 0) {
                        if (backendResult?.cached === true) {
                            rideCostTelemetryService.recordGoogleCache('autocompleteBackendHit', {
                                metadata: {
                                    queryLength: String(searchKeyword || '').trim().length
                                }
                            }, telemetryContext);
                        }

                        if (canUseAutocompleteCache) {
                            const firstPrediction = backendResult.predictions[0];
                            const resolvedLocation = normalizePlaceLocation(firstPrediction?.location);
                            await saveToLocalCache(searchKeyword, {
                                ...firstPrediction,
                                ...(resolvedLocation
                                    ? {
                                        location: resolvedLocation,
                                        locationSource: 'place_coordinates'
                                    }
                                    : {})
                            });
                        }

                        resolve(backendResult.predictions);
                        return;
                    }
                }
            } catch (backendError) {
                if (backendError?.name === 'AbortError') {
                    Logger.log('⏱️ [PlacesCache] Timeout no autocomplete backend. Fallback para Google direto.');
                } else {
                    Logger.log('⚠️ [PlacesCache] Falha no autocomplete backend:', backendError?.message || backendError);
                }
            }

            if (!allowClientDirectGoogleFallback()) {
                Logger.log('⛔ [PlacesCache] Fallback Google direto bloqueado neste runtime.');
                resolve([]);
                return;
            }

            // 2️⃣ Fallback permitido somente em desenvolvimento/teste
            const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''; // Chave real do projeto (sem restrições)
            
            // Construir URL da API Places Autocomplete
            let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(searchKeyword)}&key=${apiKey}&language=pt-BR`;
            if (isBrazilCoordinate(location)) {
                url += '&components=country:br';
            }
            
            // ✅ Compatibilidade máxima com Places Autocomplete (Legacy): location + radius
            if (location && location.lat && location.lng) {
                url += `&location=${location.lat},${location.lng}&radius=50000`;
                Logger.log('📍 Location/radius aplicado no Places Autocomplete:', location);
            }
            
            // Adicionar sessionToken se fornecido (para agrupar requisições e reduzir custos)
            if (sessionToken) {
                url += `&sessiontoken=${sessionToken}`;
            }
            
            Logger.log('🌐 URL da API Places:', sanitizeSensitiveUrl(url));
            
            const response = await fetch(url);
            const json = await response.json();
            
                Logger.log('📡 Resposta da API Google Places:', json);
            
                if (json.status === 'OK' && json.predictions && json.predictions.length > 0) {
                    rideCostTelemetryService.recordGoogleUsage(
                        RIDE_TELEMETRY_GOOGLE_SKUS.AUTOCOMPLETE_LEGACY_PER_REQUEST,
                        {
                            billableUnits: 1,
                            requestCount: 1,
                            metadata: {
                                sessionTokenUsed: Boolean(sessionToken),
                                predictionCount: json.predictions.length,
                                queryLength: String(searchKeyword || '').trim().length
                            }
                        },
                        telemetryContext
                    );

                    // Converter para formato esperado pelo app
                    const searchResults = json.predictions.map(prediction => ({
                    place_id: prediction.place_id,
                    description: prediction.description,
                    structured_formatting: prediction.structured_formatting,
                    types: prediction.types,
                    reference: prediction.reference
                }));
                
                Logger.log('✅ Resultados convertidos:', searchResults.length);
                
                // 3️⃣ Salvar no cache para próxima vez (assíncrono - não bloqueia)
                if (searchResults.length > 0 && canUseAutocompleteCache) {
                    saveToCache(searchKeyword, searchResults[0], location).catch(error => {
                        Logger.warn('⚠️ [PlacesCache] Erro ao salvar no cache remoto:', error.message);
                    });
                    const resolvedLocation = normalizePlaceLocation(searchResults[0]?.location);
                    await saveToLocalCache(searchKeyword, {
                        ...searchResults[0],
                        ...(resolvedLocation
                            ? {
                                location: resolvedLocation,
                                locationSource: 'place_coordinates'
                            }
                            : {})
                    });
                }
                
                resolve(searchResults);
            } else if (json.status === 'ZERO_RESULTS') {
                Logger.log('⚠️ Nenhum resultado encontrado');
                resolve([]);
            } else {
                Logger.log('❌ Erro na API Google Places:', json.status, json.error_message);
                reject(json.error_message || `Google Places API Error: ${json.status}`);
            }
        } catch (error) {
            Logger.log('💥 Erro na requisição:', error);
            reject("fetchPlacesAutocomplete Call Error");
        }
    });
}

/**
 * Salva resultado do Google Places no cache do backend
 * @param {string} query - Query original
 * @param {object} placeData - Dados do lugar
 * @param {object} location - Localização do usuário (opcional)
 */
async function saveToCache(query, placeData, location = null) {
    try {
        // Evitar Place Details implícito a cada autocomplete (custo alto).
        // Persistimos dados básicos e coordenadas apenas quando já disponíveis.
        const placeDetails = {
            place_id: placeData?.place_id || null,
            name:
                placeData?.name ||
                placeData?.structured_formatting?.main_text ||
                placeData?.description ||
                query,
            address:
                placeData?.address ||
                placeData?.formatted_address ||
                placeData?.description ||
                placeData?.structured_formatting?.secondary_text ||
                query,
            lat:
                Number.isFinite(Number(placeData?.lat))
                    ? Number(placeData.lat)
                    : Number.isFinite(Number(placeData?.location?.lat))
                        ? Number(placeData.location.lat)
                        : null,
            lng:
                Number.isFinite(Number(placeData?.lng))
                    ? Number(placeData.lng)
                    : Number.isFinite(Number(placeData?.location?.lng))
                        ? Number(placeData.location.lng)
                        : null
        };
        
        // Salvar no cache do backend
        const saveUrl = getSelfHostedApiUrl('/api/places/save');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        await fetch(saveUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                placeData: placeDetails,
                location: normalizePlaceLocation(location)
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        Logger.log('💾 [PlacesCache] Place salvo no cache para próxima vez.');
    } catch (error) {
        // Não crítico - apenas logar (timeout ou erro de rede)
        if (error.name === 'AbortError') {
            Logger.warn('⏱️ [PlacesCache] Timeout ao salvar no cache (não crítico).');
        } else {
            Logger.warn('⚠️ [PlacesCache] Erro ao salvar no cache (não crítico):', error.message);
        }
    }
}

export const fetchCoordsfromPlace = (place_id, telemetryContext = null, sessionTokenInput = null, options = {}) => {
    return new Promise(async (resolve,reject)=>{
        Logger.log('📍 fetchCoordsfromPlace chamado com place_id:', place_id);
        const sessionToken = typeof sessionTokenInput === 'string' ? sessionTokenInput.trim() : '';
        const detailQuery = normalizeOptionalText(
            options?.query ||
            options?.description ||
            options?.name ||
            options?.address
        );
        const detailLocation = normalizePlaceLocation(options?.location);

        // 1️⃣ Tentar backend autoritativo primeiro
        try {
            const backendUrl = getSelfHostedApiUrl('/api/places/details');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const backendTelemetry = buildBackendRideTelemetryPayload(
                telemetryContext,
                'places_details_mobile',
            );

            const backendResponse = await fetch(backendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    placeId: place_id,
                    sessionToken: sessionToken || null,
                    query: detailQuery,
                    location: detailLocation,
                    telemetry: backendTelemetry,
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (backendResponse.ok) {
                const backendJson = await backendResponse.json();
                const backendLocation = backendJson?.data;
                if (
                    Number.isFinite(Number(backendLocation?.lat)) &&
                    Number.isFinite(Number(backendLocation?.lng))
                ) {
                    const coords = {
                        lat: Number(backendLocation.lat),
                        lng: Number(backendLocation.lng),
                        formatted_address: backendLocation.formatted_address || backendLocation.address || '',
                        name: backendLocation.name || '',
                    };
                    Logger.log('✅ Coordenadas obtidas via backend:', coords);
                    resolve(coords);
                    return;
                }
            }
        } catch (backendError) {
            if (backendError?.name === 'AbortError') {
                Logger.log('⏱️ Timeout no Place Details backend. Fallback para Google direto.');
            } else {
                Logger.log('⚠️ Falha no Place Details backend:', backendError?.message || backendError);
            }
        }

        if (!allowClientDirectGoogleFallback()) {
            reject('Place Details backend indisponível no momento.');
            return;
        }

        // 2️⃣ Fallback permitido somente em desenvolvimento/teste
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
        let url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&key=${apiKey}&language=pt-BR&fields=geometry,formatted_address,name`;
        if (sessionToken) {
            url += `&sessiontoken=${encodeURIComponent(sessionToken)}`;
        }
        Logger.log('🌐 URL da API Place Details:', sanitizeSensitiveUrl(url));

        fetch(url)
            .then(response => response.json())
            .then(json => {
                Logger.log('📡 Resposta da API Google Place Details:', json);

                if (json.status === 'OK' && json.result && json.result.geometry && json.result.geometry.location) {
                    rideCostTelemetryService.recordGoogleUsage(
                        RIDE_TELEMETRY_GOOGLE_SKUS.PLACE_DETAILS_LEGACY,
                        {
                            billableUnits: 1,
                            requestCount: 1,
                            metadata: {
                                reason: 'fetchCoordsfromPlace',
                                placeId: place_id || null,
                                sessionTokenUsed: Boolean(sessionToken),
                            },
                        },
                        telemetryContext,
                    );

                    const location = json.result.geometry.location;
                    const coords = {
                        lat: location.lat,
                        lng: location.lng,
                        formatted_address: json.result.formatted_address,
                        name: json.result.name,
                    };

                    if (detailQuery) {
                        saveToCache(detailQuery, {
                            place_id,
                            name: coords.name,
                            address: coords.formatted_address,
                            lat: coords.lat,
                            lng: coords.lng,
                        }, detailLocation).catch((cacheError) => {
                            Logger.warn('⚠️ [PlacesCache] Erro ao salvar Place Details no cache:', cacheError.message);
                        });
                    }

                    Logger.log('✅ Coordenadas obtidas:', coords);
                    resolve(coords);
                } else {
                    Logger.log('❌ Erro na API Google Place Details:', json.status, json.error_message);
                    reject(json.error_message || `Google Place Details API Error: ${json.status}`);
                }
            })
            .catch(error => {
                Logger.log('💥 Erro na requisição:', error);
                reject("fetchCoordsfromPlace Call Error");
            });
    });
}


export const fetchAddressfromCoords = (latlng) => {
    return new Promise((resolve,reject)=>{
        const config = getSafeConfig();
        fetch(`https://${config.projectId}.web.app/googleapi`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": "Basic " + base64.encode(config.projectId + ":" + AccessKey)
            },
            body: JSON.stringify({
                "latlng": latlng
            })
        }).then(response => {
            return response.json();
        })
        .then(json => {
            if(json && json.address) {
                resolve(json.address);
            }else{
                reject(json.error);
            }
        }).catch(error=>{
            Logger.log(error);
            reject("fetchAddressfromCoords Call Error")
        })
    });
}

export const getDistanceMatrix = (startLoc, destLoc, telemetryContext = null) => {
    return new Promise(async (resolve,reject)=>{
        const config = getSafeConfig();
        const destinations = String(destLoc || '')
            .split('|')
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, MAX_MATRIX_DESTINATIONS);

        if (destinations.length === 0) {
            resolve([]);
            return;
        }

        const originPoint = parseCoordPair(startLoc);
        const normalizedStart = `${normalizeCoord(originPoint.lat)},${normalizeCoord(originPoint.lng)}`;
        const normalizedDestinations = destinations.map((dest) => {
            const point = parseCoordPair(dest);
            return `${normalizeCoord(point.lat)},${normalizeCoord(point.lng)}`;
        });

        const cacheKey = buildCacheKey('distance_matrix', `${normalizedStart}|${normalizedDestinations.join('|')}`);
        const cached = getCached(cacheKey, MAPS_CACHE_TTL_MS.matrix);
        if (cached) {
            rideCostTelemetryService.recordGoogleCache('distanceMatrixMemoryHit', {
                metadata: {
                    destinationCount: normalizedDestinations.length
                }
            }, telemetryContext);
            resolve(cached);
            return;
        }

        try {
            const result = await withInFlight(cacheKey, async () => {
                const response = await fetch(`https://${config.projectId}.web.app/googleapi`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        "Authorization": "Basic " + base64.encode(config.projectId + ":" + AccessKey)
                    },
                    body: JSON.stringify({
                        start: normalizedStart,
                        dest: normalizedDestinations.join('|'),
                        calltype: 'matrix'
                    })
                });
                const json = await response.json();
                if (json?.error) {
                    throw new Error(json.error);
                }
                rideCostTelemetryService.recordGoogleUsage(
                    RIDE_TELEMETRY_GOOGLE_SKUS.DISTANCE_MATRIX_LEGACY_ELEMENT,
                    {
                        billableUnits: normalizedDestinations.length,
                        requestCount: 1,
                        metadata: {
                            destinationCount: normalizedDestinations.length
                        }
                    },
                    telemetryContext
                );
                const parsed = Array.isArray(json)
                    ? json
                    : Array.isArray(json?.rows)
                        ? (json.rows[0]?.elements || []).map((el) => ({
                            found: el?.status === 'OK',
                            timein_text: el?.duration?.text || el?.duration_in_traffic?.text || '5 min'
                        }))
                        : null;
                if (!parsed || parsed.length === 0) {
                    return buildApproxMatrix(normalizedStart, normalizedDestinations);
                }
                return parsed;
            });

            setCached(cacheKey, result);
            resolve(result);
        } catch (error) {
            Logger.log('⚠️ getDistanceMatrix fallback aproximado:', error.message || error);
            const fallback = buildApproxMatrix(normalizedStart, normalizedDestinations);
            setCached(cacheKey, fallback);
            resolve(fallback);
        }
    });
}

/**
 * Detecta se o input do usuário é um nome de lugar ou um endereço estruturado
 * @param {string} text - Texto digitado pelo usuário
 * @returns {string} - 'place' para nome de lugar, 'address' para endereço
 */
export const detectInputType = (text) => {
    if (!text || text.length < 3) {
        return 'place'; // Default para places se muito curto
    }
    
    const normalizedText = text.toLowerCase().trim();
    
    // ✅ Lista completa de tipos de logradouro
    const streetTypes = [
        'av\.', 'avenida', 'rua', 'r\.', 'street', 'st\.', 
        'alameda', 'al\.', 'praça', 'pça\.', 'travessa', 'tv\.', 
        'via', 'viela', 'estrada', 'rod\.', 'rodovia', 'rodovia',
        'boulevard', 'blvd\.', 'alameda', 'passagem', 'pass\.',
        'beco', 'largo', 'parque', 'parq\.', 'vila', 'condomínio'
    ];
    const streetTypesPattern = streetTypes.join('|');
    
    // ✅ Se começa APENAS com números (sem texto antes), é número isolado
    const isOnlyNumbers = /^\d+(\s|$)/.test(normalizedText) && normalizedText.replace(/\s/g, '').match(/^\d+$/);
    
    // ✅ Se começa com tipo de logradouro (com ou sem número depois)
    // Ex: "avenida das américas", "rua dos gramáticos 123", "estrada da barra"
    const startsWithStreetType = new RegExp(`^(${streetTypesPattern})\\s+`, 'i').test(normalizedText);
    
    // ✅ Se começa com número + tipo de logradouro
    // Ex: "4600 av das américas"
    const isNumberFirstAddress = new RegExp(`^\\d+\\s+(${streetTypesPattern})`, 'i').test(normalizedText);
    
    // ✅ Se tem tipo de logradouro + qualquer coisa + número no final
    // Ex: "avenida das américas 4600", "rua dos gramáticos 123"
    const hasStructuredAddressPattern = new RegExp(`^(${streetTypesPattern})\\s+.+\\s+\\d+`, 'i').test(normalizedText);
    
    // ✅ Se é APENAS números, usar Geocoding
    if (isOnlyNumbers) {
        Logger.log('📍 Input detectado como ENDEREÇO (apenas números):', text);
        return 'address';
    }
    
    // ✅ Se começa com tipo de logradouro OU tem padrão estruturado, usar Geocoding
    if (startsWithStreetType || isNumberFirstAddress || hasStructuredAddressPattern) {
        Logger.log('📍 Input detectado como ENDEREÇO (tipo de logradouro detectado):', text);
        return 'address';
    }
    
    // ✅ Caso contrário, usar Places API (nome de lugar, estabelecimento, etc.)
    Logger.log('🏛️ Input detectado como NOME DE LUGAR:', text);
    return 'place';
}

/**
 * Busca endereço usando Google Geocoding API (Forward Geocoding)
 * Usado quando o usuário digita um endereço estruturado (ex: "av das américas 4600")
 * @param {string} address - Endereço digitado pelo usuário
 * @returns {Promise<Array>} - Array de resultados no formato compatível com Places API
 */
export const fetchGeocodeAddress = (address, location = null, telemetryContext = null) => {
    return new Promise((resolve, reject) => {
        Logger.log('📍 fetchGeocodeAddress chamado com endereço:', address, 'location:', location);

        if (!allowClientDirectGoogleFallback()) {
            Logger.log('⛔ [PlacesCache] Geocoding direto bloqueado neste runtime.');
            resolve([]);
            return;
        }
        
        // Fallback permitido somente em desenvolvimento/teste com flag explícita.
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''; // Chave real do projeto (sem restrições)
        
        // Construir URL da API Geocoding (Forward)
        let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}&language=pt-BR`;
        if (isBrazilCoordinate(location)) {
            url += '&components=country:br&region=br';
        }
        
        Logger.log('🌐 URL da API Geocoding (Forward):', sanitizeSensitiveUrl(url));
        
        fetch(url)
            .then(response => response.json())
            .then(json => {
                Logger.log('📡 Resposta da API Google Geocoding (Forward):', json);
                
                if (json.status === 'OK' && json.results && json.results.length > 0) {
                    rideCostTelemetryService.recordGoogleUsage(
                        RIDE_TELEMETRY_GOOGLE_SKUS.GEOCODING,
                        {
                            billableUnits: 1,
                            requestCount: 1,
                            metadata: {
                                resultCount: json.results.length,
                                queryLength: String(address || '').trim().length
                            }
                        },
                        telemetryContext
                    );

                    // Converter para formato compatível com Places API
                    const searchResults = json.results.map((result, index) => {
                        const location = result.geometry.location;
                        return {
                            place_id: result.place_id || `geocode_${Date.now()}_${index}`,
                            description: result.formatted_address,
                            structured_formatting: {
                                main_text: result.address_components[0]?.long_name || result.formatted_address.split(',')[0],
                                secondary_text: result.formatted_address.split(',').slice(1).join(',').trim()
                            },
                            types: result.types,
                            location: {
                                lat: location.lat,
                                lng: location.lng
                            },
                            source: 'geocoding_forward'
                        };
                    });
                    
                    Logger.log('✅ Resultados Geocoding convertidos:', searchResults.length);
                    resolve(searchResults);
                } else if (json.status === 'ZERO_RESULTS') {
                    Logger.log('⚠️ Nenhum resultado encontrado no Geocoding');
                    resolve([]);
                } else {
                    Logger.log('❌ Erro na API Google Geocoding:', json.status, json.error_message);
                    reject(json.error_message || `Google Geocoding API Error: ${json.status}`);
                }
            })
            .catch(error => {
                Logger.log('💥 Erro na requisição Geocoding:', error);
                reject("fetchGeocodeAddress Call Error");
            });
    });
}

export const getDirectionsApi = (startLoc, destLoc, waypoints, telemetryContext = null) => {
    return new Promise(async (resolve,reject)=>{
        Logger.log('🗺️ getDirectionsApi chamado com:', { startLoc, destLoc, waypoints });
        const callerFrame = (() => {
            try {
                const stack = String(new Error().stack || '');
                const frames = stack
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean);
                return (
                    frames.find((line) => line.includes('/src/')) ||
                    frames.find((line) => line.includes('src/')) ||
                    frames[2] ||
                    null
                );
            } catch (_error) {
                return null;
            }
        })();
        
        // Montamos a URL do Google apenas para fallback controlado de QA/dev.
        // O caminho preferencial em release é sempre o backend /api/places/directions.
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''; // Chave real do projeto (sem restrições)
        
        const trafficEnabled = String(process.env.EXPO_PUBLIC_ENABLE_TRAFFIC_ROUTE || 'false').toLowerCase() === 'true';
        const alternativesEnabled = String(process.env.EXPO_PUBLIC_ENABLE_ROUTE_ALTERNATIVES || 'false').toLowerCase() === 'true';
        let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(startLoc)}&destination=${encodeURIComponent(destLoc)}&key=${apiKey}&language=pt-BR&units=metric`;
        if (trafficEnabled) {
            url += '&departure_time=now';
        }
        if (alternativesEnabled) {
            url += '&alternatives=true';
        }
        
        if(waypoints){
            url += `&waypoints=${encodeURIComponent(waypoints)}`;
        }

        const originPoint = parseCoordPair(startLoc);
        const destinationPoint = parseCoordPair(destLoc);
        const normalizedWaypoints = waypoints
            ? String(waypoints)
                .split('|')
                .map((item) => {
                    const point = parseCoordPair(item);
                    return `${normalizeCoord(point.lat)},${normalizeCoord(point.lng)}`;
                })
                .join('|')
            : 'none';
        const cachePolicy = resolveDirectionsCachePolicy({
            originPoint,
            destinationPoint,
            normalizedWaypoints,
            trafficEnabled,
            alternativesEnabled,
            telemetryContext
        });
        const cacheKey = cachePolicy.key;
        const cached = cachePolicy.forceFresh
            ? null
            : getCached(cacheKey, MAPS_CACHE_TTL_MS.directions);
        if (cached) {
            if (shouldBypassStaleTrafficDirectionsCache(cached, telemetryContext)) {
                rideCostTelemetryService.recordGoogleCache('directionsMemoryStaleTrafficBypass', {
                    metadata: buildRideTelemetryMetadata(telemetryContext, {
                        waypointsCount: waypoints ? String(waypoints).split('|').filter(Boolean).length : 0,
                        trafficEnabled,
                        alternativesEnabled,
                        cacheMode: cachePolicy.mode,
                        forceFresh: cachePolicy.forceFresh,
                        callerFrame
                    })
                }, telemetryContext);
            } else {
                rideCostTelemetryService.recordGoogleCache('directionsMemoryHit', {
                    metadata: buildRideTelemetryMetadata(telemetryContext, {
                        waypointsCount: waypoints ? String(waypoints).split('|').filter(Boolean).length : 0,
                        trafficEnabled,
                        alternativesEnabled,
                        cacheMode: cachePolicy.mode,
                        forceFresh: cachePolicy.forceFresh,
                        callerFrame
                    })
                }, telemetryContext);
                resolve(cached);
                return;
            }
        }
        
        Logger.log('🌐 URL da API Google Directions:', sanitizeSensitiveUrl(url));
        
        withInFlight(cacheKey, async () => {
            // 1) Backend autoritativo (com cache + telemetria por booking)
            try {
                const backendUrl = getSelfHostedApiUrl('/api/places/directions');
                const backendController = new AbortController();
                const backendTimeoutId = setTimeout(
                    () => backendController.abort(),
                    DIRECTIONS_REQUEST_TIMEOUT_MS,
                );
                const backendTelemetry = buildBackendRideTelemetryPayload(
                    telemetryContext,
                    'directions_mobile',
                );
                const backendResponse = await fetch(backendUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        startLoc,
                        destLoc,
                        waypoints: waypoints || null,
                        trafficEnabled,
                        alternativesEnabled,
                        forceFresh: cachePolicy.forceFresh,
                        routeScope:
                            telemetryContext?.routeScope ||
                            telemetryContext?.routeFamily ||
                            'unknown',
                        telemetry: backendTelemetry,
                    }),
                    signal: backendController.signal,
                });
                clearTimeout(backendTimeoutId);

                if (backendResponse.ok) {
                    const backendJson = await backendResponse.json();
                    if (backendJson?.status === 'success' && backendJson?.data) {
                        if (backendJson?.cached === true) {
                            rideCostTelemetryService.recordGoogleCache('directionsBackendHit', {
                                metadata: buildRideTelemetryMetadata(telemetryContext, {
                                    waypointsCount: waypoints ? String(waypoints).split('|').filter(Boolean).length : 0,
                                    trafficEnabled,
                                    alternativesEnabled,
                                    cacheMode: 'backend_cache',
                                    forceFresh: cachePolicy.forceFresh,
                                    callerFrame
                                })
                            }, telemetryContext);
                        }
                        setCached(cacheKey, backendJson.data);
                        resolve(backendJson.data);
                        return backendJson.data;
                    }
                }
            } catch (backendError) {
                if (backendError?.name === 'AbortError') {
                    Logger.log('⏱️ getDirectionsApi backend timeout');
                } else {
                    Logger.log('⚠️ getDirectionsApi backend falhou:', backendError?.message || backendError);
                }
            }

            if (!allowClientDirectGoogleFallback()) {
                throw new Error('Directions backend indisponível no momento.');
            }

            // 2) Fallback permitido somente em desenvolvimento/teste
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), DIRECTIONS_REQUEST_TIMEOUT_MS);
            return await fetch(url, { signal: controller.signal })
            .then(response => {
                Logger.log('📡 Response status:', response.status);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(json => {
                Logger.log('📡 Resposta da API Google Directions:', json);
                
                if (json.status === 'OK' && json.routes && json.routes.length > 0) {
                    rideCostTelemetryService.recordGoogleUsage(
                        RIDE_TELEMETRY_GOOGLE_SKUS.DIRECTIONS_LEGACY,
                        {
                            billableUnits: 1,
                            requestCount: 1,
                            metadata: buildRideTelemetryMetadata(telemetryContext, {
                                routeCount: json.routes.length,
                                waypointsCount: waypoints ? String(waypoints).split('|').filter(Boolean).length : 0,
                                trafficEnabled,
                                alternativesEnabled,
                                cacheMode: cachePolicy.mode,
                                forceFresh: cachePolicy.forceFresh,
                                callerFrame
                            })
                        },
                        telemetryContext
                    );

                    // ✅ SELECIONAR MELHOR ROTA considerando trânsito
                    // A primeira rota já é otimizada para trânsito quando departure_time=now é usado
                    // Mas vamos verificar se há rotas alternativas e escolher a melhor baseada no somatório das pernas
                    let bestRoute = json.routes[0];
                    let bestTime = null;
                    
                    // Se há múltiplas rotas, escolher a melhor baseada em duration_in_traffic
                    if (json.routes.length > 1) {
                        for (const route of json.routes) {
                            const routeLegs = Array.isArray(route.legs) ? route.legs : [];
                            const routeTime = routeLegs.reduce((total, currentLeg) => {
                                const durationValue = currentLeg?.duration_in_traffic?.value ?? currentLeg?.duration?.value;
                                return Number.isFinite(durationValue) ? total + durationValue : total;
                            }, 0);
                            
                            if (bestTime === null || routeTime < bestTime) {
                                bestRoute = route;
                                bestTime = routeTime;
                            }
                        }
                        Logger.log(`🗺️ [Routes] ${json.routes.length} rotas encontradas, selecionada a melhor (${Math.round(bestTime / 60)} min)`);
                    }
                    
                    const route = bestRoute;
                    const legs = Array.isArray(route.legs) ? route.legs : [];
                    const normalizedLegs = legs.map((currentLeg) => {
                        const legDurationInTraffic = Number(currentLeg?.duration_in_traffic?.value);
                        const legDurationWithoutTraffic = Number(currentLeg?.duration?.value);
                        const legTimeInSecs = Number(
                            currentLeg?.duration_in_traffic?.value ?? currentLeg?.duration?.value ?? 0
                        );
                        return {
                            distance_in_km: Number(currentLeg?.distance?.value || 0) / 1000,
                            time_in_secs: legTimeInSecs,
                            duration_without_traffic: Number.isFinite(legDurationWithoutTraffic)
                                ? legDurationWithoutTraffic
                                : null,
                            duration_in_traffic: Number.isFinite(legDurationInTraffic)
                                ? legDurationInTraffic
                                : null,
                            start_location:
                                Number.isFinite(Number(currentLeg?.start_location?.lat)) &&
                                Number.isFinite(Number(currentLeg?.start_location?.lng))
                                    ? {
                                        latitude: Number(currentLeg.start_location.lat),
                                        longitude: Number(currentLeg.start_location.lng)
                                    }
                                    : null,
                            end_location:
                                Number.isFinite(Number(currentLeg?.end_location?.lat)) &&
                                Number.isFinite(Number(currentLeg?.end_location?.lng))
                                    ? {
                                        latitude: Number(currentLeg.end_location.lat),
                                        longitude: Number(currentLeg.end_location.lng)
                                    }
                                    : null,
                            start_address: currentLeg?.start_address || '',
                            end_address: currentLeg?.end_address || '',
                            steps: normalizeDirectionsSteps(currentLeg?.steps)
                        };
                    });
                    const steps = normalizedLegs.flatMap((currentLeg) => (
                        Array.isArray(currentLeg.steps) ? currentLeg.steps : []
                    ));
                    const totalDistanceKm = normalizedLegs.reduce(
                        (total, currentLeg) =>
                            Number.isFinite(currentLeg.distance_in_km)
                                ? total + currentLeg.distance_in_km
                                : total,
                        0
                    );
                    const totalTimeInSecs = normalizedLegs.reduce(
                        (total, currentLeg) =>
                            Number.isFinite(currentLeg.time_in_secs)
                                ? total + currentLeg.time_in_secs
                                : total,
                        0
                    );
                    const baseDurationLegs = normalizedLegs.filter((currentLeg) =>
                        Number.isFinite(currentLeg.duration_without_traffic)
                    );
                    const totalDurationWithoutTraffic =
                        baseDurationLegs.length === normalizedLegs.length && baseDurationLegs.length > 0
                            ? baseDurationLegs.reduce(
                                (total, currentLeg) =>
                                    total + Number(currentLeg.duration_without_traffic || 0),
                                0
                              )
                            : null;
                    const trafficLegs = normalizedLegs.filter((currentLeg) =>
                        Number.isFinite(currentLeg.duration_in_traffic)
                    );
                    const totalDurationInTraffic =
                        trafficLegs.length === normalizedLegs.length && trafficLegs.length > 0
                            ? trafficLegs.reduce(
                                (total, currentLeg) => total + Number(currentLeg.duration_in_traffic || 0),
                                0
                              )
                            : null;
                    
                    const result = {
                        distance_in_km: totalDistanceKm, // Converter metros para km
                        time_in_secs: totalTimeInSecs, // Tempo em segundos (com trânsito se disponível)
                        duration_without_traffic: totalDurationWithoutTraffic,
                        polylinePoints: route.overview_polyline.points,
                        duration_in_traffic: totalDurationInTraffic,
                        legs: normalizedLegs,
                        steps
                    };
                    
                    Logger.log('✅ Dados processados:', {
                        ...result,
                        hasTrafficInfo: result.duration_in_traffic !== null,
                        timeDifference: result.duration_in_traffic ? 
                            Math.round((result.duration_in_traffic - result.time_in_secs) / 60) : 0 // Diferença em minutos
                    });
                    setCached(cacheKey, result);
                    resolve(result);
                } else {
                    Logger.log('❌ Erro na API Google Directions:', json.status, json.error_message);
                    reject(`Google API Error: ${json.status} - ${json.error_message || 'Unknown error'}`);
                }
            })
            .catch(error => {
                Logger.log('💥 Erro na requisição getDirectionsApi:', error);
                const isTimeout = error?.name === 'AbortError';
                reject(`getDirectionsApi Call Error: ${isTimeout ? 'Timeout ao consultar rota do Google' : (error.message || error)}`);
            })
            .finally(() => {
                clearTimeout(timeoutId);
            });
        }).then((result) => {
            if (result) {
                resolve(result);
            }
        }).catch((error) => {
            reject(`getDirectionsApi Call Error: ${error.message || error}`);
        });
    });
}
