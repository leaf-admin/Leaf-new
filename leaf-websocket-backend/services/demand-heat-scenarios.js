'use strict';

// Cenários simulados do mapa de calor do motorista (Zona Sul do Rio).
//
// Cada cenário descreve pedidos de corrida por ponto, separados em "histórico" (mesma hora nas
// semanas anteriores) e "recente" (últimas horas de hoje). O cenário grava esses pedidos nos
// mesmos contadores que o recordRideRequest usa e roda o materializeDemandHeat de verdade.
// Serve para testar a regra (o que aparece, quando e com que força) sem pedido real, e para
// gerar uma prévia para o celular de QA (DEMAND_HEAT_PREVIEW_UIDS) sem tocar no calor real.

const demandHistoryService = require('./demand-history-service');

const { bucketKey, localParts } = demandHistoryService.helpers;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Pontos de referência (centro aproximado do bairro/ponto).
const PLACES = Object.freeze({
  copacabanaPostoCinco: { lat: -22.9785, lng: -43.1893, label: 'Copacabana (Posto 5)' },
  copacabanaLeme: { lat: -22.9635, lng: -43.1726, label: 'Leme' },
  botafogoPraia: { lat: -22.9469, lng: -43.1828, label: 'Botafogo' },
  flamengo: { lat: -22.9329, lng: -43.1756, label: 'Flamengo' },
  ipanemaPraca: { lat: -22.9844, lng: -43.2016, label: 'Ipanema (Praça N. Sra. da Paz)' },
  leblonBaixo: { lat: -22.9845, lng: -43.2236, label: 'Leblon (Baixo Leblon)' },
  baixoGavea: { lat: -22.9757, lng: -43.2297, label: 'Baixo Gávea' },
  jockey: { lat: -22.9737, lng: -43.2248, label: 'Jockey Club' },
  humaitaCobal: { lat: -22.9555, lng: -43.1962, label: 'Cobal do Humaitá' },
  lapaArcos: { lat: -22.9132, lng: -43.1800, label: 'Lapa (Arcos)' },
  santosDumont: { lat: -22.9105, lng: -43.1631, label: 'Aeroporto Santos Dumont' },
  urca: { lat: -22.9493, lng: -43.1643, label: 'Urca' }
});

// Espalha pedidos em volta do ponto (até ~150 m), sem aleatoriedade: o teste é reprodutível.
function jitter(place, index) {
  const angle = (index * 137.508 * Math.PI) / 180;
  const radius = 0.0004 * ((index % 4) + 1) / 4;
  return { lat: place.lat + Math.sin(angle) * radius, lng: place.lng + Math.cos(angle) * radius };
}

// now: horário de referência do cenário (UTC). Rio = UTC-3.
const SCENARIOS = Object.freeze({
  manha_dia_util: {
    title: 'Dia útil, 8h: saída para o trabalho',
    now: '2026-11-18T11:00:00.000Z', // quarta 08:00 no Rio
    history: [
      { place: 'copacabanaPostoCinco', perWeek: 9 },
      { place: 'botafogoPraia', perWeek: 7 },
      { place: 'ipanemaPraca', perWeek: 6 },
      { place: 'flamengo', perWeek: 4 },
      { place: 'leblonBaixo', perWeek: 3 }
    ],
    recent: [{ place: 'copacabanaPostoCinco', count: 3 }]
  },
  sabado_noite: {
    title: 'Sábado, 23h: saída de bares',
    now: '2026-11-22T02:00:00.000Z', // sábado 23:00 no Rio
    history: [
      { place: 'baixoGavea', perWeek: 10 },
      { place: 'lapaArcos', perWeek: 8 },
      { place: 'humaitaCobal', perWeek: 6 },
      { place: 'leblonBaixo', perWeek: 4 }
    ],
    recent: [{ place: 'baixoGavea', count: 4 }]
  },
  terca_noite: {
    title: 'Terça, 23h: noite fraca (mesmo histórico de sábado não deve aparecer)',
    now: '2026-11-19T02:00:00.000Z', // terça 23:00 no Rio
    history: [{ place: 'copacabanaPostoCinco', perWeek: 2 }],
    recent: [],
    // Sábados anteriores com bar cheio: não podem vazar para a terça.
    otherDays: [{ place: 'baixoGavea', count: 12, daysBack: 3 }]
  },
  chuva_repentina: {
    title: 'Chuva forte agora no Leblon, sem histórico',
    now: '2026-11-20T20:30:00.000Z', // quinta 17:30 no Rio
    history: [{ place: 'botafogoPraia', perWeek: 3 }],
    recent: [{ place: 'leblonBaixo', count: 14 }, { place: 'ipanemaPraca', count: 6 }]
  },
  evento_unico: {
    title: 'Evento no Jockey só na semana passada',
    now: '2026-11-21T00:00:00.000Z', // quinta 21:00 no Rio
    history: [{ place: 'copacabanaPostoCinco', perWeek: 5 }],
    recent: [],
    oneOff: [{ place: 'jockey', count: 20, weeksBack: 1 }]
  },
  pedido_isolado: {
    title: 'Pedidos isolados (privacidade: não podem aparecer)',
    now: '2026-11-18T15:00:00.000Z',
    history: [{ place: 'urca', perWeek: 0.5 }],
    recent: [{ place: 'santosDumont', count: 2 }]
  },
  sem_dados: {
    title: 'Cidade sem nenhum pedido ainda',
    now: '2026-11-18T15:00:00.000Z',
    history: [],
    recent: []
  },
  ponto_dominante: {
    title: 'Aeroporto domina, bairros fracos continuam visíveis',
    now: '2026-11-18T22:00:00.000Z', // terça 19:00 no Rio
    history: [
      { place: 'santosDumont', perWeek: 40 },
      { place: 'flamengo', perWeek: 3 },
      { place: 'botafogoPraia', perWeek: 3 }
    ],
    recent: []
  }
});

async function addRequests(redis, at, place, count, offset = 0) {
  const location = PLACES[place];
  if (!location) throw new Error(`Ponto desconhecido no cenário: ${place}`);
  const { dateKey, hour } = localParts(at);
  for (let index = 0; index < count; index += 1) {
    const cell = require('h3-js').latLngToCell(
      jitter(location, offset + index).lat,
      jitter(location, offset + index).lng,
      demandHistoryService.helpers.RESOLUTION
    );
    await redis.hincrby(bucketKey(dateKey, hour), cell, 1);
  }
}

/** Grava os pedidos do cenário nos contadores por hora (mesmo formato do recordRideRequest). */
async function seedScenario(redis, name, { weeks = 4 } = {}) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Cenário desconhecido: ${name}`);
  const now = new Date(scenario.now);

  for (const item of scenario.history || []) {
    for (let week = 1; week <= weeks; week += 1) {
      // perWeek fracionário: só algumas semanas têm pedido (ex.: 0,5 = uma a cada duas semanas).
      const count = Number.isInteger(item.perWeek)
        ? item.perWeek
        : (week % Math.round(1 / item.perWeek) === 0 ? 1 : 0);
      if (count > 0) {
        await addRequests(redis, new Date(now.getTime() - week * 7 * DAY_MS), item.place, count, week * 10);
      }
    }
  }
  for (const item of scenario.recent || []) {
    await addRequests(redis, new Date(now.getTime() - 20 * 60 * 1000), item.place, item.count, 500);
  }
  for (const item of scenario.oneOff || []) {
    await addRequests(redis, new Date(now.getTime() - item.weeksBack * 7 * DAY_MS), item.place, item.count, 700);
  }
  for (const item of scenario.otherDays || []) {
    await addRequests(redis, new Date(now.getTime() - item.daysBack * DAY_MS), item.place, item.count, 900);
  }
  return now;
}

/** Nome do ponto mais perto do centro da célula (para relatório e teste). */
function nearestPlace(center) {
  let best = null;
  for (const [key, place] of Object.entries(PLACES)) {
    const distance = Math.hypot(place.lat - center.lat, place.lng - center.lng);
    if (!best || distance < best.distance) best = { key, label: place.label, distance };
  }
  return best && best.distance < 0.01 ? best : null;
}

// Redis em memória com o mínimo que o mapa de calor usa.
function createMemoryRedis() {
  const hashes = new Map();
  const strings = new Map();
  return {
    async hincrby(key, field, by) {
      const hash = hashes.get(key) || {};
      hash[field] = String((Number(hash[field]) || 0) + Number(by));
      hashes.set(key, hash);
      return Number(hash[field]);
    },
    async hgetall(key) {
      return { ...(hashes.get(key) || {}) };
    },
    async expire() {
      return 1;
    },
    async set(key, value) {
      strings.set(key, value);
      return 'OK';
    },
    async get(key) {
      return strings.has(key) ? strings.get(key) : null;
    }
  };
}

/** Roda o cenário isolado em memória e devolve o calor com o ponto de cada célula. */
async function runScenario(name) {
  const redis = createMemoryRedis();
  const now = await seedScenario(redis, name);
  await demandHistoryService.materializeDemandHeat(redis, { now });
  const heat = await demandHistoryService.getDemandHeat(redis);
  const cells = (heat?.cells || []).map((cell) => ({ ...cell, place: nearestPlace(cell.center)?.key || null }));
  return { name, title: SCENARIOS[name].title, now: now.toISOString(), heat: { ...heat, cells } };
}

module.exports = {
  PLACES,
  SCENARIOS,
  seedScenario,
  runScenario,
  createMemoryRedis,
  nearestPlace
};
