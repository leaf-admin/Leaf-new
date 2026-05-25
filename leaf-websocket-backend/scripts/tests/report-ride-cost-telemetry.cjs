#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '..', '..', '.env') });

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  const flags = {};

  args.forEach((arg) => {
    if (arg.startsWith('--')) {
      const [key, rawValue] = arg.replace(/^--/, '').split('=');
      flags[key] = rawValue === undefined ? true : rawValue;
      return;
    }
    positional.push(arg);
  });

  return {
    bookingId: positional[0] || '',
    limit: Number.parseInt(flags.limit || '5', 10),
    viaApi:
      String(flags['via-api'] || flags.viaApi || '').trim().toLowerCase() === 'true' ||
      Boolean(flags['server-url']) ||
      Boolean(flags.server),
    serverUrl: String(flags['server-url'] || flags.server || process.env.SERVER_URL || '').trim(),
    token: String(flags.token || process.env.OPS_BEARER_TOKEN || '').trim(),
    help: Boolean(flags.help),
  };
}

function printHelp() {
  console.log(`
Uso:
  node scripts/tests/report-ride-cost-telemetry.cjs [bookingId] [--limit=10]
  node scripts/tests/report-ride-cost-telemetry.cjs [bookingId] --via-api=true --server-url=https://api.leaf.app.br --token=...

Flags:
  --limit=<n>         Quantidade de relatórios recentes (sem bookingId)
  --via-api=true      Consulta endpoint OPS ao invés de Redis local
  --server-url=<url>  Base URL da API (obrigatório no modo API)
  --token=<jwt>       Bearer token OPS/Suporte (opcional, mas recomendado)
  --help              Exibe esta ajuda
`.trim());
}

async function queryViaApi({ bookingId, limit, serverUrl, token }) {
  if (!serverUrl) {
    throw new Error('server-url obrigatório para modo --via-api=true');
  }

  const baseUrl = serverUrl.replace(/\/+$/, '');
  const endpoint = bookingId
    ? `${baseUrl}/api/ops/ride-cost-telemetry/${encodeURIComponent(bookingId)}`
    : `${baseUrl}/api/ops/ride-cost-telemetry?limit=${Math.max(1, Number(limit) || 5)}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const rawBody = await response.text();
  const body = rawBody ? (() => {
    try {
      return JSON.parse(rawBody);
    } catch (_error) {
      return { rawBody };
    }
  })() : {};

  if (!response.ok) {
    throw new Error(`Falha HTTP ${response.status} em ${endpoint}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function main() {
  const { bookingId, limit, viaApi, serverUrl, token, help } = parseArgs(process.argv);

  if (help) {
    printHelp();
    return;
  }

  if (viaApi) {
    const payload = await queryViaApi({
      bookingId,
      limit,
      serverUrl,
      token,
    });
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const rideCostTelemetryService = require('../../services/ride-cost-telemetry-service');
  const redisPool = require('../../utils/redis-pool');
  await redisPool.ensureConnection();
  try {
    if (bookingId) {
      const report = await rideCostTelemetryService.getReport(bookingId);
      console.log(JSON.stringify(report || { bookingId, found: false }, null, 2));
      return;
    }

    const reports = await rideCostTelemetryService.getRecentReports(limit);
    console.log(JSON.stringify({
      count: reports.length,
      reports,
    }, null, 2));
  } finally {
    await redisPool.disconnect();
  }
}

main()
  .catch((error) => {
    console.error('[report-ride-cost-telemetry] erro:', error?.message || error);
    process.exitCode = 1;
  });
