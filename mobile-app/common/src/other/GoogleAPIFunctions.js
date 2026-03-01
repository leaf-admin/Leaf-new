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
        apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
        authDomain: "leaf-reactnative.firebaseapp.com",
        messagingSenderId: "106504629884",
        measurementId: "G-22368DBCY9"
    };
};

export const fetchPlacesAutocomplete = (searchKeyword, sessionToken) => {
    return new Promise((resolve,reject)=>{
        const config = getSafeConfig();
        fetch(`https://${config.projectId}.web.app/googleapi`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": "Basic " + base64.encode(config.projectId + ":" + AccessKey)
            },
            body: JSON.stringify({
                "searchKeyword": searchKeyword,
                "sessiontoken": sessionToken
            })
        }).then(response => {
            return response.json();
        })
        .then(json => {
            if(json && json.searchResults) {
                resolve(json.searchResults);
            }else{
                reject(json.error);
            }
        }).catch(error=>{
            console.log(error);
            reject("fetchPlacesAutocomplete Call Error")
        })
    });
}

export const fetchCoordsfromPlace = (place_id) => {
    return new Promise((resolve,reject)=>{
        const config = getSafeConfig();
        fetch(`https://${config.projectId}.web.app/googleapi`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": "Basic " + base64.encode(config.projectId + ":" + AccessKey)
            },
            body: JSON.stringify({
                "place_id": place_id
            })
        }).then(response => {
            return response.json();
        })
        .then(json => {
            if(json && json.coords) {
                resolve(json.coords);
            }else{
                reject(json.error);
            }
        }).catch(error=>{
            console.log(error);
            reject("fetchCoordsfromPlace Call Error")
        })
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
            console.log(error);
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
                console.log(json.error);
                reject(json.error);
            }else{
                resolve(json);
            }
        }).catch(error=>{
            console.log(error);
            reject("getDistanceMatrix Call Error")
        })
    });
}

export const getDirectionsApi = (startLoc, destLoc, waypoints) => {
    return new Promise((resolve,reject)=>{
        console.log('🚀 ===== getDirectionsApi INICIADO (common/) =====');
        console.log('🗺️ getDirectionsApi chamado com:', { startLoc, destLoc, waypoints });
        
        // ✅ CORRIGIDO: Usar API do Google diretamente (endpoint do backend não existe mais)
        const apiKey = 'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY'; // Chave real do projeto (sem restrições)
        
        // Garantir que startLoc e destLoc estão no formato correto (sem espaços)
        const origin = String(startLoc).trim().replace(/\s+/g, '');
        const destination = String(destLoc).trim().replace(/\s+/g, '');
        
        let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${apiKey}&language=pt-BR&units=metric`;
        
        if(waypoints){
            const waypointsStr = String(waypoints).trim().replace(/\s+/g, '');
            url += `&waypoints=${encodeURIComponent(waypointsStr)}`;
        }
        
        console.log('🌐 URL da API Google Directions:', url);
        console.log('📍 Origin formatado:', origin);
        console.log('📍 Destination formatado:', destination);
        
        fetch(url)
            .then(response => {
                console.log('📡 Response status:', response.status);
                console.log('📡 Response headers:', response.headers);
                console.log('📡 Response ok:', response.ok);
                
                if (!response.ok) {
                    // Tentar ler o texto da resposta antes de fazer JSON
                    return response.text().then(text => {
                        console.log('❌ Response text (não OK):', text.substring(0, 200));
                        throw new Error(`HTTP error! status: ${response.status}, body: ${text.substring(0, 100)}`);
                    });
                }
                
                // Verificar Content-Type antes de fazer parse JSON
                const contentType = response.headers.get('content-type');
                console.log('📡 Content-Type:', contentType);
                
                if (!contentType || !contentType.includes('application/json')) {
                    return response.text().then(text => {
                        console.log('❌ Resposta não é JSON:', text.substring(0, 200));
                        throw new Error(`Resposta não é JSON. Content-Type: ${contentType}, Body: ${text.substring(0, 100)}`);
                    });
                }
                
                return response.json();
            })
            .then(json => {
                console.log('📡 Resposta da API Google Directions (JSON):', JSON.stringify(json, null, 2).substring(0, 500));
                
                // ✅ VALIDAÇÃO 1: Verificar status
                if (json.status !== 'OK') {
                    console.log('❌ Status não é OK:', json.status);
                    console.log('❌ Error message:', json.error_message);
                    console.log('❌ Resposta completa:', JSON.stringify(json, null, 2));
                    reject(`Google API Error: ${json.status} - ${json.error_message || 'Unknown error'}`);
                    return;
                }
                
                // ✅ VALIDAÇÃO 2: Verificar se há routes
                if (!json.routes || json.routes.length === 0) {
                    console.log('❌ Resposta não tem routes:', json);
                    reject('Google API Error: No routes found in response');
                    return;
                }
                
                const route = json.routes[0];
                console.log('✅ Route encontrada:', { hasLegs: !!route.legs, hasPolyline: !!route.overview_polyline });
                
                // ✅ VALIDAÇÃO 3: Verificar se há legs
                if (!route.legs || route.legs.length === 0) {
                    console.log('❌ Route não tem legs:', route);
                    reject('Google API Error: Route has no legs');
                    return;
                }
                
                const leg = route.legs[0];
                console.log('✅ Leg encontrado:', { 
                    hasDistance: !!leg.distance, 
                    hasDuration: !!leg.duration,
                    distanceValue: leg.distance?.value,
                    durationValue: leg.duration?.value
                });
                
                // ✅ VALIDAÇÃO 4: Verificar campos obrigatórios
                if (!leg.distance || typeof leg.distance.value !== 'number') {
                    console.log('❌ Leg não tem distance válida:', leg);
                    reject('Google API Error: Leg has no valid distance');
                    return;
                }
                
                if (!leg.duration || typeof leg.duration.value !== 'number') {
                    console.log('❌ Leg não tem duration válida:', leg);
                    reject('Google API Error: Leg has no valid duration');
                    return;
                }
                
                // ✅ VALIDAÇÃO 5: Verificar se há overview_polyline
                if (!route.overview_polyline || !route.overview_polyline.points) {
                    console.log('❌ Route não tem overview_polyline:', route);
                    reject('Google API Error: Route has no overview_polyline');
                    return;
                }
                
                // ✅ PROCESSAR DADOS (todas as validações passaram)
                const result = {
                    distance_in_km: leg.distance.value / 1000, // Converter metros para km
                    time_in_secs: leg.duration.value, // Tempo em segundos
                    polylinePoints: route.overview_polyline.points,
                    duration_in_traffic: leg.duration_in_traffic ? leg.duration_in_traffic.value : null
                };
                
                console.log('✅ Dados processados com sucesso:', {
                    distance_in_km: result.distance_in_km,
                    time_in_secs: result.time_in_secs,
                    polylineLength: result.polylinePoints?.length || 0,
                    hasTraffic: result.duration_in_traffic !== null
                });
                resolve(result);
            })
            .catch(error => {
                console.log('💥 Erro na requisição getDirectionsApi:', error);
                console.log('💥 Error message:', error.message);
                console.log('💥 Error stack:', error.stack);
                reject(`getDirectionsApi Call Error: ${error.message || error}`);
            });
    });
}

