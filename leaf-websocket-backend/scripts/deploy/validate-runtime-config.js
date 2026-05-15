#!/usr/bin/env node
/**
 * Runtime config validator for soft release.
 * - Confirma separação sandbox/prod para Woovi
 * - Valida presença das variáveis críticas de pagamento/pix
 * - Exibe alertas de CORS e OTEL
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const REQUIRED_COMMON = [
  'NODE_ENV',
  'WOOVI_ENVIRONMENT',
  'WOOVI_BASE_URL',
  'WOOVI_API_TOKEN'
];

const REQUIRED_PROD = [
  'LEAF_PIX_KEY'
];

const OPTIONAL_RECOMMENDED = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'CORS_ORIGIN',
  'ALLOW_PRIVATE_CORS',
  'ALLOW_NGROK_CORS'
];

function mask(value) {
  const raw = String(value || '');
  if (!raw) return '(empty)';
  if (raw.length <= 8) return '********';
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function checkRequired(keys) {
  const missing = [];
  for (const key of keys) {
    if (!String(process.env[key] || '').trim()) {
      missing.push(key);
    }
  }
  return missing;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function hasAnyEnv(keys) {
  return keys.some((key) => String(process.env[key] || '').trim().length > 0);
}

function readBooleanLike(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function resolveEnvPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

function loadRuntimeEnv() {
  const loadedFiles = [];
  const backendRoot = path.resolve(__dirname, '..', '..');
  const explicitEnvFile = resolveEnvPath(process.env.ENV_FILE);

  const safeLoad = (filePath, override = false) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }
    dotenv.config({ path: filePath, override });
    loadedFiles.push(filePath);
  };

  if (explicitEnvFile) {
    safeLoad(explicitEnvFile, true);
    return loadedFiles;
  }

  // Alinhado ao server.js: por padrão valida o mesmo .env carregado na inicialização.
  safeLoad(path.join(backendRoot, '.env'), false);
  return loadedFiles;
}

function main() {
  const envFilesLoaded = loadRuntimeEnv();
  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
  const wooviEnv = String(process.env.WOOVI_ENVIRONMENT || '').toLowerCase();
  const baseUrl = String(process.env.WOOVI_BASE_URL || '');

  const missingCommon = checkRequired(REQUIRED_COMMON);
  const missingProd = nodeEnv === 'production' ? checkRequired(REQUIRED_PROD) : [];
  const warnings = [];
  const blockers = [];

  if (wooviEnv === 'sandbox' && /api\.woovi\.com/i.test(baseUrl) && !/sandbox/i.test(baseUrl)) {
    warnings.push('WOOVI_ENVIRONMENT=sandbox com base URL de produção detectada');
  }

  if (wooviEnv === 'production' && /sandbox/i.test(baseUrl)) {
    warnings.push('WOOVI_ENVIRONMENT=production com base URL sandbox detectada');
  }

  if (nodeEnv === 'production' && wooviEnv !== 'production') {
    warnings.push('NODE_ENV=production está usando WOOVI_ENVIRONMENT diferente de production');
  }

  if (nodeEnv === 'production') {
    const hasWebhookVerifier = hasAnyEnv([
      'WOOVI_WEBHOOK_PUBLIC_KEY',
      'OPENPIX_WEBHOOK_PUBLIC_KEY',
      'WOOVI_WEBHOOK_SIGNATURE_SECRET',
      'OPENPIX_WEBHOOK_SIGNATURE_SECRET',
      'WOOVI_WEBHOOK_HMAC_SECRET',
      'OPENPIX_WEBHOOK_HMAC_SECRET'
    ]);
    const webhookRequireSignature = readBooleanLike(
      process.env.WOOVI_WEBHOOK_REQUIRE_SIGNATURE,
      hasWebhookVerifier
    );
    const webhookAllowUnsigned = readBooleanLike(
      process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED,
      !hasWebhookVerifier
    );
    const webhookProviderVerificationRequired = readBooleanLike(
      process.env.WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED,
      true
    );
    const geofenceRadiusKm = Number.parseFloat(process.env.GEOFENCE_RADIUS_KM || '');
    const corsOrigin = String(process.env.CORS_ORIGIN || '').trim();

    if (boolEnv('APP_REVIEW')) {
      blockers.push('APP_REVIEW=true não pode ir para produção pública normal');
    }
    if (boolEnv('BYPASS_GEOFENCE')) {
      blockers.push('BYPASS_GEOFENCE=true bloqueado em produção');
    }
    if (Number.isFinite(geofenceRadiusKm) && geofenceRadiusKm >= 100) {
      blockers.push(`GEOFENCE_RADIUS_KM=${geofenceRadiusKm} abre demais a operação em produção`);
    }
    if (webhookRequireSignature && !hasWebhookVerifier) {
      blockers.push('WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true exige verificador de assinatura configurado');
    }
    if (!hasWebhookVerifier) {
      if (!webhookAllowUnsigned) {
        blockers.push('Webhook sem assinatura em produção requer WOOVI_WEBHOOK_ALLOW_UNSIGNED=true');
      }
      if (!webhookProviderVerificationRequired) {
        blockers.push(
          'Webhook sem assinatura em produção requer WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED=true'
        );
      }
      warnings.push(
        'Webhook Woovi/OpenPix sem verificador criptográfico: confirmação autoritativa no provedor deve permanecer ativa'
      );
    }
    if (boolEnv('ENABLE_MANUAL_PAYMENT_CONFIRMATION')) {
      blockers.push('ENABLE_MANUAL_PAYMENT_CONFIRMATION=true bloqueado em produção');
    }
    if (boolEnv('ENABLE_DASHBOARD_MOCK_ENDPOINTS')) {
      blockers.push('ENABLE_DASHBOARD_MOCK_ENDPOINTS=true bloqueado em produção');
    }
    if (boolEnv('PAYMENT_BYPASS_ON_WOOVI_FAILURE') || boolEnv('PAYMENT_FORCE_BYPASS')) {
      blockers.push('Bypass de pagamento ativado bloqueado em produção');
    }
    if (boolEnv('MOCK_PAYMENT_FOR_TESTS')) {
      blockers.push('MOCK_PAYMENT_FOR_TESTS=true bloqueado em produção');
    }
    if (boolEnv('AUTH_TEST_OTP_BYPASS_ENABLED')) {
      blockers.push('AUTH_TEST_OTP_BYPASS_ENABLED=true bloqueado em produção');
    }
    if (boolEnv('AUTH_REVIEW_OTP_BYPASS_ENABLED') && !boolEnv('APP_REVIEW')) {
      blockers.push('AUTH_REVIEW_OTP_BYPASS_ENABLED=true sem APP_REVIEW não é permitido');
    }
    if (boolEnv('ALLOW_LOCAL_CORS')) {
      blockers.push('CORS local/expo habilitado bloqueado em produção');
    }
    if (boolEnv('ALLOW_NGROK_CORS') || boolEnv('ALLOW_PRIVATE_CORS')) {
      blockers.push('CORS privado/ngrok habilitado bloqueado em produção');
    }
    if (corsOrigin === '*' || /localhost|127\.0\.0\.1|ngrok|trycloudflare/i.test(corsOrigin)) {
      blockers.push(`CORS_ORIGIN inseguro para produção: ${corsOrigin || '(vazio)'}`);
    }

    if (boolEnv('PROMOTIONS_ENABLE_LEGACY_RTDB_MIRROR')) {
      warnings.push('PROMOTIONS_ENABLE_LEGACY_RTDB_MIRROR=true mantém dual-write legado em produção');
    }
    if (boolEnv('REFERRAL_PROGRAMS_ENABLE_LEGACY_RTDB_MIRROR')) {
      warnings.push('REFERRAL_PROGRAMS_ENABLE_LEGACY_RTDB_MIRROR=true mantém dual-write legado em produção');
    }
    if (boolEnv('ENABLE_LEGACY_PROFILE_RTDB_MIRROR')) {
      warnings.push('ENABLE_LEGACY_PROFILE_RTDB_MIRROR=true mantém espelho de perfil no RTDB em produção');
    }
  }

  const report = {
    ok: missingCommon.length === 0 && missingProd.length === 0 && blockers.length === 0,
    envFilesLoaded,
    nodeEnv,
    wooviEnv,
    baseUrl,
    summary: {
      missingCommon,
      missingProd,
      blockers,
      warnings
    },
    masked: {
      WOOVI_API_TOKEN: mask(process.env.WOOVI_API_TOKEN),
      WOOVI_WEBHOOK_PUBLIC_KEY: mask(process.env.WOOVI_WEBHOOK_PUBLIC_KEY || process.env.OPENPIX_WEBHOOK_PUBLIC_KEY),
      WOOVI_WEBHOOK_SIGNATURE_SECRET: mask(process.env.WOOVI_WEBHOOK_SIGNATURE_SECRET || process.env.OPENPIX_WEBHOOK_SIGNATURE_SECRET),
      WOOVI_WEBHOOK_HMAC_SECRET: mask(process.env.WOOVI_WEBHOOK_HMAC_SECRET || process.env.OPENPIX_WEBHOOK_HMAC_SECRET),
      WOOVI_WEBHOOK_REQUIRE_SIGNATURE: mask(process.env.WOOVI_WEBHOOK_REQUIRE_SIGNATURE),
      WOOVI_WEBHOOK_ALLOW_UNSIGNED: mask(process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED),
      WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED: mask(process.env.WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED),
      LEAF_PIX_KEY: mask(process.env.LEAF_PIX_KEY),
      CORS_ORIGIN: mask(process.env.CORS_ORIGIN),
      OTEL_EXPORTER_OTLP_ENDPOINT: mask(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
    },
    optionalRecommended: OPTIONAL_RECOMMENDED.filter((k) => !String(process.env[k] || '').trim())
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

main();
