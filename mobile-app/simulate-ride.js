const fs = require('fs');

// Simple fetch polyfill if needed for older Node (Node 18+ has it)
// We are likely on Node 18 or 20 here.

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Emulate Logger
const Logger = {
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args)
};

async function geocode(address) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'LeafApp-Test/1.0' }
    });
    const data = await res.json();
    if (data && data.length > 0) {
        return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon),
            address: data[0].display_name
        };
    }
    throw new Error('Endereço não encontrado: ' + address);
}

async function getRoute(origin, destination) {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=polyline`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes.length > 0) {
        return {
            distance_in_km: data.routes[0].distance / 1000,
            time_in_secs: data.routes[0].duration,
            polylinePoints: data.routes[0].geometry
        };
    }
    throw new Error('Rota não encontrada');
}

// TollUtils simplified for Node
const Polyline = require('@mapbox/polyline');
function decodePolyline(routePolyline) {
    const decodedCoords = Polyline.decode(routePolyline); // [[lat, lng], ...]
    return decodedCoords.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
}

function toRad(x) { return x * Math.PI / 180; }
function haversineDistance(a, b) {
    const R = 6371; // km
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const aVal = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
    return R * c;
}

function tollMatchesDirection(toll, waypoints) {
    // simplified for this mock, will just return true if nearby
    return true;
}

function calculateTolls(routePolyline) {
    // Transolímpica toll locations
    const tolls = [
        {
            "Praça de Pedágio": "P10a - Transolímpica",
            "Latitude": "-22.9194989223804",
            "Longitude": "-43.3962833",
            "Tarifa Automóvel (R$)": 8.95
        },
        {
            "Praça de Pedágio": "P10b - Transolímpica",
            "Latitude": "-22.9193061842793",
            "Longitude": "-43.3967711",
            "Tarifa Automóvel (R$)": 8.95
        }
    ];

    const waypoints = decodePolyline(routePolyline);
    let totalToll = 0;
    let foundTolls = [];

    for (let point of waypoints) {
        for (let toll of tolls) {
            if (!foundTolls.includes(toll["Praça de Pedágio"])) {
                let dist = haversineDistance(point, {
                    latitude: parseFloat(toll.Latitude),
                    longitude: parseFloat(toll.Longitude)
                });

                if (dist <= 0.5) {
                    foundTolls.push(toll["Praça de Pedágio"]);
                    totalToll += toll["Tarifa Automóvel (R$)"];
                }
            }
        }
    }

    // Quick fix: the same toll might be detected twice depending on direction, 
    // real logic uses precise vector math. We will limit it to 1 toll for Transolimpica
    if (foundTolls.length > 0) {
        totalToll = 8.95;
    }
    return { totalToll, foundTolls };
}

function fareCalculator(distance, time, tollFee) {
    // Simulation of Leaf default pricing
    const base_fare = 5.00; // R$
    const rate_per_km = 1.20; // R$ por KM
    const rate_per_hour = 12.00; // R$ por hora (0.2 por minuto)

    const distanceFare = distance * rate_per_km;
    const timeFare = (time / 3600) * rate_per_hour;

    const subtotal = base_fare + distanceFare + timeFare;
    const total_with_toll = subtotal + tollFee;

    // Convenience fee (App fee) - let's say 10%
    const convenience_fee = total_with_toll * 0.10;

    const final_price = total_with_toll + convenience_fee;

    return {
        base_fare: base_fare.toFixed(2),
        distance_fare: distanceFare.toFixed(2),
        time_fare: timeFare.toFixed(2),
        subtotal: subtotal.toFixed(2),
        toll_fee: tollFee.toFixed(2),
        convenience_fee: convenience_fee.toFixed(2),
        grand_total: final_price.toFixed(2)
    };
}

async function run() {
    try {
        console.log("1. Geocoding Origem: Estrada do Rio Grande 4057, Rio de Janeiro");
        const origin = await geocode("Estrada do Rio Grande 4057, Rio de Janeiro");
        console.log(`-> Encontrado: ${origin.address} (Lat: ${origin.lat}, Lng: ${origin.lng})`);

        await delay(1000); // respect nominatim rate limit

        console.log("\n2. Geocoding Destino: BarraShopping, Rio de Janeiro");
        const destination = await geocode("BarraShopping, Rio de Janeiro");
        console.log(`-> Encontrado: ${destination.address} (Lat: ${destination.lat}, Lng: ${destination.lng})`);

        console.log("\n3. Calculando Rota via OSRM (OpenStreetMap)");
        const route = await getRoute(origin, destination);
        console.log(`-> Distância: ${route.distance_in_km.toFixed(2)} km`);
        console.log(`-> Tempo Estimado: ${Math.round(route.time_in_secs / 60)} min`);

        console.log("\n4. Checando Intersecções com Pedágio (TollUtils Geo-Fence)");
        const tolls = calculateTolls(route.polylinePoints);
        if (tolls.foundTolls.length > 0) {
            console.log(`-> ⚠️ Pedágio Detectado na Rota: ${tolls.foundTolls.join(', ')}`);
            console.log(`-> Valor do Pedágio Adicionado: R$ ${tolls.totalToll}`);
        } else {
            console.log(`-> Rota Livre de Pedágios.`);
        }

        console.log("\n5. Calculando Composição da Corrida Final");
        const fare = fareCalculator(route.distance_in_km, route.time_in_secs, tolls.totalToll);
        console.log(`- Tarifa Base (Bandeirada): R$ ${fare.base_fare}`);
        console.log(`- Custo por Distância (${route.distance_in_km.toFixed(2)} km): R$ ${fare.distance_fare}`);
        console.log(`- Custo por Tempo Estimado (${Math.round(route.time_in_secs / 60)} min): R$ ${fare.time_fare}`);
        console.log(`- Sub-total da Corrida: R$ ${fare.subtotal}`);
        console.log(`- Pedágio Geograficamente Estimado: R$ ${fare.toll_fee}`);
        console.log(`- Taxa de Conveniência Leaf (10%): R$ ${fare.convenience_fee}`);
        console.log(`=======================================`);
        console.log(`- 💰 TOTAL A PAGAR: R$ ${fare.grand_total}`);

    } catch (e) {
        console.error(e);
    }
}

run();
