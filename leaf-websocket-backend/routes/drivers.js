const express = require('express');
const router = express.Router();
const redisPool = require('../utils/redis-pool');
const driverLockManager = require('../services/driver-lock-manager');
const { getPolicyForDriver } = require('../services/driver-destination-mode-service');
const { validateAuthoritativeFinancialSnapshot } = require('../services/ride-financial-contract');
const { requireFirebaseUser, requireFirebaseSelf } = require('../middleware/firebase-user-auth');
const { getOperationalDayKey } = require('../services/driver-online-time-policy-service');
const {
  AVOIDED_AREAS_H3_RESOLUTION,
  MAX_AVOIDED_AREAS,
  MAX_AVOIDED_CELLS,
  MAX_AVOIDED_LABEL_LENGTH,
  buildAreaOutline,
  buildAvoidedAreasPatch,
  cellsAroundPoint,
  normalizeAvoidedPoint
} = require('../services/driver-avoided-areas-service');
const { findBairroAt, getBairroById, toBairroView } = require('../services/rio-bairros-service');
const demandHistoryService = require('../services/demand-history-service');
const { getFinancialCollections } = require('../services/financial-runtime-context');
const {
  resolveUserPersistenceScope,
  assertStoredRecordMatchesScope
} = require('../services/sandbox-persistence-context');
const { authenticateJWT, requireRole } = require('../middleware/jwt-auth');
const { logger, logStructured, logError } = require('../utils/logger');
const userStore = require('../services/user-store');
const DRIVER_APPLICATION_ADMIN_ROLES = ['admin', 'super-admin', 'manager', 'support', 'development'];
const requireDriverApplicationAdmin = [authenticateJWT, requireRole(DRIVER_APPLICATION_ADMIN_ROLES)];
// Dado pessoal do motorista: exige ID token do Firebase e só o próprio motorista (uid do token == :id) acessa.
const requireDriverSelf = [requireFirebaseUser, requireFirebaseSelf((req) => req.params?.id)];
const LEGACY_DRIVER_APPLICATION_MUTATIONS_ENABLED = false;

// Firebase integration
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'drivers-routes' });
}

// Middleware para verificar se Firebase está configurado
const requireFirebase = (req, res, next) => {
  if (!firebaseConfig) {
    return res.status(500).json({
      error: 'Firebase não configurado',
      message: 'Sistema de aprovação indisponível'
    });
  }
  next();
};

// Cadastro dos motoristas na coleção nativa `users` (services/user-store).
function usersFirestore() {
  return firebaseConfig?.getFirestore?.() || null;
}

function parseObjectCandidate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function firstObjectCandidate(...values) {
  for (const value of values) {
    const candidate = parseObjectCandidate(value);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

// Estados terminais em que a corrida é liquidada e creditada ao motorista
// (ver RideStateManager.STATES). Ficam de fora os cancelamentos, EARLY_ENDED_REVIEW
// (liquidação manual, sem crédito automático) e INTERRUPTED_OPERATIONAL_ENDED
// (encerramento sem snapshot financeiro final do backend).
const DRIVER_PAID_RIDE_STATUSES = new Set(['COMPLETED', 'EARLY_ENDED_BY_RIDER']);
const EARLY_ENDED_BY_RIDER_STATUS = 'EARLY_ENDED_BY_RIDER';
// Encerramento antecipado pelo motorista (flag): a corrida continua COMPLETED e o
// completionType só indica que o valor liquidado é o do trecho percorrido.
const EARLY_ENDED_BY_DRIVER_COMPLETION_TYPE = 'EARLY_ENDED_BY_DRIVER';
const EARNINGS_REPORT_WINDOW_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Valor executado (em centavos) de uma corrida encerrada antecipadamente, quando o
// settlement foi persistido junto da corrida. Retorna undefined se não houver.
function resolveExecutedFareCents(booking = {}) {
  const settlement = parseObjectCandidate(booking.settlement);
  const executedFare = Number(settlement?.executedFare);
  if (!Number.isFinite(executedFare) || executedFare <= 0) {
    return undefined;
  }
  return Math.round(executedFare * 100);
}

function resolveBackendFinalFinancialSnapshot(booking = {}, expected = {}) {
  const financialBreakdown = parseObjectCandidate(booking.financialBreakdown) || {};
  const paymentDistribution = parseObjectCandidate(booking.paymentDistribution) || {};
  const paymentCalculation = parseObjectCandidate(paymentDistribution.calculation) || {};
  const candidate = firstObjectCandidate(
    booking.financialSnapshot,
    booking.financialContract,
    financialBreakdown.financialSnapshot,
    financialBreakdown.financialContract,
    paymentDistribution.financialSnapshot,
    paymentCalculation.financialContract,
    paymentCalculation.financialSnapshot
  );
  const validation = validateAuthoritativeFinancialSnapshot(candidate || {}, expected);
  return validation.valid ? validation.snapshot : null;
}

// Fuso do relatório de ganhos: o dia vira à meia-noite de Brasília, não no fuso do processo.
const DEFAULT_REPORT_TIME_ZONE = 'America/Sao_Paulo';

function getReportTimeZone() {
  return String(process.env.LEAF_REPORT_TIME_ZONE || '').trim() || DEFAULT_REPORT_TIME_ZONE;
}

// Chave YYYY-MM-DD do dia de calendário `daysBack` dias antes de `dayKey`.
function shiftDayKey(dayKey, daysBack) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - daysBack)).toISOString().slice(0, 10);
}

function toValidDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  // Timestamp do Firestore (completedAt/cancelledAt da coleção de corridas).
  if (typeof value === 'object' && !(value instanceof Date)) {
    if (typeof value.toDate === 'function') {
      return toValidDate(value.toDate());
    }
    const seconds = Number(value._seconds ?? value.seconds);
    return Number.isFinite(seconds) ? toValidDate(seconds * 1000) : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Momento que define o dia da corrida no relatório: a conclusão (completedAt, ou o tripend
// legado) quando a corrida gravada tem esse carimbo; senão, os mesmos campos de antes.
function resolveBookingReportDate(booking = {}) {
  const completionDate = toValidDate(booking.completedAt) || toValidDate(booking.tripend);
  if (completionDate) {
    return completionDate;
  }

  return toValidDate(
    booking.tripdate ||
    booking.updatedAt ||
    booking.createdAt ||
    booking.created_on ||
    booking.timestamp ||
    null
  );
}

function centsToBrl(cents) {
  const amount = Number(cents);
  return Number.isFinite(amount) ? Math.max(0, amount) / 100 : 0;
}

function isMissingFirestoreIndexError(error) {
  return (
    error?.code === 9 ||
    String(error?.code || '').toLowerCase() === 'failed-precondition' ||
    String(error?.message || '').includes('FAILED_PRECONDITION')
  );
}

// Corridas do motorista na coleção de corridas do namespace dele (`rides` ou
// `sandbox_rides`): é onde a finalização grava status, completedAt e o snapshot
// financeiro final.
//
// A consulta usa só o índice automático de `driverId`. O recorte de tempo vem do ID do
// documento (`booking_<epoch ms>_<passageiro>`), com um dia de folga antes da janela;
// o dia de cada corrida continua sendo decidido por completedAt/cancelledAt. Um filtro
// por completedAt exigiria índice composto, que não existe.
async function loadDriverRidesForEarningsReport(firestore, persistenceScope, driverId, windowDays) {
  const driverRidesQuery = firestore
    .collection(persistenceScope.collections.rides)
    .where('driverId', '==', driverId);
  const oldestBookingId = `booking_${Date.now() - (windowDays + 1) * DAY_IN_MS}`;

  let snapshot;
  try {
    snapshot = await driverRidesQuery.where('__name__', '>=', oldestBookingId).get();
  } catch (error) {
    if (!isMissingFirestoreIndexError(error)) {
      throw error;
    }
    // Sem o recorte por ID o resultado é o mesmo; só lê o histórico inteiro do motorista.
    logger.warn(`⚠️ [DriversRoute] Recorte por ID indisponível no relatório de ganhos de ${driverId}: ${error.message}`);
    snapshot = await driverRidesQuery.get();
  }

  const rides = [];
  snapshot.forEach((doc) => {
    const ride = doc.data() || {};
    try {
      // Sandbox exige o mesmo contexto selado; operacional nunca lê registro sandbox.
      assertStoredRecordMatchesScope(ride, persistenceScope);
    } catch (_error) {
      return;
    }
    rides.push(ride);
  });
  return rides;
}

// Prefixo do rideId gravado no crédito de saldo de multa de cancelamento/no-show
// (PaymentService.processCancellationDistribution credita sob `cancel_<rideId>`).
const CANCELLATION_CREDIT_RIDE_ID_PREFIX = 'cancel_';
const CANCELLATION_DISTRIBUTION_STATUS = 'distributed_cancellation';

function toPositiveIntegerCents(value) {
  const cents = Number(value);
  return Number.isInteger(cents) && cents > 0 ? cents : null;
}

// Créditos de multa de cancelamento/no-show do motorista na janela do relatório.
//
// A fonte é o extrato do saldo (`<driver_balances>/<motorista>/transactions`): o documento
// é gravado na mesma transação que soma o saldo, então existe se, e só se, o motorista
// recebeu. A corrida cancelada não guarda taxa nem crédito.
//
// Custo: uma consulta por faixa no campo `rideId` (índice automático de campo único), que
// lê apenas os créditos `cancel_booking_<epoch ms>...` da janela, e, havendo créditos, uma
// leitura em lote das distribuições dessas corridas para saber a multa cobrada do
// passageiro. Sem a distribuição o bruto é o próprio crédito (retido desconhecido = 0).
async function loadDriverCancellationCreditsForEarningsReport(firestore, persistenceScope, driverId, windowDays) {
  const { collections } = getFinancialCollections(persistenceScope.financialContext);
  const oldestCreditRideId =
    `${CANCELLATION_CREDIT_RIDE_ID_PREFIX}booking_${Date.now() - (windowDays + 1) * DAY_IN_MS}`;
  const snapshot = await firestore
    .collection(collections.driverBalances)
    .doc(driverId)
    .collection('transactions')
    .where('rideId', '>=', oldestCreditRideId)
    .where('rideId', '<=', `${CANCELLATION_CREDIT_RIDE_ID_PREFIX}booking_`)
    .get();

  const credits = [];
  snapshot.forEach((doc) => {
    const transaction = doc.data() || {};
    try {
      // Mesmo isolamento das corridas: sandbox exige o contexto selado; operacional nunca lê sandbox.
      assertStoredRecordMatchesScope(transaction, persistenceScope);
    } catch (_error) {
      return;
    }
    const creditCents = toPositiveIntegerCents(transaction.amountInCents);
    const creditRideId = String(transaction.rideId || '');
    const settledAt = toValidDate(transaction.createdAt);
    if (
      String(transaction.type || '') !== 'credit' ||
      creditCents === null ||
      !settledAt ||
      !creditRideId.startsWith(CANCELLATION_CREDIT_RIDE_ID_PREFIX)
    ) {
      return;
    }
    credits.push({
      rideId: creditRideId.slice(CANCELLATION_CREDIT_RIDE_ID_PREFIX.length),
      creditCents,
      grossCents: creditCents,
      settledAt
    });
  });

  if (credits.length === 0 || typeof firestore.getAll !== 'function') {
    return credits;
  }

  try {
    const distributionRefs = credits.map((credit) =>
      firestore.collection(collections.paymentDistributions).doc(credit.rideId)
    );
    const distributionDocs = await firestore.getAll(...distributionRefs);
    distributionDocs.forEach((doc, index) => {
      if (!doc?.exists) {
        return;
      }
      const distribution = doc.data() || {};
      const credit = credits[index];
      try {
        assertStoredRecordMatchesScope(distribution, persistenceScope);
      } catch (_error) {
        return;
      }
      const chargedCents = toPositiveIntegerCents(parseObjectCandidate(distribution.calculation)?.totalAmount);
      if (
        distribution.status !== CANCELLATION_DISTRIBUTION_STATUS ||
        distribution.driverId !== driverId ||
        toPositiveIntegerCents(distribution.netAmount) !== credit.creditCents ||
        chargedCents === null ||
        chargedCents < credit.creditCents
      ) {
        return;
      }
      credit.grossCents = chargedCents;
    });
  } catch (error) {
    // O crédito já é conhecido pelo extrato; só a multa cobrada fica sem detalhe.
    logger.warn(`⚠️ [DriversRoute] Distribuições de multa indisponíveis no relatório de ganhos de ${driverId}: ${error.message}`);
  }

  return credits;
}

// 🚗 DRIVER APPROVAL APIs

router.get('/api/drivers/me/destination-policy', requireFirebaseUser, async (req, res) => {
  try {
    const driverId = req.authenticatedUser.uid;
    const redis = redisPool.getConnection();
    const driverState = await redis.hgetall(`driver:${driverId}`).catch(() => ({}));
    const policy = await getPolicyForDriver({
      redis,
      driverId,
      driverState
    });

    return res.json({
      success: true,
      driverId,
      policy
    });
  } catch (error) {
    logError(error, '❌ Erro ao buscar política de destino do motorista:', { service: 'drivers-routes' });
    return res.status(500).json({
      success: false,
      error: 'Não foi possível carregar os destinos de caminho agora.'
    });
  }
});

// 🚫 ÁREAS EVITADAS: o motorista marca áreas onde não quer receber ofertas.
// `driver_avoided_areas:{uid}` é a fonte da verdade; `avoidedH3Cells` no hash `driver:{uid}` é uma cópia para o shortlist.
// Mapa de demanda com histórico (materializado pelo pricing-baseline-worker). Só leitura do Redis.
router.get('/api/drivers/me/demand-heat', requireFirebaseUser, async (req, res) => {
  try {
    if (String(process.env.ENABLE_DEMAND_HISTORY_HEAT || 'true') === 'false') {
      return res.json({ success: true, enabled: false, cells: [] });
    }
    const heat = await demandHistoryService.getDemandHeat(redisPool.getConnection());
    res.set('Cache-Control', 'private, max-age=120');
    return res.json({
      success: true,
      enabled: true,
      generatedAt: heat?.generatedAt || null,
      cells: Array.isArray(heat?.cells) ? heat.cells : []
    });
  } catch (error) {
    logError(error, 'Falha ao ler mapa de demanda histórica', { service: 'drivers-route' });
    return res.json({ success: true, enabled: true, generatedAt: null, cells: [] });
  }
});

router.get('/api/drivers/me/avoided-areas', requireFirebaseUser, async (req, res) => {
  try {
    const driverId = req.authenticatedUser.uid;
    const redis = redisPool.getConnection();
    const rawStored = await redis.get(`driver_avoided_areas:${driverId}`);
    let stored = null;
    try {
      stored = rawStored ? JSON.parse(rawStored) : null;
    } catch (error) {
      stored = null;
    }

    return res.json({
      success: true,
      cells: Array.isArray(stored?.cells) ? stored.cells : [],
      areas: Array.isArray(stored?.areas) ? stored.areas : [],
      maxCells: MAX_AVOIDED_CELLS,
      maxAreas: MAX_AVOIDED_AREAS,
      resolution: AVOIDED_AREAS_H3_RESOLUTION,
      updatedAt: stored?.updatedAt || null
    });
  } catch (error) {
    logError(error, '❌ Erro ao buscar áreas evitadas do motorista:', { service: 'drivers-routes' });
    return res.status(500).json({
      success: false,
      error: 'Não foi possível carregar as áreas evitadas agora.'
    });
  }
});

// Qual bairro fica neste ponto do mapa (toque para selecionar o bairro inteiro).
router.get('/api/drivers/me/avoided-areas/bairro', requireFirebaseUser, (req, res) => {
  const bairro = toBairroView(findBairroAt(req.query.lat, req.query.lng));
  return res.json({ success: true, bairro });
});

router.put('/api/drivers/me/avoided-areas', requireFirebaseUser, async (req, res) => {
  try {
    const driverId = req.authenticatedUser.uid;
    const rawAreas = req.body?.areas;

    if (!Array.isArray(rawAreas)) {
      return res.status(400).json({
        success: false,
        code: 'AVOIDED_AREAS_INVALID',
        error: 'Informe a lista de áreas evitadas.'
      });
    }

    if (rawAreas.length > MAX_AVOIDED_AREAS) {
      return res.status(400).json({
        success: false,
        code: 'AVOIDED_AREAS_LIMIT_EXCEEDED',
        error: `Você pode evitar no máximo ${MAX_AVOIDED_AREAS} áreas.`
      });
    }

    const areas = [];
    const bairroIds = [];
    const distinctCells = new Set();
    for (let index = 0; index < rawAreas.length; index += 1) {
      const rawArea = rawAreas[index] || {};

      // Bairro inteiro, pelo código oficial.
      if (rawArea.bairroId !== undefined && rawArea.bairroId !== null && String(rawArea.bairroId).trim() !== '') {
        const bairro = toBairroView(getBairroById(rawArea.bairroId));
        if (!bairro) {
          return res.status(400).json({
            success: false,
            code: 'AVOIDED_AREA_INVALID',
            error: 'Bairro não encontrado.'
          });
        }
        if (!bairroIds.includes(bairro.id)) {
          bairroIds.push(bairro.id);
          areas.push({
            id: `bairro_${bairro.id}`,
            type: 'bairro',
            bairroId: bairro.id,
            label: bairro.name,
            center: bairro.center,
            outline: bairro.outline
          });
        }
        continue;
      }

      const center = normalizeAvoidedPoint(rawArea.center);
      const ringSize = rawArea.ringSize === undefined || rawArea.ringSize === null
        ? 0
        : Number(rawArea.ringSize);

      if (!center || ![0, 1, 2].includes(ringSize)) {
        return res.status(400).json({
          success: false,
          code: 'AVOIDED_AREA_INVALID',
          error: 'Cada área evitada precisa de centro válido e raio entre 0 e 2.'
        });
      }

      const cells = cellsAroundPoint(center.lat, center.lng, ringSize);
      cells.forEach((cell) => distinctCells.add(cell));
      areas.push({
        id: String(rawArea.id ?? '').trim().slice(0, 64) || `area_${index + 1}`,
        type: 'free',
        label: String(rawArea.label ?? '').trim().slice(0, MAX_AVOIDED_LABEL_LENGTH),
        center,
        ringSize,
        cells,
        outline: buildAreaOutline(cells)
      });
    }

    if (distinctCells.size > MAX_AVOIDED_CELLS) {
      return res.status(400).json({
        success: false,
        code: 'AVOIDED_AREAS_LIMIT_EXCEEDED',
        error: `As áreas evitadas somam ${distinctCells.size} células; o limite é ${MAX_AVOIDED_CELLS}.`
      });
    }

    const cells = [...distinctCells];
    const updatedAt = new Date().toISOString();
    const redis = redisPool.getConnection();
    // Fonte da verdade (sem TTL): é o que o dispatcher consulta antes de ofertar.
    await redis.set(
      `driver_avoided_areas:${driverId}`,
      JSON.stringify({ cells, bairros: bairroIds, areas, updatedAt })
    );
    // Cópia no hash do motorista só se ele existir: criar o hash aqui deixaria um
    // registro de motorista incompleto e sem TTL.
    if (await redis.exists(`driver:${driverId}`)) {
      await redis.hset(`driver:${driverId}`, buildAvoidedAreasPatch(cells, updatedAt, bairroIds));
    }

    return res.json({
      success: true,
      cells,
      areas,
      maxCells: MAX_AVOIDED_CELLS,
      maxAreas: MAX_AVOIDED_AREAS,
      resolution: AVOIDED_AREAS_H3_RESOLUTION,
      updatedAt
    });
  } catch (error) {
    logError(error, '❌ Erro ao salvar áreas evitadas do motorista:', { service: 'drivers-routes' });
    return res.status(500).json({
      success: false,
      error: 'Não foi possível salvar as áreas evitadas agora.'
    });
  }
});

// GET /api/drivers/applications - Listar aplicações de motoristas
router.get('/api/drivers/applications', requireDriverApplicationAdmin, requireFirebase, async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'all', search = '' } = req.query;

    logStructured('info', '📋 Buscando aplicações de motoristas:', { page, limit, status, search }, { service: 'drivers-routes' });

    const storage = firebaseConfig.getStorage();

    // Buscar usuários do Firebase
    const users = await userStore.listUsers(usersFirestore());

    // Filtrar apenas motoristas
    let driverApplications = Object.keys(users)
      .map(uid => ({ uid, ...users[uid] }))
      .filter(user => user.usertype === 'driver' || user.profileSelection?.userType === 'driver');

    // Aplicar filtros
    if (status !== 'all') {
      driverApplications = driverApplications.filter(driver => {
        if (status === 'pending') return !driver.isApproved && !driver.isRejected;
        if (status === 'approved') return driver.isApproved === true;
        if (status === 'rejected') return driver.isRejected === true;
        if (status === 'analyzing') return driver.documents && Object.values(driver.documents).some(doc => doc.status === 'analyzing');
        return true;
      });
    }

    // Aplicar busca
    if (search) {
      const searchLower = search.toLowerCase();
      driverApplications = driverApplications.filter(driver =>
        (driver.name && driver.name.toLowerCase().includes(searchLower)) ||
        (driver.email && driver.email.toLowerCase().includes(searchLower)) ||
        (driver.phone && driver.phone.toLowerCase().includes(searchLower)) ||
        (driver.cpf && driver.cpf.includes(search))
      );
    }

    // Paginação
    const total = driverApplications.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedApplications = driverApplications.slice(startIndex, endIndex);

    // Enriquecer com dados de documentos
    const enrichedApplications = await Promise.all(
      paginatedApplications.map(async (driver) => {
        try {
          // Buscar documentos do usuário
          const documents = await userStore.readUserField(usersFirestore(), driver.uid, 'documents') || {};

          // Buscar dados do veículo
          const vehicle = await userStore.readUserField(usersFirestore(), driver.uid, 'vehicles/current') || {};

          // Determinar status da aplicação
          let applicationStatus = 'pending';
          if (driver.isApproved === true) applicationStatus = 'approved';
          else if (driver.isRejected === true) applicationStatus = 'rejected';
          else if (Object.values(documents).some(doc => doc.status === 'analyzing')) applicationStatus = 'in_review';

          // Calcular score baseado na completude dos dados
          let score = 0;
          if (driver.name) score += 20;
          if (driver.email) score += 15;
          if (driver.phone) score += 15;
          if (driver.cpf) score += 20;
          if (documents.cnh) score += 15;
          if (documents.residence) score += 15;

          return {
            id: driver.uid,
            driver: {
              id: driver.uid,
              name: driver.name || driver.displayName || 'Nome não informado',
              email: driver.email || 'Email não informado',
              phone: driver.phone || 'Telefone não informado',
              cpf: driver.cpf || 'CPF não informado',
              birthDate: driver.birthDate || driver.dateOfBirth || driver.dob || null,
              motherName: driver.motherName || driver.nomeMae || null,
              gender: driver.gender || driver.genero || null,
              address: {
                street: driver.address?.street || 'Endereço não informado',
                city: driver.city || 'Cidade não informada',
                state: driver.state || 'Estado não informado',
                zipCode: driver.zipCode || 'CEP não informado'
              },
              profilePhoto: driver.profilePhoto || undefined
            },
            vehicle: {
              id: vehicle.id || 'vehicle_1',
              brand: vehicle.brand || 'Marca não informada',
              model: vehicle.model || 'Modelo não informado',
              year: parseInt(vehicle.year) || 2020,
              color: vehicle.color || 'Cor não informada',
              plate: vehicle.plate || 'Placa não informada',
              category: vehicle.category || 'economy',
              features: {
                airConditioning: vehicle.features?.airConditioning || false,
                doors: vehicle.features?.doors || 4,
                capacity: vehicle.features?.capacity || 5
              },
              documents: vehicle.documents || []
            },
            documents: Object.keys(documents).map(docType => ({
              id: `${driver.uid}_${docType}`,
              type: docType,
              name: `${docType.toUpperCase()} - ${driver.name || 'Motorista'}`,
              url: documents[docType].fileUrl || documents[docType].url || '',
              uploadDate: documents[docType].uploadedAt || documents[docType].uploadDate || new Date().toISOString().split('T')[0],
              status: documents[docType].status || 'pending',
              rejectionReason: documents[docType].rejectionReason
            })),
            status: applicationStatus,
            applicationDate: driver.createdAt || new Date().toISOString().split('T')[0],
            reviewDate: driver.reviewDate,
            reviewedBy: driver.reviewedBy,
            notes: driver.adminNotes,
            rejectionReasons: driver.rejectionReasons || [],
            score: score,
            previousRejections: parseInt(driver.previousRejections) || 0
          };
        } catch (error) {
          logError(error, `❌ Erro ao processar motorista ${driver.uid}:`, { service: 'drivers-routes' });
          return null;
        }
      })
    );

    // Filtrar aplicações válidas
    const validApplications = enrichedApplications.filter(app => app !== null);

    // Calcular estatísticas
    const stats = {
      pending: validApplications.filter(app => app.status === 'pending').length,
      inReview: validApplications.filter(app => app.status === 'in_review').length,
      approved: validApplications.filter(app => app.status === 'approved').length,
      rejected: validApplications.filter(app => app.status === 'rejected').length,
      total: total,
      approvalRate: total > 0 ? ((validApplications.filter(app => app.status === 'approved').length / total) * 100).toFixed(1) : 0
    };

    logStructured('info', `✅ Aplicações encontradas: ${validApplications.length}/${total}`, { service: 'drivers-routes' });

    res.json({
      applications: validApplications,
      summary: stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logError(error, '❌ Erro ao buscar aplicações de motoristas:', { service: 'drivers-routes' });
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// POST /api/drivers/applications/:id/approve - Aprovar motorista
router.post('/api/drivers/applications/:id/approve', requireDriverApplicationAdmin, requireFirebase, async (req, res) => {
  if (!LEGACY_DRIVER_APPLICATION_MUTATIONS_ENABLED) {
    return res.status(410).json({
      success: false,
      code: 'LEGACY_DRIVER_APPLICATION_MUTATION_DISABLED',
      error: 'Aprovação em massa legada está desativada. Revise documentos individualmente e use o fluxo canônico de ativação.'
    });
  }

  try {
    const { id } = req.params;
    const { notes, adminNotes } = req.body;

    logStructured('info', `✅ Aprovando motorista ${id}:`, { notes, adminNotes }, { service: 'drivers-routes' });

    // Atualizar status do motorista
    await userStore.updateUser(usersFirestore(), id, {
      isApproved: true,
      isRejected: false,
      reviewDate: new Date().toISOString(),
      reviewedBy: 'admin', // Em produção seria o ID do admin logado
      adminNotes: adminNotes || notes,
      status: 'approved'
    });

    // Atualizar status dos documentos para aprovados
    const documents = await userStore.readUserField(usersFirestore(), id, 'documents') || {};

    const documentUpdates = {};
    Object.keys(documents).forEach(docType => {
      documentUpdates[`documents/${docType}/status`] = 'approved';
      documentUpdates[`documents/${docType}/reviewedAt`] = new Date().toISOString();
      documentUpdates[`documents/${docType}/reviewedBy`] = 'admin';
    });

    if (Object.keys(documentUpdates).length > 0) {
      await userStore.updateUser(usersFirestore(), id, documentUpdates);
    }

    // Atualizar status do veículo se existir
    const vehicle = await userStore.readUserField(usersFirestore(), id, 'vehicles/current');
    if (vehicle) {
      await userStore.updateUser(usersFirestore(), id, {
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewedBy: 'admin'
      }, 'vehicles/current');
    }

    logStructured('info', `✅ Motorista ${id} aprovado com sucesso`, { service: 'drivers-routes' });

    // Emitir evento WebSocket para notificar motorista
    if (req.app.locals.io) {
      req.app.locals.io.emit('driver_status_updated', {
        uid: id,
        status: 'approved',
        message: 'Seus documentos foram aprovados! Você já pode começar a dirigir.',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Motorista aprovado com sucesso',
      driverId: id,
      status: 'approved'
    });

  } catch (error) {
    logError(error, `❌ Erro ao aprovar motorista ${req.params.id}:`, { service: 'drivers-routes' });
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// POST /api/drivers/applications/:id/reject - Rejeitar motorista
router.post('/api/drivers/applications/:id/reject', requireDriverApplicationAdmin, requireFirebase, async (req, res) => {
  if (!LEGACY_DRIVER_APPLICATION_MUTATIONS_ENABLED) {
    return res.status(410).json({
      success: false,
      code: 'LEGACY_DRIVER_APPLICATION_MUTATION_DISABLED',
      error: 'Rejeição em massa legada está desativada. Use a revisão individual de documentos com motivo auditável.'
    });
  }

  try {
    const { id } = req.params;
    const { notes, rejectionReasons, adminNotes } = req.body;

    logStructured('info', `❌ Rejeitando motorista ${id}:`, { notes, rejectionReasons, adminNotes }, { service: 'drivers-routes' });

    // Atualizar status do motorista
    await userStore.updateUser(usersFirestore(), id, {
      isApproved: false,
      isRejected: true,
      reviewDate: new Date().toISOString(),
      reviewedBy: 'admin', // Em produção seria o ID do admin logado
      adminNotes: adminNotes || notes,
      rejectionReasons: rejectionReasons || [],
      status: 'rejected'
    });

    // Atualizar status dos documentos para rejeitados
    const documents = await userStore.readUserField(usersFirestore(), id, 'documents') || {};

    const documentUpdates = {};
    Object.keys(documents).forEach(docType => {
      documentUpdates[`documents/${docType}/status`] = 'rejected';
      documentUpdates[`documents/${docType}/reviewedAt`] = new Date().toISOString();
      documentUpdates[`documents/${docType}/reviewedBy`] = 'admin';
      documentUpdates[`documents/${docType}/rejectionReason`] = rejectionReasons?.join(', ') || 'Documento rejeitado';
    });

    if (Object.keys(documentUpdates).length > 0) {
      await userStore.updateUser(usersFirestore(), id, documentUpdates);
    }

    // Atualizar status do veículo se existir
    const vehicle = await userStore.readUserField(usersFirestore(), id, 'vehicles/current');
    if (vehicle) {
      await userStore.updateUser(usersFirestore(), id, {
        status: 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewedBy: 'admin',
        rejectionReason: rejectionReasons?.join(', ') || 'Veículo rejeitado'
      }, 'vehicles/current');
    }

    logStructured('info', `✅ Motorista ${id} rejeitado com sucesso`, { service: 'drivers-routes' });

    // Emitir evento WebSocket para notificar motorista
    if (req.app.locals.io) {
      req.app.locals.io.emit('driver_status_updated', {
        uid: id,
        status: 'rejected',
        message: `Seus documentos foram rejeitados. Motivos: ${rejectionReasons?.join(', ') || 'Documentos não atendem aos requisitos'}`,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Motorista rejeitado com sucesso',
      driverId: id,
      status: 'rejected',
      rejectionReasons
    });

  } catch (error) {
    logError(error, `❌ Erro ao rejeitar motorista ${req.params.id}:`, { service: 'drivers-routes' });
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// GET /api/drivers/applications/:id - Buscar aplicação específica
router.get('/api/drivers/applications/:id', requireDriverApplicationAdmin, requireFirebase, async (req, res) => {
  try {
    const { id } = req.params;

    logStructured('info', `📋 Buscando aplicação do motorista ${id}`, { service: 'drivers-routes' });

    // Buscar dados do motorista
    const user = await userStore.readUser(usersFirestore(), id);
    if (!user) {
      return res.status(404).json({
        error: 'Motorista não encontrado',
        message: 'ID do motorista inválido'
      });
    }

    // Buscar documentos
    const documents = await userStore.readUserField(usersFirestore(), id, 'documents') || {};

    // Buscar veículo
    const vehicle = await userStore.readUserField(usersFirestore(), id, 'vehicles/current') || {};

    // Determinar status
    let applicationStatus = 'pending';
    if (user.isApproved === true) applicationStatus = 'approved';
    else if (user.isRejected === true) applicationStatus = 'rejected';
    else if (Object.values(documents).some(doc => doc.status === 'analyzing')) applicationStatus = 'in_review';

    const application = {
      id: id,
      driver: {
        id: id,
        name: user.name || user.displayName || 'Nome não informado',
        email: user.email || 'Email não informado',
        phone: user.phone || 'Telefone não informado',
        cpf: user.cpf || 'CPF não informado',
        birthDate: user.birthDate || user.dateOfBirth || user.dob || null,
        motherName: user.motherName || user.nomeMae || null,
        gender: user.gender || user.genero || null,
        address: {
          street: user.address?.street || 'Endereço não informado',
          city: user.city || 'Cidade não informada',
          state: user.state || 'Estado não informado',
          zipCode: user.zipCode || 'CEP não informado'
        },
        profilePhoto: user.profilePhoto || undefined
      },
      vehicle: {
        id: vehicle.id || 'vehicle_1',
        brand: vehicle.brand || 'Marca não informada',
        model: vehicle.model || 'Modelo não informado',
        year: parseInt(vehicle.year) || 2020,
        color: vehicle.color || 'Cor não informada',
        plate: vehicle.plate || 'Placa não informada',
        category: vehicle.category || 'economy',
        features: {
          airConditioning: vehicle.features?.airConditioning || false,
          doors: vehicle.features?.doors || 4,
          capacity: vehicle.features?.capacity || 5
        },
        documents: vehicle.documents || []
      },
      documents: Object.keys(documents).map(docType => ({
        id: `${id}_${docType}`,
        type: docType,
        name: `${docType.toUpperCase()} - ${user.name || 'Motorista'}`,
        url: documents[docType].fileUrl || documents[docType].url || '',
        uploadDate: documents[docType].uploadedAt || documents[docType].uploadDate || new Date().toISOString().split('T')[0],
        status: documents[docType].status || 'pending',
        rejectionReason: documents[docType].rejectionReason
      })),
      status: applicationStatus,
      applicationDate: user.createdAt || new Date().toISOString().split('T')[0],
      reviewDate: user.reviewDate,
      reviewedBy: user.reviewedBy,
      notes: user.adminNotes,
      rejectionReasons: user.rejectionReasons || [],
      score: 0, // Será calculado
      previousRejections: parseInt(user.previousRejections) || 0
    };

    logStructured('info', `✅ Aplicação do motorista ${id} encontrada`, { service: 'drivers-routes' });

    res.json(application);

  } catch (error) {
    logError(error, `❌ Erro ao buscar aplicação do motorista ${req.params.id}:`, { service: 'drivers-routes' });
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// ✅ NOVO: GET /api/drivers/nearby - Buscar motoristas próximos usando Redis GEO + status + lock
// A rota devolve posição de motoristas. O app passa a enviar o ID token; a exigência é ligada por
// NEARBY_REQUIRE_AUTH=true só depois que a versão do app com o token estiver distribuída, para não
// apagar os carros do mapa de quem ainda usa a versão anterior.
const requireNearbyDriversAuth = (req, res, next) => {
  if (process.env.NEARBY_REQUIRE_AUTH !== 'true') {
    return next();
  }
  return requireFirebaseUser(req, res, next);
};

router.get('/api/drivers/nearby', requireNearbyDriversAuth, async (req, res) => {
  try {
    // Sem os headers: eles carregam o token do usuário.
    logger.info(`🔍 [DriversRoute] Requisição recebida: ${req.method} ${req.path}`, {
      query: req.query
    });

    const { lat, lng, radius = 5, limit = 10 } = req.query;

    // Validar parâmetros
    if (!lat || !lng) {
      logger.warn('⚠️ [DriversRoute] Parâmetros inválidos: lat ou lng ausentes');
      return res.status(400).json({
        error: 'Parâmetros inválidos',
        message: 'lat e lng são obrigatórios'
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusKm = parseFloat(radius);
    const limitNum = parseInt(limit);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusKm) || isNaN(limitNum)) {
      return res.status(400).json({
        error: 'Parâmetros inválidos',
        message: 'lat, lng, radius e limit devem ser números válidos'
      });
    }

    const eligibleDriverGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
    const allDriverGeoKey = process.env.ALL_DRIVER_GEO_KEY || 'driver_locations';
    const allowFallbackPool = process.env.NEARBY_ALLOW_FALLBACK_POOL === 'true';
    let activeGeoKey = eligibleDriverGeoKey;

    logger.info(`🔍 [DriversRoute] Buscando motoristas próximos: lat=${latitude}, lng=${longitude}, radius=${radiusKm}km, limit=${limitNum}, geoKey=${activeGeoKey}`);

    const redis = redisPool.getConnection();

    // ✅ Garantir que Redis está conectado
    if (redis.status !== 'ready' && redis.status !== 'connect') {
      logger.warn('⚠️ [DriversRoute] Redis não está conectado, tentando conectar...');
      await redis.connect();
    }

    // ✅ Verificar total de motoristas no GEO antes da busca
    const totalDriversBefore = await redis.zcard(activeGeoKey);
    logger.info(`📊 [DriversRoute] Total de motoristas no Redis GEO (${activeGeoKey}) antes da busca: ${totalDriversBefore}`);

    // 1. Buscar motoristas próximos usando Redis GEO
    let nearbyDrivers = await redis.georadius(
      activeGeoKey,
      longitude,
      latitude,
      radiusKm,
      'km',
      'WITHCOORD',
      'WITHDIST',
      'COUNT',
      limitNum * 2 // Buscar mais para filtrar por status e lock
    );

    logger.info(`🔍 [DriversRoute] Redis GEO encontrou ${nearbyDrivers?.length || 0} motoristas em ${radiusKm}km`);
    logger.debug(`🔍 [DriversRoute] Resultado do georadius:`, {
      type: typeof nearbyDrivers,
      isArray: Array.isArray(nearbyDrivers),
      length: nearbyDrivers?.length,
      firstItem: nearbyDrivers?.[0]
    });

    if (!nearbyDrivers || nearbyDrivers.length === 0) {
      logger.warn(`⚠️ [DriversRoute] Nenhum motorista encontrado em ${radiusKm}km no pool ${activeGeoKey}`);

      let testResult = [];
      if (allowFallbackPool && activeGeoKey !== allDriverGeoKey) {
        activeGeoKey = allDriverGeoKey;
        logger.warn(`⚠️ [DriversRoute] Fallback habilitado. Reexecutando busca em ${activeGeoKey}`);
        testResult = await redis.georadius(
          activeGeoKey,
          longitude,
          latitude,
          radiusKm,
          'km',
          'WITHCOORD',
          'WITHDIST',
          'COUNT',
          limitNum * 2
        );
        nearbyDrivers = Array.isArray(testResult) ? testResult : [];
      }

      if (!nearbyDrivers || nearbyDrivers.length === 0) {
        const totalDrivers = await redis.zcard(activeGeoKey);
        logger.info(`📊 [DriversRoute] Total de motoristas no Redis GEO (${activeGeoKey}): ${totalDrivers}`);

        // ✅ Testar georadius sem COUNT para ver se retorna algo
        testResult = await redis.georadius(
          activeGeoKey,
          longitude,
          latitude,
          radiusKm,
          'km',
          'WITHCOORD',
          'WITHDIST'
        );
        logger.info(`🧪 [DriversRoute] Teste sem COUNT em ${activeGeoKey} retornou: ${testResult?.length || 0} motoristas`);

        return res.json({
          drivers: [],
          count: 0,
          source: 'redis_geo',
          geoKey: activeGeoKey,
          debug: {
            totalDriversInRedis: totalDrivers,
            searchRadius: radiusKm,
            testWithoutCount: testResult?.length || 0
          }
        });
      }
    }

    // 2. Filtrar motoristas disponíveis (status + lock)
    const availableDrivers = [];

    for (const driver of nearbyDrivers) {
      const driverId = driver[0];
      const distance = parseFloat(driver[1]);
      const coordinates = {
        lng: parseFloat(driver[2][0]),
        lat: parseFloat(driver[2][1])
      };

      // Verificar se motorista está disponível (lock)
      const lockStatus = await driverLockManager.isDriverLocked(driverId);
      if (lockStatus.isLocked) {
        logger.debug(`🔒 [DriversRoute] Driver ${driverId} está ocupado (lock)`);
        continue; // Motorista ocupado
      }

      // Buscar dados do motorista (status, rating, etc)
      // Usar hash do Redis se disponível, senão buscar do Firebase
      const driverDataKey = `driver:${driverId}`;
      const driverData = await redis.hgetall(driverDataKey);

      logger.debug(`🔍 [DriversRoute] Driver ${driverId} - Redis data:`, {
        hasRedisData: !!driverData && Object.keys(driverData).length > 0,
        redisKeys: driverData ? Object.keys(driverData) : [],
        redisStatus: driverData?.status,
        redisIsOnline: driverData?.isOnline
      });

      // Se não tiver dados no Redis, buscar do Firebase (fallback)
      let driverInfo = null;
      if (!driverData || Object.keys(driverData).length === 0) {
        logger.debug(`⚠️ [DriversRoute] Driver ${driverId} não tem dados no Redis, buscando Firebase...`);
        if (firebaseConfig) {
          try {
            const user = await userStore.readUser(usersFirestore(), driverId);
            if (user) {
              driverInfo = {
                id: driverId,
                firstName: user.firstName || user.name || '',
                lastName: user.lastName || '',
                isOnline: user.isOnline || false,
                status: user.status || 'OFFLINE',
                rating: parseFloat(user.driverRating || user.rating || 5.0),
	                carType: user.carType || null,
	                vehicleNumber: user.vehicleNumber || null,
	                vehicleColor:
	                  user.vehicleColor ||
	                  user.carColor ||
	                  user.vehicle?.color ||
	                  user.car?.color ||
	                  null
	              };
              logger.debug(`✅ [DriversRoute] Driver ${driverId} encontrado no Firebase:`, {
                isOnline: driverInfo.isOnline,
                status: driverInfo.status
              });
            } else {
              logger.warn(`⚠️ [DriversRoute] Driver ${driverId} não encontrado no Firebase`);
            }
          } catch (firebaseError) {
            logger.warn(`⚠️ [DriversRoute] Erro ao buscar dados do Firebase para ${driverId}:`, firebaseError.message);
          }
        }
      } else {
        // Usar dados do Redis
        driverInfo = {
          id: driverId,
          firstName: driverData.firstName || '',
          lastName: driverData.lastName || '',
          isOnline: driverData.isOnline === 'true' || driverData.isOnline === true,
          status: driverData.status || 'OFFLINE',
	          rating: parseFloat(driverData.rating || 5.0),
	          carType: driverData.carType || null,
	          vehicleNumber: driverData.vehicleNumber || null,
	          vehicleColor:
	            driverData.vehicleColor ||
	            driverData.carColor ||
	            driverData.vehicle_color ||
	            driverData.car_color ||
	            null
	        };
        logger.debug(`✅ [DriversRoute] Driver ${driverId} usando dados do Redis:`, {
          isOnline: driverInfo.isOnline,
          status: driverInfo.status,
          rawIsOnline: driverData.isOnline
        });
      }

      // Verificar se motorista está online e disponível
      if (!driverInfo) {
        logger.warn(`⚠️ [DriversRoute] Driver ${driverId} não tem informações (nem Redis nem Firebase)`);
        continue;
      }

      // ✅ Verificação mais flexível de status
      const isOnline = driverInfo.isOnline === true || driverInfo.isOnline === 'true';
      const isAvailable = driverInfo.status === 'AVAILABLE' || driverInfo.status === 'available' || driverInfo.status === 'ONLINE';

      if (!isOnline || !isAvailable) {
        logger.debug(`⚠️ [DriversRoute] Driver ${driverId} não está disponível:`, {
          isOnline: driverInfo.isOnline,
          status: driverInfo.status,
          isOnlineCheck: isOnline,
          isAvailableCheck: isAvailable
        });
        continue;
      }

      availableDrivers.push({
        id: driverId,
        location: coordinates,
        distance: parseFloat((distance * 1000).toFixed(2)), // Converter km para metros
        firstName: driverInfo.firstName,
        lastName: driverInfo.lastName,
	        rating: driverInfo.rating,
	        carType: driverInfo.carType,
	        vehicleNumber: driverInfo.vehicleNumber,
	        vehicleColor: driverInfo.vehicleColor || null,
	        source: 'redis_geo',
        geoKey: activeGeoKey
      });

      // Limitar ao número solicitado
      if (availableDrivers.length >= limitNum) {
        break;
      }
    }

    // 3. Ordenar por distância
    availableDrivers.sort((a, b) => a.distance - b.distance);

    logger.info(`✅ [DriversRoute] ${availableDrivers.length} motoristas disponíveis encontrados`);

    res.json({
      drivers: availableDrivers,
      count: availableDrivers.length,
      source: 'redis_geo',
      geoKey: activeGeoKey,
      query: {
        lat: latitude,
        lng: longitude,
        radius: radiusKm,
        limit: limitNum
      }
    });

  } catch (error) {
    logger.error('❌ [DriversRoute] Erro ao buscar motoristas próximos:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// ✅ NOVO: GET /api/drivers/:id/earnings - Relatório de Ganhos para o Mobile
router.get('/api/drivers/:id/earnings', requireDriverSelf, requireFirebase, async (req, res) => {
  try {
    const { id } = req.params;
    const firestore = usersFirestore();

    // 1. Buscar usuário
    const user = firestore ? await userStore.readUser(firestore, id) : null;
    if (firestore && !user) {
      return res.status(404).json({ success: false, message: 'Motorista não encontrado' });
    }

    // 2. Namespace financeiro do motorista (operacional ou sandbox), como na lista de
    // recibos da Atividade. Sem classificação segura o relatório não responde: zeros
    // aqui seriam lidos pelo app como ganho real.
    let persistenceScope = null;
    if (firestore) {
      try {
        persistenceScope = await resolveUserPersistenceScope({
          userId: id,
          phone: req.authenticatedUser?.phoneNumber || null,
          actor: req.authenticatedUser || null
        });
      } catch (scopeError) {
        logger.error(`❌ [DriversRoute] Namespace financeiro indisponível para o relatório de ganhos de ${id}: ${scopeError.message}`);
      }
    }
    if (!persistenceScope) {
      return res.status(503).json({
        success: false,
        code: 'EARNINGS_REPORT_SOURCE_UNAVAILABLE',
        message: 'Relatório de ganhos indisponível no momento'
      });
    }

    // 3. O nó legado `cars` do RTDB nunca existiu nesta base: sem carro, como já era.
    const driverCar = null;

    // 4. Buscar viagens na fonte que recebe as corridas liquidadas
    const dailyWindowDays = EARNINGS_REPORT_WINDOW_DAYS;
    const allDriverBookings = await loadDriverRidesForEarningsReport(firestore, persistenceScope, id, dailyWindowDays);

    // Multas de cancelamento/no-show creditadas ao motorista. Se o extrato não responder,
    // o relatório segue com as corridas e avisa em `cancellationCreditsAvailable`.
    let cancellationCredits = [];
    let cancellationCreditsAvailable = true;
    try {
      cancellationCredits = await loadDriverCancellationCreditsForEarningsReport(
        firestore,
        persistenceScope,
        id,
        dailyWindowDays
      );
    } catch (creditsError) {
      cancellationCreditsAvailable = false;
      logger.error(`❌ [DriversRoute] Créditos de multa de cancelamento indisponíveis no relatório de ganhos de ${id}: ${creditsError.message}`);
    }

    const reportTimeZone = getReportTimeZone();
    const toDateKey = date => getOperationalDayKey(date.getTime(), reportTimeZone);
    const todayKey = toDateKey(new Date());

    const dailySeriesMap = {};
    for (let i = dailyWindowDays - 1; i >= 0; i--) {
      const dateKey = shiftDayKey(todayKey, i);
      dailySeriesMap[dateKey] = {
        date: dateKey,
        day: dateKey.slice(8, 10),
        amount: 0,
        grossAmount: 0,
        feeAmount: 0,
        completedCount: 0,
        cancelledCount: 0,
        cancellationCreditAmount: 0,
        color: '#A5D6A7'
      };
    }

    let tripsTodayCount = 0;
    let totalCompletedRides = 0;
    let totalCancellations = 0;
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let totalFeeAmount = 0;
    let totalCancellationCreditAmount = 0;
    let financialSnapshotPendingCount = 0;

    allDriverBookings.forEach(booking => {
      const status = String(booking?.status || '').toUpperCase();
      const isCompleted = DRIVER_PAID_RIDE_STATUSES.has(status);
      const isCancelled = status.includes('CANCEL');
      if (!isCompleted && !isCancelled) {
        return;
      }

      const tripDate =
        (isCancelled ? toValidDate(booking?.cancelledAt) : null) ||
        resolveBookingReportDate(booking || {});
      if (!tripDate) {
        return;
      }

      const dateKey = toDateKey(tripDate);
      const seriesSlot = dailySeriesMap[dateKey];
      if (!seriesSlot) {
        return;
      }

      if (isCancelled) {
        seriesSlot.cancelledCount += 1;
        totalCancellations += 1;
        return;
      }

      // No encerramento antecipado vale o líquido liquidado sobre o valor executado, nunca o
      // contratado: um snapshot que não bate com o settlement fica pendente em vez de somar.
      const expectedSnapshot = {};
      const completionType = String(booking?.completionType || '').toUpperCase();
      if (status === EARLY_ENDED_BY_RIDER_STATUS || completionType === EARLY_ENDED_BY_DRIVER_COMPLETION_TYPE) {
        const executedFareCents = resolveExecutedFareCents(booking);
        if (executedFareCents !== undefined) {
          expectedSnapshot.passengerPaidCents = executedFareCents;
        }
      }
      const finalFinancialSnapshot = resolveBackendFinalFinancialSnapshot(booking, expectedSnapshot);
      if (!finalFinancialSnapshot) {
        financialSnapshotPendingCount += 1;
        seriesSlot.financialSnapshotPendingCount = (seriesSlot.financialSnapshotPendingCount || 0) + 1;
        return;
      }

      const netAmount = centsToBrl(finalFinancialSnapshot.driverNetAmountCents);
      const feeAmount = centsToBrl(finalFinancialSnapshot.retainedTotalCents);
      const effectiveGrossAmount = centsToBrl(finalFinancialSnapshot.passengerPaidCents);

      seriesSlot.amount += netAmount;
      seriesSlot.grossAmount += effectiveGrossAmount;
      seriesSlot.feeAmount += feeAmount;
      seriesSlot.completedCount += 1;

      totalCompletedRides += 1;
      totalGrossAmount += effectiveGrossAmount;
      totalNetAmount += netAmount;
      totalFeeAmount += feeAmount;

      if (dateKey === todayKey) {
        tripsTodayCount += 1;
      }
    });

    // Multa creditada entra no ganho do dia em que foi liquidada (crédito no saldo). Não é
    // corrida concluída: as contagens ficam como estão e o cancelamento já foi contado acima.
    // Bruto = multa cobrada do passageiro; taxa = a parte não repassada ao motorista.
    cancellationCredits.forEach(credit => {
      const seriesSlot = dailySeriesMap[toDateKey(credit.settledAt)];
      if (!seriesSlot) {
        return;
      }

      const creditAmount = centsToBrl(credit.creditCents);
      const chargedAmount = centsToBrl(credit.grossCents);
      const retainedAmount = centsToBrl(credit.grossCents - credit.creditCents);

      seriesSlot.amount += creditAmount;
      seriesSlot.grossAmount += chargedAmount;
      seriesSlot.feeAmount += retainedAmount;
      seriesSlot.cancellationCreditAmount += creditAmount;

      totalNetAmount += creditAmount;
      totalGrossAmount += chargedAmount;
      totalFeeAmount += retainedAmount;
      totalCancellationCreditAmount += creditAmount;
    });

    const dailySeries = Object.values(dailySeriesMap).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const dailyEarningsArray = dailySeries.slice(-7).map(item => ({
      day: item.day,
      amount: item.amount,
      color: item.color
    }));
    const effectiveFeePct = totalGrossAmount > 0 ? (totalFeeAmount / totalGrossAmount) * 100 : 0;

    const report = {
      balance: parseFloat(user.walletBalance || 0),
      rating: parseFloat(user.driverRating || user.rating || 5.0).toFixed(1),
      tripsToday: tripsTodayCount,
      hoursOnline: parseFloat(user.hoursOnline || 0).toFixed(1),
      activeCar: driverCar ? {
        brand: driverCar.carMake || '',
        model: driverCar.carModel || '',
        year: driverCar.carYear || '',
        engine: driverCar.carType || ''
      } : null,
      dailyEarnings: dailyEarningsArray,
      dailySeries,
      totalCompletedRides,
      totalCancellations,
      totalGrossAmount,
      totalNetAmount,
      totalFeeAmount,
      totalCancellationCreditAmount,
      cancellationCreditsAvailable,
      effectiveFeePct,
      financialSnapshotPendingCount,
      dailySeriesWindowDays: dailyWindowDays
    };

    res.json({ success: true, report });

  } catch (error) {
    logger.error(`❌ [DriversRoute] Erro ao buscar ganhos do motorista ${req.params.id}:`, error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor', error: error.message });
  }
});

module.exports = router;
