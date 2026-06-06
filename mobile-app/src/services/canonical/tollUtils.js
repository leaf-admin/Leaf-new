import Logger from '../../utils/Logger';
import Polyline from '@mapbox/polyline';


// Função para decodificar polyline em waypoints { latitude, longitude }
export function decodePolyline(routePolyline) {
  const decodedCoords = Polyline.decode(routePolyline); // [[lat, lng], ...]
  return decodedCoords.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
}

// Função para calcular distância Haversine entre dois pontos (em km)
export function haversineDistance(a, b) {
  const toRad = x => x * Math.PI / 180;
  const R = 6371; // km
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const aVal = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.sin(dLng/2) * Math.sin(dLng/2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1-aVal));
  return R * c;
}

// Função para calcular a menor distância de um ponto a um segmento
export function distanceToSegment(p, v, w) {
  // p: ponto {latitude, longitude}, v e w: pontos {latitude, longitude}
  // Retorna a menor distância do ponto p ao segmento vw
  const toRad = x => x * Math.PI / 180;
  const R = 6371; // km
  function toXY(coord) {
    return {
      x: R * Math.cos(toRad(coord.latitude)) * Math.cos(toRad(coord.longitude)),
      y: R * Math.cos(toRad(coord.latitude)) * Math.sin(toRad(coord.longitude))
    };
  }
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

// Função para determinar o sentido da rota (em graus)
function bearing(from, to) {
  const toRad = x => x * Math.PI / 180;
  const toDeg = x => x * 180 / Math.PI;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let brng = Math.atan2(y, x);
  brng = toDeg(brng);
  return (brng + 360) % 360;
}

// Função para determinar o sentido da viagem em relação a um ponto específico
function determinarSentidoEmRelacaoAoPonto(waypoints, pontoReferencia) {
  if (waypoints.length < 2) return null;
  
  // Encontra o ponto mais próximo do pedágio
  let pontoMaisProximo = waypoints[0];
  let distanciaMinima = Infinity;
  let indicePonto = 0;
  
  for (let i = 0; i < waypoints.length; i++) {
    const ponto = waypoints[i];
    const distancia = haversineDistance(ponto, pontoReferencia);
    if (distancia < distanciaMinima) {
      distanciaMinima = distancia;
      pontoMaisProximo = ponto;
      indicePonto = i;
    }
  }
  
  // Pega o ponto anterior e posterior ao ponto mais próximo
  const pontoAnterior = indicePonto > 0 ? waypoints[indicePonto - 1] : pontoMaisProximo;
  const pontoPosterior = indicePonto < waypoints.length - 1 ? waypoints[indicePonto + 1] : pontoMaisProximo;
  
  // Calcula o bearing entre os pontos
  const brng = bearing(pontoAnterior, pontoPosterior);
  
  // Determina o sentido baseado no bearing
  if (brng >= 315 || brng < 45) return 'Norte';
  if (brng >= 45 && brng < 135) return 'Leste';
  if (brng >= 135 && brng < 225) return 'Sul';
  if (brng >= 225 && brng < 315) return 'Oeste';
  
  return null;
}

// Função para verificar se o sentido da rota corresponde ao sentido do pedágio
function sentidoCorresponde(pedagio, waypoints) {
  // Se o pedágio é bidirecional, sempre retorna true
  if (!pedagio.Sentido || pedagio.Sentido.toLowerCase() === 'bidirecional') return true;
  
  // Ponto de referência do pedágio
  const pontoReferencia = {
    latitude: parseFloat(pedagio.Latitude),
    longitude: parseFloat(pedagio.Longitude)
  };
  
  // Determina o sentido da viagem em relação ao pedágio
  const sentidoViagem = determinarSentidoEmRelacaoAoPonto(waypoints, pontoReferencia);
  Logger.log(`Sentido da viagem em relação ao pedágio ${pedagio['Praça de Pedágio']}:`, sentidoViagem);
  
  // Mapeamento de sentidos para direções específicas
  const direcoes = {
    'Norte': ['Norte', 'Sul->Norte', 'Barra->Boiuna'],
    'Sul': ['Sul', 'Norte->Sul', 'Boiuna->Barra'],
    'Leste': ['Leste', 'Oeste->Leste'],
    'Oeste': ['Oeste', 'Leste->Oeste']
  };
  
  // Verifica se o sentido do pedágio corresponde ao sentido da viagem
  const sentidosValidos = direcoes[sentidoViagem] || [];
  const corresponde = sentidosValidos.some(sentido => 
    pedagio.Sentido.toLowerCase().includes(sentido.toLowerCase())
  );
  
  Logger.log(`Pedágio ${pedagio['Praça de Pedágio']} - Sentido: ${pedagio.Sentido}, Viagem: ${sentidoViagem}, Corresponde: ${corresponde}`);
  return corresponde;
}

// Função para detectar pedágios cruzados pela rota (ponto ou segmento, considerando sentido)
export function pedagiosNaRota(waypoints, pedagios, toleranciaKm = 0.5) {
  return pedagios.filter(pedagio => {
    // Nome e valor do pedágio
    const nomePedagio = pedagio['Praça de Pedágio'] || pedagio.Praça || pedagio.id || 'Sem nome';
    const valorPedagio = pedagio['Tarifa Automóvel (R$)'] || pedagio.valor || 0;
    
    // Caso segmento (start/end)
    if (pedagio.start && pedagio.end) {
      for (let i = 0; i < waypoints.length - 1; i++) {
        const v = waypoints[i];
        const w = waypoints[i + 1];
        const distStart = distanceToSegment({ latitude: pedagio.start.lat, longitude: pedagio.start.lng }, v, w);
        const distEnd = distanceToSegment({ latitude: pedagio.end.lat, longitude: pedagio.end.lng }, v, w);
        if ((distStart <= toleranciaKm || distEnd <= toleranciaKm) && sentidoCorresponde(pedagio, waypoints)) {
          Logger.log(`Pedágio segmento cruzado: ${nomePedagio} | Sentido: ${pedagio.Sentido || 'N/A'} | Valor: ${valorPedagio}`);
          return true;
        }
      }
      return false;
    } else if (pedagio.Latitude && pedagio.Longitude) {
      for (let i = 0; i < waypoints.length - 1; i++) {
        const ponto = waypoints[i];
        const proximo = waypoints[i + 1];
        const dist = haversineDistance(ponto, { latitude: parseFloat(pedagio.Latitude), longitude: parseFloat(pedagio.Longitude) });
        if (dist <= toleranciaKm && sentidoCorresponde(pedagio, waypoints)) {
          Logger.log(`Pedágio ponto cruzado: ${nomePedagio} | Sentido: ${pedagio.Sentido || 'N/A'} | Valor: ${valorPedagio}`);
          return true;
        }
      }
      return false;
    }
    return false;
  });
}

// Função para somar o valor dos pedágios cruzados (para automóvel)
export function somaValorPedagios(pedagiosCruzados) {
  return pedagiosCruzados.reduce((soma, p) => soma + parseFloat(p['Tarifa Automóvel (R$)'] || p.valor || 0), 0);
}

// Função utilitária principal: dado polyline e array de pedágios, retorna lista de pedágios cruzados e valor total
export function calcularPedagiosPorPolyline(routePolyline, pedagios, toleranciaKm = 0.5) {
  const waypoints = decodePolyline(routePolyline);
  const pedagiosCruzados = pedagiosNaRota(waypoints, pedagios, toleranciaKm);
  const valorTotal = somaValorPedagios(pedagiosCruzados);
  return { pedagiosCruzados, valorTotal };
} 