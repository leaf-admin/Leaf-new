#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

const backendDir = path.resolve(__dirname, '..', '..');
const rootDir = path.resolve(backendDir, '..');

function parseArgs(argv) {
  const options = {
    envFile: process.env.ENV_FILE || '.env.production.sandbox',
    valueCents: 100,
    keepCharge: false,
    out: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const [flag, inlineValue] = item.split('=');
    const nextValue = inlineValue !== undefined ? inlineValue : argv[index + 1];

    switch (flag) {
      case '--env-file':
        options.envFile = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--value-cents':
        options.valueCents = Number.parseInt(nextValue, 10);
        if (inlineValue === undefined) index += 1;
        break;
      case '--keep-charge':
        options.keepCharge = true;
        break;
      case '--out':
        options.out = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'sim'].includes(String(raw).trim().toLowerCase());
}

function loadEnvFile(envFile) {
  const envPath = path.isAbsolute(envFile) ? envFile : path.join(backendDir, envFile);
  if (!fs.existsSync(envPath)) {
    throw new Error(`Env file não encontrado: ${envPath}`);
  }

  dotenv.config({ path: envPath, override: true, quiet: true });
  return envPath;
}

function assertSafeSandboxRuntime(config) {
  const blockers = [];
  const baseUrl = String(config.baseUrl || '').toLowerCase();
  const environment = String(config.environment || '').toLowerCase();

  if (environment !== 'sandbox') blockers.push('WOOVI_ENVIRONMENT precisa ser sandbox');
  if (!baseUrl.includes('sandbox')) blockers.push('WOOVI_BASE_URL precisa apontar para sandbox');
  if (!config.apiToken) blockers.push('WOOVI_API_TOKEN ausente');
  if (!boolEnv('REQUIRE_PAYMENT_BEFORE_BOOKING', true)) blockers.push('REQUIRE_PAYMENT_BEFORE_BOOKING=false');
  if (!boolEnv('VERIFY_PAYMENT_BEFORE_BOOKING', true)) blockers.push('VERIFY_PAYMENT_BEFORE_BOOKING=false');
  if (!boolEnv('REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING', true)) {
    blockers.push('REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING=false');
  }
  if (boolEnv('APP_REVIEW', false)) blockers.push('APP_REVIEW=true');
  if (boolEnv('MOCK_PAYMENT_FOR_TESTS', false)) blockers.push('MOCK_PAYMENT_FOR_TESTS=true');
  if (boolEnv('ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING', false)) {
    blockers.push('ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING=true');
  }
  if (boolEnv('PAYMENT_BYPASS_ON_WOOVI_FAILURE', false)) blockers.push('PAYMENT_BYPASS_ON_WOOVI_FAILURE=true');
  if (boolEnv('PAYMENT_FORCE_BYPASS', false)) blockers.push('PAYMENT_FORCE_BYPASS=true');

  if (blockers.length > 0) {
    const error = new Error('Runtime sandbox Woovi não está seguro para canary');
    error.blockers = blockers;
    throw error;
  }
}

function extractCharge(responseData = {}) {
  return responseData.charge || responseData;
}

function summarizeCharge(charge = {}) {
  return {
    id: charge.id || null,
    identifier: charge.identifier || null,
    correlationID: charge.correlationID || null,
    transactionID: charge.transactionID || null,
    status: charge.status || null,
    value: charge.value || null,
    hasQrCodeImage: Boolean(charge.qrCodeImage || charge?.paymentMethods?.pix?.qrCodeImage),
    hasPixCode: Boolean(charge.pixCode || charge.brCode || charge?.paymentMethods?.pix?.brCode),
    hasPaymentLinkUrl: Boolean(charge.paymentLinkUrl || charge?.paymentMethods?.pix?.paymentLinkUrl),
  };
}

function resolveChargeReference(charge = {}, fallback) {
  return (
    charge.correlationID ||
    charge.identifier ||
    charge.transactionID ||
    charge.id ||
    fallback
  );
}

function writeReport(outPath, report) {
  if (!outPath) return;
  const absoluteOutPath = path.isAbsolute(outPath) ? outPath : path.join(rootDir, outPath);
  fs.mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
  fs.writeFileSync(absoluteOutPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envPath = loadEnvFile(options.envFile);
  const { getWooviConfig, getWooviAuthHeaders } = require('../../config/woovi-config');
  const config = getWooviConfig();
  assertSafeSandboxRuntime(config);

  const valueCents = Number.isFinite(options.valueCents) && options.valueCents > 0
    ? options.valueCents
    : 100;
  const correlationID = `leaf_canary_sandbox_${Date.now()}`;
  const api = axios.create({
    baseURL: config.baseUrl,
    headers: getWooviAuthHeaders(config),
    timeout: 20000,
    validateStatus: () => true,
  });

  const report = {
    success: false,
    generatedAt: new Date().toISOString(),
    envFile: path.relative(rootDir, envPath),
    config: {
      environment: config.environment,
      baseUrl: config.baseUrl,
      hasAppId: Boolean(config.appId),
      hasApiToken: Boolean(config.apiToken),
      hasMasterApiToken: Boolean(config.masterApiToken),
      hasLeafPixKey: Boolean(config.leafPixKey),
    },
    charge: {
      correlationID,
      valueCents,
      created: null,
      fetched: null,
      cleanup: null,
    },
  };

  const createResponse = await api.post('/charge?return_existing=true', {
    correlationID,
    value: valueCents,
    comment: 'Leaf canary sandbox smoke',
    expiresIn: 600,
    additionalInfo: [
      { key: 'service', value: 'leaf_canary' },
      { key: 'payment_type', value: 'sandbox_smoke' },
      { key: 'test_mode', value: 'sandbox' },
    ],
  });

  const createCharge = extractCharge(createResponse.data);
  report.charge.created = {
    httpStatus: createResponse.status,
    ok: createResponse.status >= 200 && createResponse.status < 300,
    charge: summarizeCharge(createCharge),
  };

  if (!report.charge.created.ok || !createCharge) {
    report.error = 'Falha ao criar cobrança sandbox';
    report.responseShape = Object.keys(createResponse.data || {});
    writeReport(options.out, report);
    throw new Error(`Falha ao criar cobrança sandbox: HTTP ${createResponse.status}`);
  }

  const chargeReference = resolveChargeReference(createCharge, correlationID);
  const fetchResponse = await api.get(`/charge/${encodeURIComponent(chargeReference)}`);
  const fetchedCharge = extractCharge(fetchResponse.data);
  report.charge.fetched = {
    httpStatus: fetchResponse.status,
    ok: fetchResponse.status >= 200 && fetchResponse.status < 300,
    charge: summarizeCharge(fetchedCharge),
  };

  if (!options.keepCharge) {
    const deleteResponse = await api.delete(`/charge/${encodeURIComponent(chargeReference)}`);
    report.charge.cleanup = {
      attempted: true,
      httpStatus: deleteResponse.status,
      ok: deleteResponse.status >= 200 && deleteResponse.status < 300,
    };
  } else {
    report.charge.cleanup = {
      attempted: false,
      ok: true,
      reason: 'keep-charge',
    };
  }

  report.success = Boolean(
    report.charge.created?.ok &&
    report.charge.created?.charge?.hasQrCodeImage &&
    report.charge.fetched?.ok &&
    report.charge.cleanup?.ok
  );

  writeReport(options.out, report);

  console.log(JSON.stringify({
    success: report.success,
    environment: report.config.environment,
    baseUrl: report.config.baseUrl,
    chargeStatus: report.charge.fetched?.charge?.status || report.charge.created?.charge?.status || null,
    hasQrCodeImage: report.charge.created?.charge?.hasQrCodeImage || false,
    cleanupOk: report.charge.cleanup?.ok || false,
    report: options.out || null,
  }, null, 2));

  if (!report.success) {
    process.exit(1);
  }
}

main().catch((error) => {
  const payload = {
    success: false,
    error: error.message,
    blockers: error.blockers || [],
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
