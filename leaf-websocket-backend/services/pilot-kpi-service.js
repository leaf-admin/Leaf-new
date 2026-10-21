// KPIs do piloto para o dashboard e para os bots de dados (GET /api/ops/pilot-kpis).
// Só lê: corridas da coleção `rides` (Firestore), o custo por corrida do rollup diário
// de earnings e os horários do hash `booking:{id}` (Redis, vive 72 h após o fim).
// A resposta só tem agregados: nenhum id de pessoa sai daqui.
const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const backofficeCostGuardService = require('./backoffice-cost-guard-service');
const { validateAuthoritativeFinancialSnapshot } = require('./ride-financial-contract');
const { logStructured } = require('../utils/logger');

const TIME_ZONE = 'America/Sao_Paulo';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ALLOWED_DAYS = [1, 7, 30];
const RETENTION_LOOKBACK_DAYS = 70;
const BOOKING_HASH_WINDOW_MS = 72 * HOUR_MS;
const RECENT_WINDOW_MS = 2 * HOUR_MS;
const CACHE_PREFIX = 'ops:pilot_kpis:v1';
const DEFAULT_TTL_SECONDS = 300;
const RETENTION_TTL_SECONDS = 3600;

const TARGETS = Object.freeze({
  ridesPerActiveDriverPerDay: 10,
  averageTicketBrl: 29,
  passengerWaitMinutes: 5,
});

const FARE_BANDS = [
  { id: 'ate_15', label: 'até R$ 15', maxCents: 1500 },
  { id: '15_25', label: 'R$ 15 a 25', maxCents: 2500 },
  { id: '25_35', label: 'R$ 25 a 35', maxCents: 3500 },
  { id: '35_50', label: 'R$ 35 a 50', maxCents: 5000 },
  { id: 'acima_50', label: 'acima de R$ 50', maxCents: Infinity },
];

const DEFINITIONS = Object.freeze({
  motoristaAtivo: 'motorista com pelo menos 1 corrida concluída no dia',
  corridasPorMotoristaAtivoDia: 'corridas concluídas / motoristas ativos, somando os dias da janela',
  ticketMedio: 'valor pago pelo passageiro sem pedágio, só corridas com snapshot financeiro final',
  contribuicaoPorCorrida: 'taxa operacional + assinatura retida - custo variável da corrida (Google, backend, infraestrutura); a taxa de pagamento é repasse ao provedor',
  esperaPassageiro: 'Pix confirmado até o motorista marcar chegada no local (hash da corrida, últimas 72 h)',
  pedidoAteAceite: 'criação do pedido até o aceite do motorista (inclui o tempo do Pix)',
  pedidosSemAceite: 'pedidos criados que nunca tiveram motorista (inclui quem desistiu antes de pagar)',
  retencao: 'coorte pela primeira corrida concluída nos últimos 70 dias; D7 = corrida entre os dias 7 e 13 depois dela, D30 = entre os dias 30 e 36',
});

const COMPLETED_STATUSES = new Set(['COMPLETED', 'COMPLETE', 'FINISHED', 'FINALIZED', 'DONE']);
const NO_DRIVER_STATUSES = new Set(['NO_DRIVERS', 'NO_DRIVERS_AVAILABLE', 'NO_DRIVERS_FOUND', 'EXPIRED']);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : null;
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (Number.isFinite(value.seconds)) return value.seconds * 1000;
    if (Number.isFinite(value._seconds)) return value._seconds * 1000;
    return null;
  }
  const text = String(value).trim();
  if (/^\d{10,16}$/.test(text)) return text.length === 10 ? Number(text) * 1000 : Number(text);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });

function dayKey(ms) {
  return dayFormatter.format(new Date(ms));
}

function localHour(ms) {
  return Number(hourFormatter.format(new Date(ms))) % 24;
}

function daysBetween(fromDayKey, toDayKey) {
  return Math.round((Date.parse(`${toDayKey}T12:00:00Z`) - Date.parse(`${fromDayKey}T12:00:00Z`)) / DAY_MS);
}

function quantile(sortedValues, q) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function describeDurations(minutes) {
  const sorted = minutes.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { amostras: 0, mediaMin: null, medianaMin: null, p90Min: null };
  return {
    amostras: sorted.length,
    mediaMin: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length, 1),
    medianaMin: round(quantile(sorted, 0.5), 1),
    p90Min: round(quantile(sorted, 0.9), 1),
  };
}

function missing(reason) {
  return { valor: null, motivo: reason };
}

function normalizeStatus(ride) {
  return String(ride.status || '').trim().toUpperCase();
}

function isCompleted(ride) {
  return COMPLETED_STATUSES.has(normalizeStatus(ride)) && toMs(ride.completedAt) !== null;
}

function financialSnapshotOf(ride) {
  const validation = validateAuthoritativeFinancialSnapshot(ride.financialSnapshot || {});
  return validation.valid ? validation.snapshot : null;
}

// Normaliza um documento de `rides` para só o que os KPIs usam.
function normalizeRide(id, data = {}) {
  return {
    id: String(data.rideId || data.bookingId || id),
    status: normalizeStatus(data),
    passengerId: data.passengerId ? String(data.passengerId) : null,
    driverId: data.driverId ? String(data.driverId) : null,
    paymentMethod: String(data.paymentMethod || '').trim().toLowerCase() || null,
    createdAt: toMs(data.createdAt),
    acceptedAt: toMs(data.acceptedAt),
    completedAt: isCompleted(data) ? toMs(data.completedAt) : null,
    namespace: data.financialNamespace || null,
    financial: financialSnapshotOf(data),
  };
}

// Corridas da janela -> KPIs. Função pura: recebe tudo pronto para ser testável.
function computePilotKpis({
  rides = [],
  rideCostsBrl = {},
  bookingTimes = {},
  retentionRides = null,
  onlineDriversNow = null,
  days = 1,
  now = Date.now(),
} = {}) {
  const windowStart = now - days * DAY_MS;
  const production = rides.filter((ride) => ride.namespace !== 'sandbox');
  const requested = production.filter((ride) => ride.createdAt !== null && ride.createdAt >= windowStart && ride.createdAt <= now);
  const completed = production.filter((ride) => ride.completedAt !== null && ride.completedAt >= windowStart && ride.completedAt <= now);

  // Corridas por motorista ------------------------------------------------------
  const driverDays = new Map();
  const ridesByDriver = new Map();
  const byDay = new Map();
  const dayEntry = (key) => {
    if (!byDay.has(key)) {
      byDay.set(key, { data: key, pedidos: 0, aceitos: 0, concluidas: 0, motoristasAtivos: new Set(), passageiros: new Set() });
    }
    return byDay.get(key);
  };
  for (const ride of completed) {
    const key = dayKey(ride.completedAt);
    const entry = dayEntry(key);
    entry.concluidas += 1;
    if (ride.driverId) {
      entry.motoristasAtivos.add(ride.driverId);
      driverDays.set(`${key}:${ride.driverId}`, true);
      ridesByDriver.set(ride.driverId, (ridesByDriver.get(ride.driverId) || 0) + 1);
    }
  }
  for (const ride of requested) {
    const entry = dayEntry(dayKey(ride.createdAt));
    entry.pedidos += 1;
    if (ride.acceptedAt || ride.driverId) entry.aceitos += 1;
    if (ride.passengerId) entry.passageiros.add(ride.passengerId);
  }

  const driverDayCount = driverDays.size;
  const perDriver = [...ridesByDriver.values()].sort((a, b) => a - b);
  const top3 = [...perDriver].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
  const completedWithDriver = perDriver.reduce((sum, value) => sum + value, 0);

  // Ticket, faixas, contribuição e Pix ------------------------------------------
  const withSnapshot = completed.filter((ride) => ride.financial);
  const grossCents = withSnapshot.map((ride) => ride.financial.grossFareCents);
  const bands = FARE_BANDS.map((band) => ({ faixa: band.id, rotulo: band.label, corridas: 0, pct: null }));
  for (const cents of grossCents) {
    const index = FARE_BANDS.findIndex((band) => cents <= band.maxCents);
    bands[index].corridas += 1;
  }
  for (const band of bands) band.pct = grossCents.length ? round((band.corridas / grossCents.length) * 100, 1) : null;
  const upTo25 = grossCents.filter((cents) => cents <= 2500).length;

  const contributions = [];
  let leafRevenueCents = 0;
  let rideCostTotalBrl = 0;
  for (const ride of withSnapshot) {
    const revenueBrl = (ride.financial.operationalFeeCents + ride.financial.subscriptionRetainedFeeCents) / 100;
    leafRevenueCents += ride.financial.operationalFeeCents + ride.financial.subscriptionRetainedFeeCents;
    const cost = rideCostsBrl[ride.id];
    if (Number.isFinite(cost)) {
      rideCostTotalBrl += cost;
      contributions.push(revenueBrl - cost);
    }
  }

  const withMethod = completed.filter((ride) => ride.paymentMethod);
  const pix = withMethod.filter((ride) => ride.paymentMethod === 'pix').length;

  // Espera ----------------------------------------------------------------------
  const passengerWait = [];
  const recentPassengerWait = [];
  const acceptToArrival = [];
  for (const ride of requested) {
    const times = bookingTimes[ride.id];
    if (!times) continue;
    const paid = toMs(times.paymentConfirmedAt);
    const accepted = toMs(times.acceptedAt);
    const arrived = toMs(times.driverArrivedAt);
    if (paid && arrived && arrived >= paid) {
      const minutes = (arrived - paid) / 60000;
      passengerWait.push(minutes);
      if (arrived >= now - RECENT_WINDOW_MS) recentPassengerWait.push(minutes);
    }
    if (accepted && arrived && arrived >= accepted) acceptToArrival.push((arrived - accepted) / 60000);
  }
  const requestToAccept = requested
    .filter((ride) => ride.acceptedAt && ride.acceptedAt >= ride.createdAt)
    .map((ride) => (ride.acceptedAt - ride.createdAt) / 60000);

  // Oferta x demanda ------------------------------------------------------------
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hora: hour, pedidos: 0, aceitos: 0, concluidas: 0, motoristas: new Set() }));
  for (const ride of requested) {
    const slot = hours[localHour(ride.createdAt)];
    slot.pedidos += 1;
    if (ride.acceptedAt || ride.driverId) slot.aceitos += 1;
    if (ride.driverId) slot.motoristas.add(ride.driverId);
  }
  for (const ride of completed) hours[localHour(ride.completedAt)].concluidas += 1;
  const notAccepted = requested.filter((ride) => !ride.acceptedAt && !ride.driverId).length;
  const recentRequests = requested.filter((ride) => ride.createdAt >= now - RECENT_WINDOW_MS);
  const recentNotAccepted = recentRequests.filter((ride) => !ride.acceptedAt && !ride.driverId).length;
  const activeDrivers = new Set(completed.map((ride) => ride.driverId).filter(Boolean));
  const requestingPassengers = new Set(requested.map((ride) => ride.passengerId).filter(Boolean));

  const ridesPerDriverDay = driverDayCount ? completedWithDriver / driverDayCount : null;
  const averageTicket = grossCents.length ? grossCents.reduce((sum, value) => sum + value, 0) / grossCents.length / 100 : null;
  const wait = describeDurations(passengerWait);

  return {
    periodo: { dias: days, inicio: new Date(windowStart).toISOString(), fim: new Date(now).toISOString(), fuso: TIME_ZONE },
    metas: TARGETS,
    definicoes: DEFINITIONS,
    corridas: {
      pedidos: requested.length,
      concluidas: completed.length,
      motoristasAtivos: activeDrivers.size,
      motoristaDias: driverDayCount,
      corridasPorMotoristaAtivoDia: ridesPerDriverDay === null ? missing('nenhuma corrida concluída na janela') : {
        valor: round(ridesPerDriverDay, 2),
        meta: TARGETS.ridesPerActiveDriverPerDay,
        naMeta: ridesPerDriverDay >= TARGETS.ridesPerActiveDriverPerDay,
      },
      porMotorista: perDriver.length ? {
        media: round(completedWithDriver / perDriver.length, 2),
        mediana: round(quantile(perDriver, 0.5), 1),
        maximo: perDriver.at(-1),
        top3Pct: round((top3 / completedWithDriver) * 100, 1),
      } : missing('nenhuma corrida concluída com motorista'),
    },
    receita: {
      corridasComSnapshot: withSnapshot.length,
      corridasSemSnapshot: completed.length - withSnapshot.length,
      ticketMedioBrl: averageTicket === null ? missing('nenhuma corrida com snapshot financeiro final') : {
        valor: round(averageTicket, 2),
        meta: TARGETS.averageTicketBrl,
        diferencaBrl: round(averageTicket - TARGETS.averageTicketBrl, 2),
      },
      faixas: bands,
      pctAte25: grossCents.length ? round((upTo25 / grossCents.length) * 100, 1) : null,
      receitaLeafBrl: round(leafRevenueCents / 100, 2),
      custoVariavelBrl: round(rideCostTotalBrl, 2),
      contribuicaoPorCorridaBrl: contributions.length ? {
        valor: round(contributions.reduce((sum, value) => sum + value, 0) / contributions.length, 2),
        amostras: contributions.length,
        semCusto: withSnapshot.length - contributions.length,
      } : missing('sem custo por corrida no rollup diário para as corridas da janela'),
      pctPix: withMethod.length ? round((pix / withMethod.length) * 100, 1) : null,
    },
    espera: {
      passageiro: { ...wait, metaMin: TARGETS.passengerWaitMinutes, naMeta: wait.mediaMin === null ? null : wait.mediaMin < TARGETS.passengerWaitMinutes },
      passageiroUltimas2h: describeDurations(recentPassengerWait),
      aceiteAteChegada: describeDurations(acceptToArrival),
      pedidoAteAceite: describeDurations(requestToAccept),
      cobertura: days > 3 ? 'a espera do passageiro só cobre as corridas das últimas 72 h' : 'completa',
    },
    ofertaDemanda: {
      motoristasOnlineAgora: onlineDriversNow,
      motoristasAtivos: activeDrivers.size,
      passageirosQuePediram: requestingPassengers.size,
      passageirosPorMotoristaAtivo: activeDrivers.size ? round(requestingPassengers.size / activeDrivers.size, 2) : null,
      pedidosSemAceite: notAccepted,
      pctPedidosSemAceite: requested.length ? round((notAccepted / requested.length) * 100, 1) : null,
      pedidosStatusSemMotorista: requested.filter((ride) => NO_DRIVER_STATUSES.has(ride.status)).length,
      ultimas2h: {
        pedidos: recentRequests.length,
        semAceite: recentNotAccepted,
        pctSemAceite: recentRequests.length ? round((recentNotAccepted / recentRequests.length) * 100, 1) : null,
      },
      porHora: hours
        .filter((slot) => slot.pedidos || slot.concluidas)
        .map((slot) => ({ hora: slot.hora, pedidos: slot.pedidos, aceitos: slot.aceitos, concluidas: slot.concluidas, motoristas: slot.motoristas.size })),
    },
    retencao: retentionRides ? computeDriverRetention(retentionRides, now) : missing('peça days=7 ou days=30 para calcular a retenção'),
    porDia: [...byDay.values()]
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((entry) => ({
        data: entry.data,
        pedidos: entry.pedidos,
        aceitos: entry.aceitos,
        concluidas: entry.concluidas,
        motoristasAtivos: entry.motoristasAtivos.size,
        passageiros: entry.passageiros.size,
        corridasPorMotoristaAtivo: entry.motoristasAtivos.size ? round(entry.concluidas / entry.motoristasAtivos.size, 2) : null,
      })),
  };
}

function computeDriverRetention(rides = [], now = Date.now()) {
  const today = dayKey(now);
  const activeDaysByDriver = new Map();
  for (const ride of rides) {
    if (!ride.driverId || ride.completedAt === null || ride.namespace === 'sandbox') continue;
    if (!activeDaysByDriver.has(ride.driverId)) activeDaysByDriver.set(ride.driverId, new Set());
    activeDaysByDriver.get(ride.driverId).add(dayKey(ride.completedAt));
  }

  const window = (fromDay, toDay, label) => {
    let eligible = 0;
    let retained = 0;
    for (const activeDays of activeDaysByDriver.values()) {
      const sorted = [...activeDays].sort();
      const first = sorted[0];
      if (daysBetween(first, today) < toDay + 1) continue;
      eligible += 1;
      if (sorted.some((day) => {
        const offset = daysBetween(first, day);
        return offset >= fromDay && offset <= toDay;
      })) retained += 1;
    }
    if (!eligible) return missing(`nenhum motorista com primeira corrida há mais de ${toDay} dias (${label})`);
    return { valor: round((retained / eligible) * 100, 1), retidos: retained, coorte: eligible };
  };

  return {
    motoristasComCorrida: activeDaysByDriver.size,
    d7: window(7, 13, 'D7'),
    d30: window(30, 36, 'D30'),
  };
}

class PilotKpiService {
  constructor({ getFirestore = () => firebaseConfig.getFirestore(), redis = redisPool, costGuard = backofficeCostGuardService, now = () => Date.now() } = {}) {
    this.getFirestore = getFirestore;
    this.redisPool = redis;
    this.costGuard = costGuard;
    this.now = now;
    this.ttlSeconds = Math.min(Math.max(toNumber(process.env.PILOT_KPIS_CACHE_TTL_SECONDS, DEFAULT_TTL_SECONDS), 60), 3600);
  }

  async getRedis() {
    if (this.redisPool?.ensureConnection) await this.redisPool.ensureConnection();
    return this.redisPool?.getConnection ? this.redisPool.getConnection() : null;
  }

  async readCache(redis, key) {
    try {
      const cached = redis?.get ? await redis.get(key) : null;
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  }

  async writeCache(redis, key, value, ttlSeconds) {
    try {
      if (redis?.set) await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      logStructured('warn', 'Falha ao gravar cache dos KPIs do piloto', { service: 'pilot-kpis', error: error.message });
    }
  }

  async loadRides(sinceMs) {
    const firestore = this.getFirestore();
    if (!firestore) throw new Error('Firestore indisponível');
    const snapshot = await firestore.collection('rides').where('createdAt', '>=', new Date(sinceMs)).get();
    return snapshot.docs.map((doc) => normalizeRide(doc.id, doc.data()));
  }

  async loadRideCosts(redis, rides) {
    const ids = rides.filter((ride) => ride.completedAt !== null).map((ride) => ride.id);
    if (!ids.length || !redis?.mget) return {};
    const values = await redis.mget(ids.map((id) => `daily_earnings_report:ride:${id}`));
    const costs = {};
    ids.forEach((id, index) => {
      try {
        const parsed = values[index] ? JSON.parse(values[index]) : null;
        if (parsed && Number.isFinite(Number(parsed.rideCostTotalBrl))) costs[id] = Number(parsed.rideCostTotalBrl);
      } catch {
        // custo ilegível conta como sem custo
      }
    });
    return costs;
  }

  async loadBookingTimes(redis, rides, now) {
    if (!redis?.hmget) return {};
    const recent = rides.filter((ride) => ride.createdAt !== null && ride.createdAt >= now - BOOKING_HASH_WINDOW_MS);
    const entries = await Promise.all(recent.map(async (ride) => {
      const [paymentConfirmedAt, acceptedAt, driverArrivedAt] = await redis.hmget(`booking:${ride.id}`, 'paymentConfirmedAt', 'acceptedAt', 'driverArrivedAt');
      return [ride.id, { paymentConfirmedAt, acceptedAt, driverArrivedAt }];
    }));
    return Object.fromEntries(entries);
  }

  async countOnlineDrivers(redis) {
    try {
      return redis?.zcard ? await redis.zcard('driver_locations') : null;
    } catch {
      return null;
    }
  }

  async getRetentionRides(redis, now, forceRefresh) {
    const key = `${CACHE_PREFIX}:retention-rides`;
    if (!forceRefresh) {
      const cached = await this.readCache(redis, key);
      if (cached) return { rides: cached, reads: 0 };
    }
    const rides = (await this.loadRides(now - RETENTION_LOOKBACK_DAYS * DAY_MS))
      .filter((ride) => ride.completedAt !== null && ride.driverId)
      .map((ride) => ({ driverId: ride.driverId, completedAt: ride.completedAt, namespace: ride.namespace }));
    await this.writeCache(redis, key, rides, RETENTION_TTL_SECONDS);
    return { rides, reads: rides.length };
  }

  async getSnapshot({ days = 1, forceRefresh = false } = {}) {
    const window = ALLOWED_DAYS.includes(Number(days)) ? Number(days) : 1;
    const redis = await this.getRedis();
    const key = `${CACHE_PREFIX}:${window}`;
    if (!forceRefresh) {
      const cached = await this.readCache(redis, key);
      if (cached) return { ...cached, cache: 'HIT' };
    }

    const now = this.now();
    // Um dia a mais para pegar corridas criadas antes da janela e concluídas dentro dela.
    const rides = await this.loadRides(now - (window + 1) * DAY_MS);
    const [rideCostsBrl, bookingTimes, onlineDriversNow, retention] = await Promise.all([
      this.loadRideCosts(redis, rides),
      this.loadBookingTimes(redis, rides, now),
      this.countOnlineDrivers(redis),
      window >= 7 ? this.getRetentionRides(redis, now, forceRefresh) : Promise.resolve(null),
    ]);

    const snapshot = {
      generatedAt: new Date(now).toISOString(),
      ttlSeconds: this.ttlSeconds,
      ...computePilotKpis({
        rides,
        rideCostsBrl,
        bookingTimes,
        retentionRides: retention?.rides || null,
        onlineDriversNow,
        days: window,
        now,
      }),
    };
    await this.writeCache(redis, key, snapshot, this.ttlSeconds);
    try {
      await this.costGuard?.recordEndpointReadEstimate?.('ops.pilotKpis', {
        estimatedReads: rides.length + (retention?.reads || 0),
      });
    } catch {
      // o guarda de custo nunca derruba a leitura dos KPIs
    }
    return { ...snapshot, cache: 'MISS' };
  }
}

module.exports = new PilotKpiService();
module.exports.PilotKpiService = PilotKpiService;
module.exports.computePilotKpis = computePilotKpis;
module.exports.computeDriverRetention = computeDriverRetention;
module.exports.normalizeRide = normalizeRide;
module.exports.ALLOWED_DAYS = ALLOWED_DAYS;
