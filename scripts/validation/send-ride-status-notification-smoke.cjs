#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'leaf-websocket-backend');
const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));

function parseArgs(argv) {
  const args = {
    phase: 'all',
    platform: 'ios',
    delayMs: 4500,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    if (key === 'dry-run') {
      args.dryRun = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Argumento --${key} precisa de valor`);
    }
    index += 1;

    if (key === 'user-id') args.userId = value;
    else if (key === 'booking-id') args.bookingId = value;
    else if (key === 'phase') args.phase = value;
    else if (key === 'platform') args.platform = value;
    else if (key === 'delay-ms') args.delayMs = Number(value);
    else if (key === 'redis-url') args.redisUrl = value;
    else throw new Error(`Argumento desconhecido: --${key}`);
  }

  args.userId = args.userId || process.env.LEAF_SMOKE_USER_ID;
  args.bookingId = args.bookingId || `smoke-notification-${args.platform}-${Date.now()}`;
  args.redisUrl = args.redisUrl || process.env.LEAF_SMOKE_REDIS_URL || process.env.REDIS_URL;

  if (!args.userId) {
    throw new Error('Informe --user-id ou LEAF_SMOKE_USER_ID');
  }

  if (!['ios', 'android'].includes(String(args.platform))) {
    throw new Error('--platform deve ser ios ou android');
  }

  if (!['accepted', 'arrived', 'started', 'completed', 'all'].includes(String(args.phase))) {
    throw new Error('--phase deve ser accepted, arrived, started, completed ou all');
  }

  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    throw new Error('--delay-ms deve ser um numero positivo');
  }

  return args;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const [rawKey, ...rawValueParts] = trimmed.split('=');
    const key = rawKey.trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = rawValueParts.join('=').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadBackendEnv() {
  [
    '.env.production.local',
    '.env.production',
    '.env',
    'config.env'
  ].forEach((filename) => loadEnvFile(path.join(BACKEND_DIR, filename)));
}

function getRedisConnectionArgs(args) {
  const commonOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    enableReadyCheck: true
  };

  if (args.redisUrl) {
    return [args.redisUrl, commonOptions];
  }

  return [{
    host: process.env.LEAF_SMOKE_REDIS_HOST || '127.0.0.1',
    port: Number(process.env.LEAF_SMOKE_REDIS_PORT || 6380),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    ...commonOptions
  }];
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function buildBaseRideData(args) {
  return {
    bookingId: args.bookingId,
    userType: 'passenger',
    driverName: 'Carlos',
    customerName: 'Leaf Passageiro Teste',
    pickup: {
      address: 'Local atual',
      latitude: -22.9711,
      longitude: -43.1822
    },
    destination: {
      name: 'Barra Shopping',
      address: 'Barra Shopping',
      latitude: -22.9991,
      longitude: -43.3659
    },
    distance: '5 km',
    fare: 'R$ 38,08',
    pickupEstimatedTime: '6',
    tripEstimatedTime: '18',
    estimatedTime: '6'
  };
}

function buildPhasePayloads(args) {
  const base = buildBaseRideData(args);
  const payloads = {
    accepted: {
      ...base,
      status: 'accepted',
      estimatedTime: '6',
      pickupEstimatedTime: '6',
      tripEstimatedTime: '18',
      acceptedAt: minutesAgo(2),
      phaseStartedAt: minutesAgo(2)
    },
    arrived: {
      ...base,
      status: 'arrived',
      estimatedTime: '0',
      pickupEstimatedTime: '0',
      tripEstimatedTime: '18',
      arrivedAt: minutesAgo(1),
      phaseStartedAt: minutesAgo(1)
    },
    started: {
      ...base,
      status: 'started',
      estimatedTime: '14',
      tripEstimatedTime: '14',
      startedAt: minutesAgo(4),
      phaseStartedAt: minutesAgo(4)
    },
    completed: {
      ...base,
      status: 'completed',
      estimatedTime: '0',
      pickupEstimatedTime: '0',
      tripEstimatedTime: '0',
      phaseStartedAt: new Date().toISOString()
    }
  };

  if (args.phase === 'all') {
    return [
      ['accepted', payloads.accepted],
      ['accepted-duplicate', payloads.accepted],
      ['arrived', payloads.arrived],
      ['started', payloads.started],
      ['completed', payloads.completed]
    ];
  }

  return [[args.phase, payloads[args.phase]]];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printUsage() {
  console.log(`
Uso:
  node scripts/validation/send-ride-status-notification-smoke.cjs --platform ios --user-id <USER_ID>

Opcoes:
  --platform ios|android       Plataforma observada no device. Default: ios
  --user-id <id>               Usuario que esta logado no app e tem token FCM registrado
  --booking-id <id>            Booking usado no smoke. Default: smoke-notification-<platform>-<timestamp>
  --phase <status>             accepted, arrived, started, completed ou all. Default: all
  --delay-ms <ms>              Pausa entre status no modo all. Default: 4500
  --redis-url <url>            Redis alternativo. Default: LEAF_SMOKE_REDIS_URL/REDIS_URL ou tunnel local 127.0.0.1:6380
  --dry-run                    Mostra o plano sem enviar FCM

Tunnel Redis recomendado:
  ssh -fN -i /Users/izaakdias/.ssh/leaf_contabo_20260412_ed25519 -o ExitOnForwardFailure=yes -L 6380:127.0.0.1:6379 root@api.leaf.app.br
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  loadBackendEnv();
  const args = parseArgs(process.argv.slice(2));
  const payloads = buildPhasePayloads(args);

  console.log('[ride-notification-smoke] Plano');
  console.log(JSON.stringify({
    platform: args.platform,
    userId: args.userId,
    bookingId: args.bookingId,
    phase: args.phase,
    steps: payloads.map(([phase]) => phase),
    dryRun: args.dryRun
  }, null, 2));

  if (args.dryRun) return;

  const Redis = backendRequire('ioredis');
  const FCMService = require(path.join(BACKEND_DIR, 'services', 'fcm-service'));
  const redis = new Redis(...getRedisConnectionArgs(args));
  const fcmService = new FCMService(redis);

  try {
    await redis.connect();
  } catch (error) {
    console.error('[ride-notification-smoke] Falha ao conectar no Redis.');
    console.error(`Motivo: ${error.message}`);
    console.error('Abra o tunnel Redis ou passe --redis-url. Exemplo:');
    console.error('ssh -fN -i /Users/izaakdias/.ssh/leaf_contabo_20260412_ed25519 -o ExitOnForwardFailure=yes -L 6380:127.0.0.1:6379 root@api.leaf.app.br');
    process.exitCode = 1;
    return;
  }

  await fcmService.initialize();
  if (!fcmService.isServiceAvailable()) {
    console.error('[ride-notification-smoke] FCM indisponivel. Confira credenciais Firebase Admin no backend.');
    process.exitCode = 1;
    return;
  }

  for (let index = 0; index < payloads.length; index += 1) {
    const [phase, payload] = payloads[index];
    const result = await fcmService.sendRideStatusUpdate(args.userId, payload);
    console.log(`[ride-notification-smoke] ${phase}: ${result.success ? 'ok' : 'falhou'} ${JSON.stringify({
      count: result.count || 0,
      error: result.error || null
    })}`);

    if (!result.success) {
      process.exitCode = 1;
      break;
    }

    if (index < payloads.length - 1 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
  }

  if (!process.exitCode) {
    console.log('[ride-notification-smoke] Concluido. Validar no device: titulo/texto por fase, ausencia de duplicidade e limpeza apos completed.');
  }
}

main()
  .catch((error) => {
    console.error(`[ride-notification-smoke] Erro fatal: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 250);
  });
