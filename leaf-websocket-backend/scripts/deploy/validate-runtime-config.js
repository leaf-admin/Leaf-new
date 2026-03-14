#!/usr/bin/env node
/**
 * Runtime config validator for soft release.
 * - Confirma separação sandbox/prod para Woovi
 * - Valida presença das variáveis críticas de pagamento/pix
 * - Exibe alertas de CORS e OTEL
 */

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

function main() {
  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
  const wooviEnv = String(process.env.WOOVI_ENVIRONMENT || '').toLowerCase();
  const baseUrl = String(process.env.WOOVI_BASE_URL || '');

  const missingCommon = checkRequired(REQUIRED_COMMON);
  const missingProd = nodeEnv === 'production' ? checkRequired(REQUIRED_PROD) : [];
  const warnings = [];

  if (wooviEnv === 'sandbox' && /api\.woovi\.com/i.test(baseUrl) && !/sandbox/i.test(baseUrl)) {
    warnings.push('WOOVI_ENVIRONMENT=sandbox com base URL de produção detectada');
  }

  if (wooviEnv === 'production' && /sandbox/i.test(baseUrl)) {
    warnings.push('WOOVI_ENVIRONMENT=production com base URL sandbox detectada');
  }

  if (nodeEnv === 'production' && wooviEnv !== 'production') {
    warnings.push('NODE_ENV=production está usando WOOVI_ENVIRONMENT diferente de production');
  }

  const report = {
    ok: missingCommon.length === 0 && missingProd.length === 0,
    nodeEnv,
    wooviEnv,
    baseUrl,
    summary: {
      missingCommon,
      missingProd,
      warnings
    },
    masked: {
      WOOVI_API_TOKEN: mask(process.env.WOOVI_API_TOKEN),
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
