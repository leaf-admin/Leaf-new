import {
  FETCH_ESTIMATE,
  FETCH_ESTIMATE_SUCCESS,
  FETCH_ESTIMATE_FAILED,
  CLEAR_ESTIMATE
} from "../types";
import Polyline from '@mapbox/polyline';
import { firebase } from '../config/configureFirebase';
import { FareCalculator } from '../other/FareCalculator';
import { calcularPedagiosPorPolyline } from '../other/TollUtils';

// Estrutura de dados para segmentos de rodovia e pedágios
export const roadSegments = {
  'RJ-066': {
    name: 'Transolímpica',
    segments: [
      {
        start: { lat: -22.9194989223804, lng: -43.3962833 },
        end: { lat: -22.9193061842793, lng: -43.3967711 },
        tolls: [
          {
            id: 'P10a',
            name: 'Transolímpica',
            location: { lat: -22.9194989223804, lng: -43.3962833 },
            Sentido: 'Norte',
            fees: {
              car: { weekday: 8.95, weekend: 8.95 },
              truck: { weekday: 17.9, weekend: 17.9 }
            }
          },
          {
            id: 'P10b',
            name: 'Transolímpica',
            location: { lat: -22.9193061842793, lng: -43.3967711 },
            Sentido: 'Sul',
            fees: {
              car: { weekday: 8.95, weekend: 8.95 },
              truck: { weekday: 17.9, weekend: 17.9 }
            }
          }
        ]
      }
    ]
  }
};

// Função para converter coordenadas para radianos
function toRad(x) {
  return x * Math.PI / 180;
}

// Função para converter coordenadas geográficas para cartesianas aproximadas
function toXY(coord) {
  const R = 6371; // Raio da Terra em km
  return {
    x: R * Math.cos(toRad(coord.lat)) * Math.cos(toRad(coord.lng)),
    y: R * Math.cos(toRad(coord.lat)) * Math.sin(toRad(coord.lng))
  };
}

// Função para calcular a menor distância de um ponto a um segmento
function distanceToSegment(p, v, w) {
  const pXY = toXY(p);
  const vXY = toXY(v);
  const wXY = toXY(w);
  const l2 = Math.pow(vXY.x - wXY.x, 2) + Math.pow(vXY.y - wXY.y, 2);
  if (l2 === 0) return Math.sqrt(Math.pow(pXY.x - vXY.x, 2) + Math.pow(pXY.y - vXY.y, 2));
  let t = ((pXY.x - vXY.x) * (wXY.x - vXY.x) + (pXY.y - vXY.y) * (wXY.y - vXY.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(
    Math.pow(pXY.x - (vXY.x + t * (wXY.x - vXY.x)), 2) +
    Math.pow(pXY.y - (vXY.y + t * (wXY.y - vXY.y)), 2)
  );
}

// Função robusta para verificar se o pedágio está na rota
function isTollOnRoute(routePoints, tollLocation, tolerance = 1) {
  for (let i = 0; i < routePoints.length - 1; i++) {
    const v = {
      lat: routePoints[i].latitude || routePoints[i].lat,
      lng: routePoints[i].longitude || routePoints[i].lng
    };
    const w = {
      lat: routePoints[i+1].latitude || routePoints[i+1].lat,
      lng: routePoints[i+1].longitude || routePoints[i+1].lng
    };
    const toll = {
      lat: tollLocation.latitude || tollLocation.lat,
      lng: tollLocation.longitude || tollLocation.lng
    };
    const dist = distanceToSegment(toll, v, w);
    // console.log(`Distância do pedágio (${toll.lat},${toll.lng}) ao segmento [(${v.lat},${v.lng})-(${w.lat},${w.lng})]: ${dist} km`);
    if (dist <= tolerance) {
      // console.log(`Pedágio detectado no segmento entre (${v.lat},${v.lng}) e (${w.lat},${w.lng}) a ${dist} km`);
      return true;
    }
  }
  return false;
}

// Função para encontrar pedágios na rota usando a abordagem robusta
function findTollsInRoute(routePoints) {
  if (!routePoints || routePoints.length === 0) {
    console.log('Nenhum ponto de rota fornecido');
    return [];
  }
  const foundTolls = new Set();
  const tollsInRoute = [];
  Object.values(roadSegments).forEach(highway => {
    highway.segments.forEach(segment => {
      segment.tolls.forEach(toll => {
        if (!foundTolls.has(toll.id) && isTollOnRoute(routePoints, toll.location, 1)) {
          tollsInRoute.push(toll);
          foundTolls.add(toll.id);
        }
      });
    });
  });
  console.log(`Total de pedágios encontrados: ${tollsInRoute.length}`);
  return tollsInRoute;
}

// Função para calcular o valor total dos pedágios
export function calculateTollFees(routePoints, vehicleType = 'car') {
  if (!routePoints || routePoints.length === 0) {
    console.log('Nenhum ponto de rota fornecido para cálculo de pedágio');
    return 0;
  }

  console.log(`Calculando pedágio para ${routePoints.length} pontos de rota`);
  
  const tolls = findTollsInRoute(routePoints);
  if (tolls.length === 0) {
    console.log('Nenhum pedágio encontrado na rota');
    return 0;
  }

  const isWeekend = [0, 6].includes(new Date().getDay());
  console.log(`Dia da semana: ${isWeekend ? 'Fim de semana' : 'Dia útil'}`);

  const totalTollFee = tolls.reduce((total, toll) => {
    const fee = isWeekend ? toll.fees[vehicleType].weekend : toll.fees[vehicleType].weekday;
    console.log(`Pedágio ${toll.name}: R$ ${fee}`);
    return total + fee;
  }, 0);

  console.log(`Valor total do pedágio: R$ ${totalTollFee}`);
  return totalTollFee;
}

// Dados dos pedágios
export const tollData = [
  {
    "Praça de Pedágio": "P01 - Casimiro de Abreu",
    "Rodovia": "BR-101",
    "KM": 192.82,
    "Município": "Casimiro de Abreu",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.476441",
    "Longitude": "-42.088519",
    "Tarifa Automóvel (R$)": 7.1,
    "Tarifa Caminhão Leve (R$)": 14.2
  },
  {
    "Praça de Pedágio": "P02 - Conselheiro Josino",
    "Rodovia": "BR-101",
    "KM": 40.5,
    "Município": "Campos dos Goytacazes",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-21.552594",
    "Longitude": "-41.331597",
    "Tarifa Automóvel (R$)": 7.1,
    "Tarifa Caminhão Leve (R$)": 14.2
  },
  {
    "Praça de Pedágio": "P03 - Rio Bonito",
    "Rodovia": "BR-101",
    "KM": 252.85,
    "Município": "Rio Bonito",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.687469",
    "Longitude": "-42.539855",
    "Tarifa Automóvel (R$)": 7.1,
    "Tarifa Caminhão Leve (R$)": 14.2
  },
  {
    "Praça de Pedágio": "P04 - São Gonçalo",
    "Rodovia": "BR-101",
    "KM": 299.69,
    "Município": "São Gonçalo",
    "Tipo de Pista": "Principal",
    "Sentido": "Norte",
    "Latitude": "-22.774713",
    "Longitude": "-42.945500",
    "Tarifa Automóvel (R$)": 7.1,
    "Tarifa Caminhão Leve (R$)": 14.2
  },
  {
    "Praça de Pedágio": "P05 - Serrinha",
    "Rodovia": "BR-101",
    "KM": 123.07,
    "Município": "Campos dos Goytacazes",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.049750",
    "Longitude": "-41.685157",
    "Tarifa Automóvel (R$)": 7.1,
    "Tarifa Caminhão Leve (R$)": 14.2
  },
  {
    "Praça de Pedágio": "P06 - Viúva Graça",
    "Rodovia": "BR-116",
    "KM": 205.87,
    "Município": "Viúva Graça",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.752000",
    "Longitude": "-43.500000",
    "Tarifa Automóvel (R$)": 16.4,
    "Tarifa Caminhão Leve (R$)": 32.8
  },
  {
    "Praça de Pedágio": "P07 - Viúva Graça B",
    "Rodovia": "BR-116",
    "KM": 207.3,
    "Município": "Viúva Graça",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.753000",
    "Longitude": "-43.501000",
    "Tarifa Automóvel (R$)": 16.4,
    "Tarifa Caminhão Leve (R$)": 32.8
  },
  {
    "Praça de Pedágio": "P08 - Ponte Rio-Niterói",
    "Rodovia": "BR-101",
    "KM": 322,
    "Município": "Rio de Janeiro",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.895000",
    "Longitude": "-43.120000",
    "Tarifa Automóvel (R$)": 6.2,
    "Tarifa Caminhão Leve (R$)": 12.4
  },
  {
    "Praça de Pedágio": "P09 - Linha Amarela",
    "Rodovia": "RJ-065",
    "KM": 10,
    "Município": "Rio de Janeiro",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.870000",
    "Longitude": "-43.300000",
    "Tarifa Automóvel (R$)": 4,
    "Tarifa Caminhão Leve (R$)": 8
  },
  {
    "Praça de Pedágio": "P11 - Transoeste",
    "Rodovia": "RJ-070",
    "KM": 20,
    "Município": "Rio de Janeiro",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.890000",
    "Longitude": "-43.500000",
    "Tarifa Automóvel (R$)": 4.7,
    "Tarifa Caminhão Leve (R$)": 9.4
  },
  {
    "Praça de Pedágio": "P12 - Transbrasiliana",
    "Rodovia": "RJ-071",
    "KM": 25,
    "Município": "Rio de Janeiro",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.900000",
    "Longitude": "-43.600000",
    "Tarifa Automóvel (R$)": 4.7,
    "Tarifa Caminhão Leve (R$)": 9.4
  },
  {
    "Praça de Pedágio": "P13 - Transcarioca",
    "Rodovia": "RJ-072",
    "KM": 30,
    "Município": "Rio de Janeiro",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.910000",
    "Longitude": "-43.700000",
    "Tarifa Automóvel (R$)": 4.7,
    "Tarifa Caminhão Leve (R$)": 9.4
  },
  {
    "Praça de Pedágio": "P14 - Transoeste",
    "Rodovia": "RJ-073",
    "KM": 35,
    "Município": "Rio de Janeiro",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.920000",
    "Longitude": "-43.800000",
    "Tarifa Automóvel (R$)": 4.7,
    "Tarifa Caminhão Leve (R$)": 9.4
  },
  {
    "Praça de Pedágio": "P15 - Mangaratiba",
    "Rodovia": "BR-101",
    "KM": 447,
    "Município": "Mangaratiba",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.959000",
    "Longitude": "-44.040000",
    "Tarifa Automóvel (R$)": "4,70 (dias úteis) / 7,90 (fins de semana)",
    "Tarifa Caminhão Leve (R$)": "9,40 (dias úteis) / 15,80 (fins de semana)"
  },
  {
    "Praça de Pedágio": "P16 - Paraty",
    "Rodovia": "BR-101",
    "KM": 538,
    "Município": "Paraty",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-23.220000",
    "Longitude": "-44.720000",
    "Tarifa Automóvel (R$)": "4,70 (dias úteis) / 7,90 (fins de semana)",
    "Tarifa Caminhão Leve (R$)": "9,40 (dias úteis) / 15,80 (fins de semana)"
  },
  {
    "Praça de Pedágio": "P17 - Magé",
    "Rodovia": "BR-116",
    "KM": 118,
    "Município": "Magé",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.663000",
    "Longitude": "-43.031000",
    "Tarifa Automóvel (R$)": 19.3,
    "Tarifa Caminhão Leve (R$)": 38.6
  },
  {
    "Praça de Pedágio": "P18 - Sapucaia",
    "Rodovia": "RJ-116",
    "KM": 0,
    "Município": "Sapucaia",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-21.994000",
    "Longitude": "-42.914000",
    "Tarifa Automóvel (R$)": 6.5,
    "Tarifa Caminhão Leve (R$)": 13
  },
  {
    "Praça de Pedágio": "P19 - Paraíba do Sul",
    "Rodovia": "RJ-116",
    "KM": 50,
    "Município": "Paraíba do Sul",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.158000",
    "Longitude": "-43.290000",
    "Tarifa Automóvel (R$)": 6.5,
    "Tarifa Caminhão Leve (R$)": 13
  },
  {
    "Praça de Pedágio": "P20 - Barra do Piraí",
    "Rodovia": "RJ-116",
    "KM": 100,
    "Município": "Barra do Piraí",
    "Tipo de Pista": "Principal",
    "Sentido": "Bidirecional",
    "Latitude": "-22.471000",
    "Longitude": "-43.826000",
    "Tarifa Automóvel (R$)": 6.5,
    "Tarifa Caminhão Leve (R$)": 13
  },
  {
    "Praça de Pedágio": "P10a - Transolímpica",
    "Rodovia": "RJ-066",
    "KM": 0,
    "Município": "Rio de Janeiro",
    "Tipo de Pista": "Principal",
    "Sentido": "Norte",
    "Latitude": "-22.9194989223804",
    "Longitude": "-43.3962833",
    "Tarifa Automóvel (R$)": 8.95,
    "Tarifa Caminhão Leve (R$)": 17.9
  },
  {
    "Praça de Pedágio": "P10b - Transolímpica",
    "Rodovia": "RJ-066",
    "KM": 0,
    "Município": "Rio de Janeiro",
    "Tipo de Pista": "Principal",
    "Sentido": "Sul",
    "Latitude": "-22.9193061842793",
    "Longitude": "-43.3967711",
    "Tarifa Automóvel (R$)": 8.95,
    "Tarifa Caminhão Leve (R$)": 17.9
  }
];

export const getEstimate = (bookingData) => async (dispatch) => {
  const {
      settingsRef
  } = firebase;

  dispatch({
    type: FETCH_ESTIMATE,
    payload: bookingData,
  });
          
  let res = bookingData.routeDetails;

  if(res){
    let points = Polyline.decode(res.polylinePoints);
    let waypoints = points.map((point) => {
        return {
            latitude: point[0],
            longitude: point[1]
        }
    });
    
    settingsRef.on('value', settingdata => {
      let settings = settingdata.val();
      let distance = settings.convert_to_mile? (res.distance_in_km / 1.609344) : res.distance_in_km;

      // --- LOGS DE DEBUG ---
      console.log('--- INÍCIO DO getEstimate ---');
      console.log('PolylinePoints:', res.polylinePoints);
      console.log('TollData:', tollData);

      // Cálculo de pedágio SEM depender da flag do Google
      const { pedagiosCruzados, valorTotal } = calcularPedagiosPorPolyline(res.polylinePoints, tollData, 2); // tolerância 2km
      console.log('Pedágios cruzados:', pedagiosCruzados);
      console.log('Valor total:', valorTotal);
      let valorPedagio = valorTotal;

      let { totalCost, grandTotal, convenience_fees } = FareCalculator(
        distance, 
        res.time_in_secs, 
        bookingData.carDetails, 
        bookingData.instructionData, 
        settings.decimal,
        waypoints,
        bookingData.carType || 'car',
        valorPedagio
      );
     
      dispatch({
        type: FETCH_ESTIMATE_SUCCESS,
        payload: {
          pickup: bookingData.pickup,
          drop: bookingData.drop,
          carDetails: bookingData.carDetails,
          instructionData: bookingData.instructionData,
          estimateDistance: parseFloat(distance).toFixed(settings.decimal),
          fareCost: totalCost ? parseFloat(totalCost).toFixed(settings.decimal) : 0,
          estimateFare: grandTotal ? parseFloat(grandTotal).toFixed(settings.decimal) : 0,
          estimateTime: res.time_in_secs,
          convenience_fees: convenience_fees ? parseFloat(convenience_fees).toFixed(settings.decimal) : 0,
          waypoints: waypoints
        },
      });
    });
  }else{
    dispatch({
      type: FETCH_ESTIMATE_FAILED,
      payload: "No Route Found",
    });
  }
}

export const clearEstimate = () => (dispatch) => {
    dispatch({
        type: CLEAR_ESTIMATE,
        payload: null,
    });    
}
