import Logger from '../../utils/Logger';
import base64 from 'react-native-base64';
import { firebase } from '../config/configureFirebase';
import AccessKey from './AccessKey';


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

const sanitizeSensitiveUrl = (url = '') =>
    String(url)
        .replace(/([?&]key=)[^&]+/gi, '$1***')
        .replace(/([?&]sessiontoken=)[^&]+/gi, '$1***');

// Cache curto para reduzir custo de APIs durante corrida ativa.
const MAPS_CACHE = new Map();
const MAPS_INFLIGHT = new Map();
const MAPS_CACHE_TTL_MS = {
    autocomplete: 45 * 1000,
    geocode: 2 * 60 * 1000,
    directions: 90 * 1000,
    matrix: 60 * 1000
};
const DIRECTIONS_REQUEST_TIMEOUT_MS = 12000;
const MAX_MATRIX_DESTINATIONS = 8;

const normalizeCoord = (value) => Number.parseFloat(value || 0).toFixed(4);
const safeNow = () => Date.now();

const buildCacheKey = (prefix, payload = '') => `${prefix}:${String(payload)}`;

const getCached = (key, ttlMs) => {
    const cached = MAPS_CACHE.get(key);
    if (!cached) return null;
    if (safeNow() - cached.at > ttlMs) {
        MAPS_CACHE.delete(key);
        return null;
    }
    return cached.value;
};

const setCached = (key, value) => {
    MAPS_CACHE.set(key, { at: safeNow(), value });
};

const withInFlight = async (key, executor) => {
    if (MAPS_INFLIGHT.has(key)) {
        return MAPS_INFLIGHT.get(key);
    }
    const request = (async () => {
        try {
            return await executor();
        } finally {
            MAPS_INFLIGHT.delete(key);
        }
    })();
    MAPS_INFLIGHT.set(key, request);
    return request;
};

const parseCoordPair = (coordStr) => {
    const [latRaw, lngRaw] = String(coordStr || '').split(',');
    return {
        lat: Number.parseFloat(latRaw),
        lng: Number.parseFloat(lngRaw)
    };
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

export const fetchPlacesAutocomplete = (searchKeyword, sessionToken, location = null) => {
    return new Promise((resolve,reject)=>{
        const normalizedQuery = String(searchKeyword || '').trim().toLowerCase();
        const locationKey = location?.lat && location?.lng
            ? `${normalizeCoord(location.lat)},${normalizeCoord(location.lng)}`
            : 'no_location';
        const cacheKey = buildCacheKey('places_autocomplete', `${normalizedQuery}|${locationKey}`);
        const cached = getCached(cacheKey, MAPS_CACHE_TTL_MS.autocomplete);
        if (cached) {
            resolve(cached);
            return;
        }

        Logger.log('🔍 fetchPlacesAutocomplete chamado com:', {
            searchKeyword,
            hasSessionToken: !!sessionToken,
            location
        });
        
        // ✅ Usar API do Google Places diretamente
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''; // Chave real do projeto (sem restrições)
        
        // Construir URL da API Places Autocomplete
        let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(searchKeyword)}&key=${apiKey}&language=pt-BR&components=country:br`;
        
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
        
        fetch(url)
            .then(response => response.json())
            .then(json => {
                Logger.log('📡 Resposta da API Google Places:', json);
                
                if (json.status === 'OK' && json.predictions && json.predictions.length > 0) {
                    // Converter para formato esperado pelo app
                    const searchResults = json.predictions.map(prediction => ({
                        place_id: prediction.place_id,
                        description: prediction.description,
                        structured_formatting: prediction.structured_formatting,
                        types: prediction.types,
                        reference: prediction.reference
                    }));
                    
                    Logger.log('✅ Resultados convertidos:', searchResults.length);
                    setCached(cacheKey, searchResults);
                    resolve(searchResults);
                } else if (json.status === 'ZERO_RESULTS') {
                    Logger.log('⚠️ Nenhum resultado encontrado');
                    setCached(cacheKey, []);
                    resolve([]);
                } else {
                    Logger.log('❌ Erro na API Google Places:', json.status, json.error_message);
                    reject(json.error_message || `Google Places API Error: ${json.status}`);
                }
            })
            .catch(error => {
                Logger.log('💥 Erro na requisição:', error);
                reject("fetchPlacesAutocomplete Call Error");
            });
    });
}

export const fetchCoordsfromPlace = (place_id) => {
    return new Promise((resolve,reject)=>{
        Logger.log('📍 fetchCoordsfromPlace chamado com place_id:', place_id);
        
        // ✅ Usar API do Google Places diretamente
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''; // Chave real do projeto (sem restrições)
        
        // Construir URL da API Place Details
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&key=${apiKey}&language=pt-BR&fields=geometry,formatted_address,name`;
        
        Logger.log('🌐 URL da API Place Details:', sanitizeSensitiveUrl(url));
        
        fetch(url)
            .then(response => response.json())
            .then(json => {
                Logger.log('📡 Resposta da API Google Place Details:', json);
                
                if (json.status === 'OK' && json.result && json.result.geometry && json.result.geometry.location) {
                    const location = json.result.geometry.location;
                    const coords = {
                        lat: location.lat,
                        lng: location.lng,
                        formatted_address: json.result.formatted_address,
                        name: json.result.name
                    };
                    
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
        Logger.log('🏠 fetchAddressfromCoords chamado com latlng:', latlng);
        
        // ✅ Usar API do Google Geocoding diretamente
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''; // Chave real do projeto (sem restrições)
        
        // Parse latlng (pode ser string "lat,lng" ou objeto {lat, lng})
        let lat, lng;
        if (typeof latlng === 'string') {
            const parts = latlng.split(',');
            lat = parts[0].trim();
            lng = parts[1].trim();
        } else if (latlng.lat && latlng.lng) {
            lat = latlng.lat;
            lng = latlng.lng;
        } else {
            reject("Formato de coordenadas inválido");
            return;
        }

        const cacheKey = buildCacheKey('reverse_geocode', `${normalizeCoord(lat)},${normalizeCoord(lng)}`);
        const cached = getCached(cacheKey, MAPS_CACHE_TTL_MS.geocode);
        if (cached) {
            resolve(cached);
            return;
        }
        
        // Construir URL da API Geocoding
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=pt-BR`;
        
        Logger.log('🌐 URL da API Geocoding:', sanitizeSensitiveUrl(url));
        
        fetch(url)
            .then(response => response.json())
            .then(json => {
                Logger.log('📡 Resposta da API Google Geocoding:', json);
                
                if (json.status === 'OK' && json.results && json.results.length > 0) {
                    const address = json.results[0].formatted_address;
                    Logger.log('✅ Endereço obtido:', address);
                    setCached(cacheKey, address);
                    resolve(address);
                } else {
                    Logger.log('❌ Erro na API Google Geocoding:', json.status, json.error_message);
                    reject(json.error_message || `Google Geocoding API Error: ${json.status}`);
                }
            })
            .catch(error => {
                Logger.log('💥 Erro na requisição:', error);
                reject("fetchAddressfromCoords Call Error");
            });
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
export const fetchGeocodeAddress = (address, location = null) => {
    return new Promise((resolve, reject) => {
        Logger.log('📍 fetchGeocodeAddress chamado com endereço:', address, 'location:', location);
        
        // ✅ Usar API do Google Geocoding diretamente (Forward Geocoding)
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''; // Chave real do projeto (sem restrições)
        
        // Construir URL da API Geocoding (Forward)
        let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}&language=pt-BR&components=country:br`;
        
        // ✅ Evitar bounds agressivo para não filtrar resultados válidos.
        // `region=br` mantém preferência por Brasil sem restringir por cidade.
        url += '&region=br';
        
        Logger.log('🌐 URL da API Geocoding (Forward):', sanitizeSensitiveUrl(url));
        
        fetch(url)
            .then(response => response.json())
            .then(json => {
                Logger.log('📡 Resposta da API Google Geocoding (Forward):', json);
                
                if (json.status === 'OK' && json.results && json.results.length > 0) {
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

export const getDistanceMatrix = (startLoc, destLoc) => {
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

        const normalizedStart = (() => {
            const point = parseCoordPair(startLoc);
            return `${normalizeCoord(point.lat)},${normalizeCoord(point.lng)}`;
        })();
        const normalizedDestinations = destinations.map((dest) => {
            const point = parseCoordPair(dest);
            return `${normalizeCoord(point.lat)},${normalizeCoord(point.lng)}`;
        });

        const cacheKey = buildCacheKey('distance_matrix', `${normalizedStart}|${normalizedDestinations.join('|')}`);
        const cached = getCached(cacheKey, MAPS_CACHE_TTL_MS.matrix);
        if (cached) {
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

                // Formato esperado pelo app: array [{ found, timein_text, ... }]
                const parsed = Array.isArray(json)
                    ? json
                    : Array.isArray(json?.distances)
                        ? json.distances
                        : Array.isArray(json?.rows)
                            ? (json.rows[0]?.elements || []).map((el) => {
                                const durationText = el?.duration?.text || el?.duration_in_traffic?.text || null;
                                return {
                                    found: el?.status === 'OK',
                                    timein_text: durationText || '5 min'
                                };
                            })
                            : null;

                if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
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

export const getDirectionsApi = (startLoc, destLoc, waypoints) => {
    return new Promise(async (resolve,reject)=>{
        Logger.log('🚀 ===== getDirectionsApi INICIADO =====');
        Logger.log('🗺️ getDirectionsApi chamado com:', { startLoc, destLoc, waypoints });
        
        // ✅ CORRIGIDO: Usar API do Google diretamente (endpoint do backend não existe mais)
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''; // Chave real do projeto (sem restrições)
        
        // Garantir que startLoc e destLoc estão no formato correto (sem espaços)
        const origin = String(startLoc).trim().replace(/\s+/g, '');
        const destination = String(destLoc).trim().replace(/\s+/g, '');
        
        const trafficEnabled = String(process.env.EXPO_PUBLIC_ENABLE_TRAFFIC_ROUTE || 'false').toLowerCase() === 'true';
        const alternativesEnabled = String(process.env.EXPO_PUBLIC_ENABLE_ROUTE_ALTERNATIVES || 'false').toLowerCase() === 'true';

        let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${apiKey}&language=pt-BR&units=metric`;
        if (trafficEnabled) {
            url += '&departure_time=now';
        }
        if (alternativesEnabled) {
            url += '&alternatives=true';
        }
        
        if(waypoints){
            const waypointsStr = String(waypoints).trim().replace(/\s+/g, '');
            url += `&waypoints=${encodeURIComponent(waypointsStr)}`;
        }

        const normalizedWaypoints = waypoints
            ? String(waypoints)
                .split('|')
                .map((item) => {
                    const point = parseCoordPair(item);
                    return `${normalizeCoord(point.lat)},${normalizeCoord(point.lng)}`;
                })
                .join('|')
            : 'none';
        const directionsCacheKey = buildCacheKey(
            'directions',
            `${normalizeCoord(parseCoordPair(origin).lat)},${normalizeCoord(parseCoordPair(origin).lng)}|${normalizeCoord(parseCoordPair(destination).lat)},${normalizeCoord(parseCoordPair(destination).lng)}|${normalizedWaypoints}|traffic:${trafficEnabled}|alt:${alternativesEnabled}`
        );
        const cached = getCached(directionsCacheKey, MAPS_CACHE_TTL_MS.directions);
        if (cached) {
            resolve(cached);
            return;
        }
        
        Logger.log('🌐 URL da API Google Directions:', sanitizeSensitiveUrl(url));
        Logger.log('📍 Origin formatado:', origin);
        Logger.log('📍 Destination formatado:', destination);

        withInFlight(directionsCacheKey, async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), DIRECTIONS_REQUEST_TIMEOUT_MS);
            return await fetch(url, { signal: controller.signal })
            .then(response => {
                Logger.log('📡 Response status:', response.status);
                Logger.log('📡 Response headers:', response.headers);
                Logger.log('📡 Response ok:', response.ok);
                
                if (!response.ok) {
                    // Tentar ler o texto da resposta antes de fazer JSON
                    return response.text().then(text => {
                        Logger.log('❌ Response text (não OK):', text.substring(0, 200));
                        throw new Error(`HTTP error! status: ${response.status}, body: ${text.substring(0, 100)}`);
                    });
                }
                
                // Verificar Content-Type antes de fazer parse JSON
                const contentType = response.headers.get('content-type');
                Logger.log('📡 Content-Type:', contentType);
                
                if (!contentType || !contentType.includes('application/json')) {
                    return response.text().then(text => {
                        Logger.log('❌ Resposta não é JSON:', text.substring(0, 200));
                        throw new Error(`Resposta não é JSON. Content-Type: ${contentType}, Body: ${text.substring(0, 100)}`);
                    });
                }
                
                return response.json();
            })
            .then(json => {
                Logger.log('📡 Resposta da API Google Directions (JSON):', JSON.stringify(json, null, 2).substring(0, 500));
                
                // ✅ VALIDAÇÃO 1: Verificar status
                if (json.status !== 'OK') {
                    Logger.log('❌ Status não é OK:', json.status);
                    Logger.log('❌ Error message:', json.error_message);
                    Logger.log('❌ Resposta completa:', JSON.stringify(json, null, 2));
                    reject(`Google API Error: ${json.status} - ${json.error_message || 'Unknown error'}`);
                    return;
                }
                
                // ✅ VALIDAÇÃO 2: Verificar se há routes
                if (!json.routes || json.routes.length === 0) {
                    Logger.log('❌ Resposta não tem routes:', json);
                    reject('Google API Error: No routes found in response');
                    return;
                }
                
                // ✅ SELECIONAR MELHOR ROTA considerando trânsito
                // A primeira rota já é otimizada para trânsito quando departure_time=now é usado
                // Mas vamos verificar se há rotas alternativas e escolher a melhor baseada em duration_in_traffic
                let bestRoute = json.routes[0];
                let bestTime = null;
                
                // Se há múltiplas rotas, escolher a melhor baseada em duration_in_traffic
                if (json.routes.length > 1) {
                    for (const route of json.routes) {
                        if (!route.legs || route.legs.length === 0) continue;
                        const leg = route.legs[0];
                        const routeTime = leg.duration_in_traffic ? leg.duration_in_traffic.value : leg.duration.value;
                        
                        if (bestTime === null || routeTime < bestTime) {
                            bestRoute = route;
                            bestTime = routeTime;
                        }
                    }
                    Logger.log(`🗺️ [Routes] ${json.routes.length} rotas encontradas, selecionada a melhor (${Math.round(bestTime / 60)} min)`);
                }
                
                const route = bestRoute;
                Logger.log('✅ Route encontrada:', { hasLegs: !!route.legs, hasPolyline: !!route.overview_polyline });
                
                // ✅ VALIDAÇÃO 3: Verificar se há legs
                if (!route.legs || route.legs.length === 0) {
                    Logger.log('❌ Route não tem legs:', route);
                    reject('Google API Error: Route has no legs');
                    return;
                }
                
                const leg = route.legs[0];
                Logger.log('✅ Leg encontrado:', { 
                    hasDistance: !!leg.distance, 
                    hasDuration: !!leg.duration,
                    distanceValue: leg.distance?.value,
                    durationValue: leg.duration?.value
                });
                
                // ✅ VALIDAÇÃO 4: Verificar campos obrigatórios
                if (!leg.distance || typeof leg.distance.value !== 'number') {
                    Logger.log('❌ Leg não tem distance válida:', leg);
                    reject('Google API Error: Leg has no valid distance');
                    return;
                }
                
                if (!leg.duration || typeof leg.duration.value !== 'number') {
                    Logger.log('❌ Leg não tem duration válida:', leg);
                    reject('Google API Error: Leg has no valid duration');
                    return;
                }
                
                // ✅ VALIDAÇÃO 5: Verificar se há overview_polyline
                if (!route.overview_polyline || !route.overview_polyline.points) {
                    Logger.log('❌ Route não tem overview_polyline:', route);
                    reject('Google API Error: Route has no overview_polyline');
                    return;
                }
                
                // ✅ PROCESSAR DADOS (todas as validações passaram)
                // ✅ PRIORIZAR duration_in_traffic se disponível (considera trânsito)
                // duration_in_traffic só está disponível quando departure_time é especificado
                const timeInSecs = leg.duration_in_traffic ? leg.duration_in_traffic.value : leg.duration.value;
                
                // ✅ NOVO: Se há waypoints, retornar todos os legs separadamente
                if (waypoints && route.legs && route.legs.length > 1) {
                    Logger.log('✅ Rota com waypoints detectada, extraindo legs separadamente');
                    
                    const legs = route.legs.map((legItem, index) => {
                        const legTimeInSecs = legItem.duration_in_traffic ? legItem.duration_in_traffic.value : legItem.duration.value;
                        return {
                            legIndex: index,
                            distance_in_km: legItem.distance.value / 1000,
                            time_in_secs: legTimeInSecs,
                            distance_meters: legItem.distance.value,
                            duration_seconds: legItem.duration.value,
                            duration_in_traffic: legItem.duration_in_traffic ? legItem.duration_in_traffic.value : null,
                            polylinePoints: legItem.polyline ? legItem.polyline.points : null
                        };
                    });
                    
                    const result = {
                        distance_in_km: leg.distance.value / 1000, // Distância total (primeiro leg ou soma)
                        time_in_secs: timeInSecs, // Tempo total (primeiro leg ou soma)
                        polylinePoints: route.overview_polyline.points, // Polyline completa
                        duration_in_traffic: leg.duration_in_traffic ? leg.duration_in_traffic.value : null,
                        legs: legs, // ✅ NOVO: Array com todos os legs
                        hasWaypoints: true
                    };
                    
                    Logger.log('✅ Dados processados com múltiplos legs:', {
                        totalLegs: legs.length,
                        legs: legs.map(l => ({
                            index: l.legIndex,
                            distance: `${l.distance_in_km.toFixed(2)}km`,
                            time: `${Math.round(l.time_in_secs / 60)}min`
                        }))
                    });
                    
                    setCached(directionsCacheKey, result);
                    resolve(result);
                } else {
                    // ✅ Comportamento padrão (sem waypoints)
                    const result = {
                        distance_in_km: leg.distance.value / 1000, // Converter metros para km
                        time_in_secs: timeInSecs, // Tempo em segundos (com trânsito se disponível)
                        polylinePoints: route.overview_polyline.points,
                        duration_in_traffic: leg.duration_in_traffic ? leg.duration_in_traffic.value : null,
                        hasWaypoints: false
                    };
                    
                    Logger.log('✅ Dados processados com sucesso:', {
                        distance_in_km: result.distance_in_km,
                        time_in_secs: result.time_in_secs,
                        polylineLength: result.polylinePoints?.length || 0,
                        hasTraffic: result.duration_in_traffic !== null,
                        timeDifference: result.duration_in_traffic ? 
                            Math.round((result.duration_in_traffic - leg.duration.value) / 60) : 0 // Diferença em minutos
                    });
                    setCached(directionsCacheKey, result);
                    resolve(result);
                }
            })
            .catch(error => {
                Logger.log('💥 Erro na requisição getDirectionsApi:', error);
                Logger.log('💥 Error message:', error.message);
                Logger.log('💥 Error stack:', error.stack);
                const isTimeout = error?.name === 'AbortError';
                reject(`getDirectionsApi Call Error: ${isTimeout ? 'Timeout ao consultar rota do Google' : (error.message || error)}`);
            })
            .finally(() => {
                clearTimeout(timeoutId);
            });
        }).catch((error) => {
            reject(`getDirectionsApi Call Error: ${error.message || error}`);
        });
    });
}
