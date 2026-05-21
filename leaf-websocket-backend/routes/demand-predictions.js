'use strict';

const express = require('express');
const { authenticateJWT, requireRole } = require('../middleware/jwt-auth');
const redisPool = require('../utils/redis-pool');
const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');
const {
  buildDemandPrediction
} = require('../services/demand-prediction-service');
const { logError, logStructured } = require('../utils/logger');
const {
  isLaunchFeatureEnabled,
  buildLaunchFeatureDisabledPayload
} = require('../utils/pilot-launch-flags');

const router = express.Router();
const DEMAND_ADMIN_ROLES = ['admin', 'super-admin', 'manager', 'development'];

function buildAuditOperator(user = {}) {
  return {
    id: user.id || user.uid || null,
    email: user.email || null,
    role: user.role || null
  };
}

function respondDemandPredictionDisabled(res) {
  return res.status(503).json(
    buildLaunchFeatureDisabledPayload(
      'demand_prediction',
      'Previsao de demanda e smart push estao desativados neste perfil de lancamento'
    )
  );
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function mapH3MetricsToCurrent(metrics = {}, fallbackCurrent = {}) {
  return {
    ...fallbackCurrent,
    openRequests: metrics.openRequests ?? metrics.demand ?? fallbackCurrent.openRequests,
    availableDrivers: metrics.availableDrivers ?? fallbackCurrent.availableDrivers,
    busyDrivers: metrics.busyDrivers ?? fallbackCurrent.busyDrivers,
    requestRate15m: fallbackCurrent.requestRate15m ?? fallbackCurrent.requestsLast15m ?? metrics.demand ?? metrics.openRequests,
    avgPickupEtaMin: fallbackCurrent.avgPickupEtaMin ?? fallbackCurrent.averagePickupEtaMin ?? 0
  };
}

async function buildPredictionInputFromRequest(body = {}) {
  const input = {
    ...(body || {})
  };

  const h3Index = String(input.h3 || '').trim();
  if (!h3Index || input.useLiveSnapshot === false) {
    return {
      input,
      dataSource: 'request_body'
    };
  }

  const resolution = toPositiveInt(
    input.h3Resolution,
    pricingH3ReadModelService.DEFAULT_RESOLUTION
  );

  try {
    const redis = redisPool.getConnection();
    const snapshot = await pricingH3ReadModelService.getAggregatedCells(redis, {
      cells: [h3Index],
      resolution
    });
    const cell = Array.isArray(snapshot?.cells)
      ? snapshot.cells.find((candidate) => candidate.h3Index === h3Index)
      : null;

    if (!snapshot?.usable || !cell?.metrics) {
      return {
        input,
        dataSource: 'request_body',
        liveSnapshot: {
          usable: false,
          reason: snapshot?.reason || 'unavailable',
          h3: h3Index,
          resolution
        }
      };
    }

    return {
      input: {
        ...input,
        current: mapH3MetricsToCurrent(cell.metrics, input.current || {}),
        liveSnapshot: {
          usable: true,
          source: 'pricing_h3_read_model',
          reason: snapshot.reason,
          h3: h3Index,
          resolution,
          updatedAt: cell.metrics.updatedAt || snapshot.lastMutationAt || null
        }
      },
      dataSource: 'pricing_h3_read_model',
      liveSnapshot: snapshot
    };
  } catch (error) {
    logError(error, {
      service: 'demand-predictions',
      operation: 'load-live-h3-snapshot',
      h3: h3Index,
      resolution
    });

    return {
      input,
      dataSource: 'request_body',
      liveSnapshot: {
        usable: false,
        reason: 'error',
        h3: h3Index,
        resolution
      }
    };
  }
}

router.post(
  '/predictions/preview',
  authenticateJWT,
  requireRole(DEMAND_ADMIN_ROLES),
  async (req, res) => {
    if (!isLaunchFeatureEnabled('demandPredictionEnabled', false)) {
      logStructured('warn', 'Preview de demanda bloqueado por feature flag', {
        service: 'demand-predictions',
        operation: 'preview',
        action: 'demand_prediction.preview.blocked',
        entity: { type: 'demand_prediction', id: req.body?.h3 || req.body?.city || null },
        operator: buildAuditOperator(req.user || {}),
        adminUserId: req.user?.id || null,
        adminRole: req.user?.role || null
      });
      return respondDemandPredictionDisabled(res);
    }

    try {
      const { input, dataSource, liveSnapshot } = await buildPredictionInputFromRequest(req.body || {});
      const prediction = buildDemandPrediction(input);
      logStructured('info', 'Preview de demanda gerado', {
        service: 'demand-predictions',
        operation: 'preview',
        action: 'demand_prediction.preview.generate',
        entity: { type: 'demand_prediction', id: prediction.area?.h3 || prediction.area?.city || null },
        operator: buildAuditOperator(req.user || {}),
        adminUserId: req.user?.id || null,
        adminRole: req.user?.role || null,
        areaH3: prediction.area?.h3 || null,
        city: prediction.area?.city || null,
        demandLevel: prediction.level,
        smartPushAllowed: prediction.smartPush?.allowed === true,
        dataSource
      });

      return res.json({
        success: true,
        dataSource,
        liveSnapshot: liveSnapshot || null,
        prediction
      });
    } catch (error) {
      logError(error, {
        service: 'demand-predictions',
        operation: 'preview',
        adminUserId: req.user?.id || null
      });
      return res.status(500).json({
        success: false,
        error: 'Erro ao gerar preview de demanda'
      });
    }
  }
);

module.exports = router;
