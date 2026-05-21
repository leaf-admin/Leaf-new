/**
 * 🏥 Health Check Routes
 * 
 * Rotas para health checks do sistema
 */

const express = require('express');
const router = express.Router();
const healthCheckService = require('../services/health-check-service');
const { logStructured, logError } = require('../utils/logger');
const { getPilotLaunchFlags } = require('../utils/pilot-launch-flags');
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'sim']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', 'nao', 'não']);

function envBool(name, fallback = false) {
  const rawValue = process.env[name];
  if (rawValue == null || rawValue === '') {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (TRUTHY_VALUES.has(normalized)) return true;
  if (FALSY_VALUES.has(normalized)) return false;
  return fallback;
}

function classifyWooviBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('sandbox')) return 'sandbox';
  if (normalized.includes('api.woovi.com')) return 'production';
  return 'custom';
}

function buildRuntimeFlagsPayload() {
  const appReview = envBool('APP_REVIEW', false);
  const wooviEnvironment = String(process.env.WOOVI_ENVIRONMENT || '').trim().toLowerCase();
  const wooviBaseUrl = String(process.env.WOOVI_BASE_URL || '').trim();
  const wooviBaseUrlMode = classifyWooviBaseUrl(wooviBaseUrl);

  const requirePaymentBeforeBooking = envBool('REQUIRE_PAYMENT_BEFORE_BOOKING', true);
  const verifyPaymentBeforeBooking = envBool('VERIFY_PAYMENT_BEFORE_BOOKING', true);
  const requirePaymentChargeRefBeforeBooking = envBool('REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING', true);
  const mockPaymentForTests = envBool('MOCK_PAYMENT_FOR_TESTS', false);
  const allowReviewMockPaymentOnCreateBooking = appReview && envBool('ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING', false);
  const paymentBypassOnWooviFailure = appReview || envBool('PAYMENT_BYPASS_ON_WOOVI_FAILURE', false);
  const paymentForceBypass = appReview || envBool('PAYMENT_FORCE_BYPASS', false);
  const authTestOtpBypassEnabled = envBool('AUTH_TEST_OTP_BYPASS_ENABLED', false);
  const authReviewOtpBypassEnabled = appReview && envBool('AUTH_REVIEW_OTP_BYPASS_ENABLED', false);

  const blockers = [];
  if (wooviEnvironment !== 'sandbox') blockers.push('WOOVI_ENVIRONMENT != sandbox');
  if (wooviBaseUrlMode !== 'sandbox') blockers.push('WOOVI_BASE_URL não aponta para sandbox');
  if (!requirePaymentBeforeBooking) blockers.push('REQUIRE_PAYMENT_BEFORE_BOOKING=false');
  if (!verifyPaymentBeforeBooking) blockers.push('VERIFY_PAYMENT_BEFORE_BOOKING=false');
  if (!requirePaymentChargeRefBeforeBooking) blockers.push('REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING=false');
  if (appReview) blockers.push('APP_REVIEW=true');
  if (mockPaymentForTests) blockers.push('MOCK_PAYMENT_FOR_TESTS=true');
  if (allowReviewMockPaymentOnCreateBooking) blockers.push('ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING=true');
  if (paymentBypassOnWooviFailure) blockers.push('PAYMENT_BYPASS_ON_WOOVI_FAILURE=true');
  if (paymentForceBypass) blockers.push('PAYMENT_FORCE_BYPASS=true');
  if (authTestOtpBypassEnabled) blockers.push('AUTH_TEST_OTP_BYPASS_ENABLED=true');
  if (authReviewOtpBypassEnabled) blockers.push('AUTH_REVIEW_OTP_BYPASS_ENABLED=true');

  return {
    success: true,
    timestamp: new Date().toISOString(),
    runtime: {
      nodeEnv: String(process.env.NODE_ENV || '').trim().toLowerCase() || 'unknown',
      appEnv: String(process.env.APP_ENV || '').trim().toLowerCase() || null,
      leafEnv: String(process.env.LEAF_ENV || '').trim().toLowerCase() || null
    },
    woovi: {
      environment: wooviEnvironment || 'unknown',
      baseUrlConfigured: Boolean(wooviBaseUrl),
      baseUrlMode: wooviBaseUrlMode
    },
    guards: {
      appReview,
      requirePaymentBeforeBooking,
      verifyPaymentBeforeBooking,
      requirePaymentChargeRefBeforeBooking,
      mockPaymentForTests,
      allowReviewMockPaymentOnCreateBooking,
      paymentBypassOnWooviFailure,
      paymentForceBypass,
      authTestOtpBypassEnabled,
      authReviewOtpBypassEnabled
    },
    launch: getPilotLaunchFlags(),
    realSandbox: {
      ready: blockers.length === 0,
      blockers
    }
  };
}

/**
 * GET /health
 * Health check completo (todos os componentes)
 */
async function fullHealthHandler(req, res) {
  try {
    // Obter io do contexto global
    const io = global.io || null;
    const health = await healthCheckService.runAllChecks(io);
    
    // Retornar status HTTP apropriado
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'warning' ? 200 : 
                      health.status === 'degraded' ? 503 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    logError(error, 'Erro ao executar health checks', {
      service: 'health-routes',
      operation: 'full-check'
    });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Erro ao verificar saúde do sistema'
    });
  }
}

router.get('/health', fullHealthHandler);
router.get('/api/health', fullHealthHandler);

/**
 * GET /health/quick
 * Health check rápido (apenas críticos)
 */
router.get('/health/quick', async (req, res) => {
  try {
    const health = await healthCheckService.quickCheck();
    
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logError(error, 'Erro ao executar health check rápido', {
      service: 'health-routes',
      operation: 'quick-check'
    });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Erro ao verificar saúde do sistema'
    });
  }
});

/**
 * GET /health/readiness
 * Readiness probe (Kubernetes/Docker)
 */
router.get('/health/readiness', async (req, res) => {
  try {
    const health = await healthCheckService.quickCheck();
    
    if (health.status === 'healthy') {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not-ready',
        timestamp: new Date().toISOString(),
        reason: 'Critical services are not healthy'
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not-ready',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * GET /health/liveness
 * Liveness probe (Kubernetes/Docker)
 */
router.get('/health/liveness', (req, res) => {
  // Liveness é sempre OK se o processo está rodando
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /health/runtime-flags
 * Diagnóstico seguro de flags de runtime para execução de testes real-sandbox.
 */
router.get('/health/runtime-flags', (req, res) => {
  res.status(200).json(buildRuntimeFlagsPayload());
});

router.get('/api/health/runtime-flags', (req, res) => {
  res.status(200).json(buildRuntimeFlagsPayload());
});

module.exports = router;
