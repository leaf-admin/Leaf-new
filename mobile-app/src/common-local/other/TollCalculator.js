import Logger from '../../utils/Logger';
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
    if (dist <= tolerance) {
      return true;
    }
  }
  return false;
}

// Função para encontrar pedágios na rota usando a abordagem robusta
function findTollsInRoute(routePoints) {
  if (!routePoints || routePoints.length === 0) {
    Logger.log('Nenhum ponto de rota fornecido');
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
  Logger.log(`Total de pedágios encontrados: ${tollsInRoute.length}`);
  return tollsInRoute;
}

// Função para calcular o valor total dos pedágios
export function calculateTollFees(routePoints, vehicleType = 'car') {
  if (!routePoints || routePoints.length === 0) {
    Logger.log('Nenhum ponto de rota fornecido para cálculo de pedágio');
    return 0;
  }

  Logger.log(`Calculando pedágio para ${routePoints.length} pontos de rota`);
  
  const tolls = findTollsInRoute(routePoints);
  if (tolls.length === 0) {
    Logger.log('Nenhum pedágio encontrado na rota');
    return 0;
  }

  const isWeekend = [0, 6].includes(new Date().getDay());
  Logger.log(`Dia da semana: ${isWeekend ? 'Fim de semana' : 'Dia útil'}`);

  const totalTollFee = tolls.reduce((total, toll) => {
    const fee = isWeekend ? toll.fees[vehicleType].weekend : toll.fees[vehicleType].weekday;
    Logger.log(`Pedágio ${toll.name}: R$ ${fee}`);
    return total + fee;
  }, 0);

  Logger.log(`Valor total do pedágio: R$ ${totalTollFee}`);
  return totalTollFee;
}

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