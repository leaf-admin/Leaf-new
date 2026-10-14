// Busca pelas ruas: a partir do ponto de embarque, a malha (OpenStreetMap, servida pelo backend)
// é percorrida por distância real de rua (Dijkstra). As ruas são agrupadas em faixas de distância
// para a animação acender em ondas, e cada carro aparece quando a onda chega à rua dele.
// Tudo aqui é calculado uma vez por busca; a animação só mexe em opacidade e escala.

export function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function nearestNodeIndex(nodes, point) {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = haversineMeters(nodes[i], point);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return { index: best, distanceM: bestDistance };
}

// Dijkstra com heap binário; arestas sem sentido de mão (a busca anda pelas ruas, não dirige).
export function streetDistances(graph, startIndex) {
  const { nodes, edges } = graph;
  const adjacency = Array.from({ length: nodes.length }, () => []);
  for (const [a, b] of edges) {
    const w = haversineMeters(nodes[a], nodes[b]);
    adjacency[a].push([b, w]);
    adjacency[b].push([a, w]);
  }
  const dist = new Float64Array(nodes.length).fill(Infinity);
  if (startIndex < 0) return dist;
  dist[startIndex] = 0;
  const heap = [[0, startIndex]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    for (const [v, w] of adjacency[u]) {
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        push([nd, v]);
      }
    }
  }
  return dist;
}

// Distância da onda: o caminho pelas ruas, mas nunca mais que a linha reta x `detourFactor`.
// Pelas ruas, o outro lado de uma via expressa só se liga por viadutos e passarelas e ficava
// "longe" (ou nem era alcançado); assim a onda atravessa com um pequeno atraso em vez de parar.
export function waveDistances(graph, startIndex, origin, detourFactor = 1.3) {
  const street = streetDistances(graph, startIndex);
  const out = new Float64Array(graph.nodes.length);
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const straight = haversineMeters(origin, graph.nodes[i]) * detourFactor;
    out[i] = Math.min(street[i], straight);
  }
  return out;
}

// Agrupa os trechos alcançados em `bandCount` faixas de distância e devolve, para cada faixa, os
// trechos já em pixels: [[x1, y1, x2, y2], ...]. `project(lat, lng)` -> {x, y} | null.
export function buildStreetBands({ graph, dist, maxDistanceM, bandCount, project }) {
  const bands = Array.from({ length: bandCount }, () => []);
  const screen = new Array(graph.nodes.length);
  const pointOf = (i) => {
    if (screen[i] === undefined) {
      screen[i] = project(graph.nodes[i][0], graph.nodes[i][1]);
    }
    return screen[i];
  };
  for (const [a, b] of graph.edges) {
    const reach = Math.min(dist[a], dist[b]);
    if (!Number.isFinite(reach) || reach > maxDistanceM) continue;
    const pa = pointOf(a);
    const pb = pointOf(b);
    if (!pa || !pb) continue;
    const band = Math.min(bandCount - 1, Math.floor((reach / maxDistanceM) * bandCount));
    bands[band].push([pa.x, pa.y, pb.x, pb.y]);
  }
  return bands;
}

export function segmentsToSvgPath(segments) {
  let d = '';
  for (const [x1, y1, x2, y2] of segments) {
    d += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return d;
}

// Quando a onda chega a cada carro: distância de rua até o ponto da malha mais perto dele.
export function carRevealDistances({ graph, dist, cars }) {
  return cars.map((car) => {
    const point = [Number(car.latitude), Number(car.longitude)];
    const { index, distanceM } = nearestNodeIndex(graph.nodes, point);
    const street = index >= 0 ? dist[index] : Infinity;
    return { ...car, revealM: Number.isFinite(street) ? street + distanceM : Infinity };
  });
}
