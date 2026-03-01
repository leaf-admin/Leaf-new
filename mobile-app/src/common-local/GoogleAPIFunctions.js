import Logger from '../utils/Logger';
import base64 from 'react-native-base64';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebase } from './config/configureFirebase';
import AccessKey from './AccessKey';
import { getSelfHostedApiUrl } from '../config/ApiConfig';


// Fallback para config se não estiver disponível
const getSafeConfig = () => {
    const { config } = firebase;
    return config || {
        projectId: "leaf-reactnative",
        appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
        databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
        storageBucket: "leaf-reactnative.firebasestorage.app",
        apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
        authDomain: "leaf-reactnative.firebaseapp.com",
        messagingSenderId: "106504629884",
        measurementId: "G-22368DBCY9"
    };
};

const normalizeQuery = (query = '') => query.trim().toLowerCase();
const getLocalCacheKey = (query) => `@places_cache:${normalizeQuery(query)}`;

const getFromLocalCache = async (query) => {
    try {
        const cacheKey = getLocalCacheKey(query);
        const cached = await AsyncStorage.getItem(cacheKey);
        return cached ? JSON.parse(cached) : null;
    } catch (error) {
        Logger.log('⚠️ [PlacesCache] Erro ao ler cache local:', error.message);
        return null;
    }
};

const saveToLocalCache = async (query, placeData) => {
    try {
        const cacheKey = getLocalCacheKey(query);
        await AsyncStorage.setItem(cacheKey, JSON.stringify({
            ...placeData,
            cachedAt: Date.now()
        }));
        Logger.log('💾 [PlacesCache] Resultado salvo no cache local.');
    } catch (error) {
        Logger.log('⚠️ [PlacesCache] Erro ao salvar cache local:', error.message);
    }
};

export const fetchPlacesAutocomplete = (searchKeyword, sessionToken, location = null) => {
    return new Promise(async (resolve, reject) => {
        Logger.log('🔍 fetchPlacesAutocomplete chamado com:', { searchKeyword, sessionToken, location });
        
        // ✅ ESTRATÉGIA: Cache-first com fallback para Google
        // 1. Tentar backend cache primeiro
        // 2. Se não encontrar, usar Google direto (fallback)
        // 3. Após buscar no Google, salvar no cache
        
        try {
            // 0️⃣ Tentar cache local rápido
            const localCached = await getFromLocalCache(searchKeyword);
            if (localCached) {
                Logger.log('✅ [PlacesCache] Cache local HIT! Retornando sem chamar API.');
                resolve([localCached]);
                return;
            }

            // 1️⃣ Tentar buscar no cache do backend primeiro
            const backendUrl = getSelfHostedApiUrl('/api/places/search');
            Logger.log('🔍 [PlacesCache] Tentando buscar no cache do backend...');
            
            try {
                // Usar AbortController para timeout de 5 segundos
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                
                const cacheResponse = await fetch(backendUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: searchKeyword,
                        location: location
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (cacheResponse.ok) {
                    const cacheResult = await cacheResponse.json();
                    
                    // Se encontrou no cache, retornar formatado
                    if (cacheResult.status === 'success' && cacheResult.data) {
                        Logger.log('✅ [PlacesCache] Cache HIT! Retornando do cache.');
                        
                        // Converter para formato esperado pelo app
                        const searchResults = [{
                            place_id: cacheResult.data.place_id,
                            description: cacheResult.data.address,
                            structured_formatting: {
                                main_text: cacheResult.data.name,
                                secondary_text: cacheResult.data.address
                            },
                            types: [],
                            reference: cacheResult.data.place_id,
                            location: {
                                lat: cacheResult.data.lat,
                                lng: cacheResult.data.lng
                            }
                        }];
                        
                        resolve(searchResults);
                        return; // ✅ SUCESSO - retornar do cache
                    }
                    
                    // Se não encontrou no cache, continuar para Google
                    Logger.log('❌ [PlacesCache] Cache MISS. Usando Google Places como fallback.');
                } else if (cacheResponse.status === 404) {
                    Logger.log('ℹ️ [PlacesCache] Cache MISS no backend. Usando Google Places.');
                } else {
                    Logger.log(`⚠️ [PlacesCache] Backend retornou ${cacheResponse.status}. Usando Google Places como fallback.`);
                }
            } catch (cacheError) {
                // Backend offline, timeout ou erro - usar Google direto
                if (cacheError.name === 'AbortError') {
                    Logger.log('⏱️ [PlacesCache] Timeout ao buscar cache. Usando Google Places como fallback.');
                } else {
                    Logger.log('⚠️ [PlacesCache] Erro ao buscar cache:', cacheError.message);
                    Logger.log('🔄 [PlacesCache] Usando Google Places como fallback.');
                }
            }

            // 2️⃣ Fallback: Usar Google Places diretamente
            const apiKey = 'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY'; // Chave real do projeto (sem restrições)
            
            // Construir URL da API Places Autocomplete
            let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(searchKeyword)}&key=${apiKey}&language=pt-BR&components=country:br`;
            
            // ✅ Adicionar location bias se localização disponível (prioriza resultados próximos, mas não restringe)
            if (location && location.lat && location.lng) {
                // Usar locationbias (circular) para PRIORIZAR resultados próximos, mas permitir resultados de qualquer lugar
                // Formato: circle:radius@lat,lng (raio em metros)
                // 50000m = 50km - prioriza resultados dentro de 50km, mas não restringe
                url += `&locationbias=circle:50000@${location.lat},${location.lng}`;
                Logger.log('📍 Location bias aplicado (prioriza, não restringe):', location);
            }
            
            // Adicionar sessionToken se fornecido (para agrupar requisições e reduzir custos)
            if (sessionToken) {
                url += `&sessiontoken=${sessionToken}`;
            }
            
            Logger.log('🌐 URL da API Places:', url);
            
            const response = await fetch(url);
            const json = await response.json();
            
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
                
                // 3️⃣ Salvar no cache para próxima vez (assíncrono - não bloqueia)
                if (searchResults.length > 0) {
                    saveToCache(searchKeyword, searchResults[0], location).catch(error => {
                        Logger.warn('⚠️ [PlacesCache] Erro ao salvar no cache remoto:', error.message);
                    });
                    await saveToLocalCache(searchKeyword, {
                        ...searchResults[0],
                        location: location || null
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
        // Buscar detalhes completos (lat/lng) se necessário
        let placeDetails = placeData;
        
        // Se não tem lat/lng, buscar detalhes
        if (!placeData.location && placeData.place_id) {
            const apiKey = 'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY';
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeData.place_id}&key=${apiKey}&fields=geometry,formatted_address,name`;
            
            const detailsResponse = await fetch(detailsUrl);
            const detailsJson = await detailsResponse.json();
            
            if (detailsJson.status === 'OK' && detailsJson.result) {
                const loc = detailsJson.result.geometry.location;
                placeDetails = {
                    place_id: placeData.place_id,
                    name: detailsJson.result.name,
                    address: detailsJson.result.formatted_address,
                    lat: loc.lat,
                    lng: loc.lng
                };
            }
        }
        
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
                placeData: placeDetails
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

export const fetchCoordsfromPlace = (place_id) => {
    return new Promise((resolve,reject)=>{
        Logger.log('📍 fetchCoordsfromPlace chamado com place_id:', place_id);
        
        // ✅ Usar API do Google Places diretamente
        const apiKey = 'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY'; // Chave real do projeto (sem restrições)
        
        // Construir URL da API Place Details
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&key=${apiKey}&language=pt-BR&fields=geometry,formatted_address,name`;
        
        Logger.log('🌐 URL da API Place Details:', url);
        
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

export const getDistanceMatrix = (startLoc, destLoc) => {
    return new Promise((resolve,reject)=>{
        const config = getSafeConfig();
        fetch(`https://${config.projectId}.web.app/googleapi`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": "Basic " + base64.encode(config.projectId + ":" + AccessKey)
            },
            body: JSON.stringify({
                "start": startLoc,
                "dest": destLoc,
                "calltype": "matrix",
            })
        }).then(response => {
            return response.json();
        })
        .then(json => {
            if(json.error){
                Logger.log(json.error);
                reject(json.error);
            }else{
                resolve(json);
            }
        }).catch(error=>{
            Logger.log(error);
            reject("getDistanceMatrix Call Error")
        })
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
        const apiKey = 'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY'; // Chave real do projeto (sem restrições)
        
        // Construir URL da API Geocoding (Forward)
        let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}&language=pt-BR&components=country:br`;
        
        // ✅ Adicionar location bias se localização disponível (prioriza resultados próximos, mas não restringe)
        if (location && location.lat && location.lng) {
            // Para Geocoding API, não há locationbias, mas podemos usar bounds de forma flexível
            // Vamos usar bounds do Rio de Janeiro como preferência, mas não restringir totalmente
            // Se não encontrar resultados próximos, a API ainda retornará resultados de outros lugares
            // Rio de Janeiro bounds: SW: -23.1, -43.8, NE: -22.7, -43.0
            // Nota: bounds no Geocoding API é uma preferência, não uma restrição absoluta
            url += `&bounds=-23.1,-43.8|-22.7,-43.0`;
            Logger.log('📍 Location bias aplicado para Geocoding (preferência, não restrição):', location);
        }
        
        Logger.log('🌐 URL da API Geocoding (Forward):', url);
        
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

export const getDirectionsApi = (startLoc, destLoc, waypoints) => {
    return new Promise((resolve,reject)=>{
        Logger.log('🗺️ getDirectionsApi chamado com:', { startLoc, destLoc, waypoints });
        
        // ✅ CORRIGIDO: Usar API do Google diretamente (endpoint do backend não existe mais)
        const apiKey = 'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY'; // Chave real do projeto (sem restrições)
        
        // ✅ ADICIONAR departure_time=now para obter informações de trânsito
        // Isso faz com que a API retorne duration_in_traffic com base no trânsito atual
        // E também otimiza a rota considerando o trânsito atual
        const departureTime = 'now'; // Usar 'now' para considerar trânsito atual
        
        // ✅ ADICIONAR alternatives=true para obter rotas alternativas
        // Isso permite escolher a melhor rota entre múltiplas opções considerando trânsito
        let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(startLoc)}&destination=${encodeURIComponent(destLoc)}&key=${apiKey}&language=pt-BR&units=metric&departure_time=${departureTime}&alternatives=true`;
        
        if(waypoints){
            url += `&waypoints=${encodeURIComponent(waypoints)}`;
        }
        
        Logger.log('🌐 URL da API Google Directions:', url);
        
        fetch(url)
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
                    // ✅ SELECIONAR MELHOR ROTA considerando trânsito
                    // A primeira rota já é otimizada para trânsito quando departure_time=now é usado
                    // Mas vamos verificar se há rotas alternativas e escolher a melhor baseada em duration_in_traffic
                    let bestRoute = json.routes[0];
                    let bestTime = null;
                    
                    // Se há múltiplas rotas, escolher a melhor baseada em duration_in_traffic
                    if (json.routes.length > 1) {
                        for (const route of json.routes) {
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
                    const leg = route.legs[0];
                    
                    // ✅ PRIORIZAR duration_in_traffic se disponível (considera trânsito)
                    // duration_in_traffic só está disponível quando departure_time é especificado
                    const timeInSecs = leg.duration_in_traffic ? leg.duration_in_traffic.value : leg.duration.value;
                    
                    const result = {
                        distance_in_km: leg.distance.value / 1000, // Converter metros para km
                        time_in_secs: timeInSecs, // Tempo em segundos (com trânsito se disponível)
                        polylinePoints: route.overview_polyline.points,
                        duration_in_traffic: leg.duration_in_traffic ? leg.duration_in_traffic.value : null
                    };
                    
                    Logger.log('✅ Dados processados:', {
                        ...result,
                        hasTrafficInfo: result.duration_in_traffic !== null,
                        timeDifference: result.duration_in_traffic ? 
                            Math.round((result.duration_in_traffic - leg.duration.value) / 60) : 0 // Diferença em minutos
                    });
                    resolve(result);
                } else {
                    Logger.log('❌ Erro na API Google Directions:', json.status, json.error_message);
                    reject(`Google API Error: ${json.status} - ${json.error_message || 'Unknown error'}`);
                }
            })
            .catch(error => {
                Logger.log('💥 Erro na requisição getDirectionsApi:', error);
                reject(`getDirectionsApi Call Error: ${error.message || error}`);
            });
    });
}

