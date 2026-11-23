#!/usr/bin/env node
'use strict';

// Operação do seguro por corrida (IZA). Roda dentro do container do backend,
// com as variáveis IZA_* do ambiente.
//
//   node scripts/ops/iza-insurance.cjs ping
//       GET /partner-info (etapa 1 da homologação).
//   node scripts/ops/iza-insurance.cjs backfill [--apply]
//       Cadastra na IZA os motoristas já aprovados. Sem --apply só lista quem
//       entraria e quem está com dado faltando.
//   node scripts/ops/iza-insurance.cjs report [AAAA-MM-DD]
//       Resumo do dia para mandar à IZA: cadastros, períodos abertos, encerrados,
//       cancelados e erros com o código, mais a contagem do lado da IZA.

const APPROVED_STATES = new Set(['ACTIVE', 'APPROVED_NEEDS_LIVENESS']);

function maskDoc(doc) {
  const digits = String(doc || '');
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '-';
}

function todayBrt() {
  const { toIzaLocalDateTime } = require('../../services/iza-insurance/iza-client');
  return toIzaLocalDateTime(new Date()).slice(0, 10);
}

async function ping() {
  const { createIzaClient, readIzaConfig } = require('../../services/iza-insurance/iza-client');
  const config = readIzaConfig();
  const info = await createIzaClient({ config }).getPartnerInfo();
  console.log(JSON.stringify({ environment: config.environment, enabled: config.enabled, partner: info?.name || null, dateBegin: info?.date_begin || null }, null, 2));
}

async function backfill(apply) {
  const { getFirestore } = require('../../firebase-config');
  const userStore = require('../../services/user-store');
  const { loadDriverIzaIdentity } = require('../../services/iza-insurance/iza-driver-identity');
  const firestore = getFirestore();
  if (!firestore) throw new Error('Firestore indisponível');
  const drivers = await userStore.queryUsers(firestore, 'userType', 'driver');
  const rows = [];
  for (const [driverId, user] of Object.entries(drivers || {})) {
    const state = String(user?.driverActivation?.activationState || user?.driverActivation?.state || '').toUpperCase();
    if (!APPROVED_STATES.has(state)) continue;
    if (user?.izaInsurance?.status === 'registered') {
      rows.push({ driverId, state, result: 'já cadastrado' });
      continue;
    }
    const identity = await loadDriverIzaIdentity(firestore, driverId);
    if (!identity.ok) {
      rows.push({ driverId, state, result: `faltando: ${identity.missing.join(', ')}` });
      continue;
    }
    if (!apply) {
      rows.push({ driverId, state, doc: maskDoc(identity.doc), nameSource: identity.nameSource, result: 'entraria' });
      continue;
    }
    const { getDefaultIzaInsuranceService } = require('../../services/iza-insurance/iza-insurance-service');
    const outcome = await getDefaultIzaInsuranceService().registerDriver(driverId);
    rows.push({ driverId, state, doc: maskDoc(identity.doc), result: outcome?.doc ? 'cadastrado' : `falhou: ${outcome?.code || 'desligado'}` });
  }
  console.table(rows);
  console.log(`${rows.length} motoristas aprovados${apply ? '' : ' (simulação, use --apply para cadastrar)'}`);
}

async function report(day) {
  const redisPool = require('../../utils/redis-pool');
  const { createIzaInsuranceService } = require('../../services/iza-insurance/iza-insurance-service');
  const { createIzaClient } = require('../../services/iza-insurance/iza-client');
  const client = createIzaClient();
  const service = createIzaInsuranceService({ client, redis: redisPool.getConnection() });
  const { stats, errors } = await service.readDailyStats(day);
  const num = (key) => Number(stats[key] || 0);

  let izaSide = null;
  try {
    const rows = await client.listPeriods({ startedAt: `${day}T00:00:00`, finishedAt: `${day}T23:59:59` });
    const flat = rows;
    izaSide = {
      total: flat.length,
      abertos: flat.filter((row) => row.status === 'open').length,
      encerrados: flat.filter((row) => row.status === 'finished').length,
      cancelados: flat.filter((row) => row.status === 'canceled').length
    };
  } catch (error) {
    izaSide = { erro: error.message };
  }

  const errorCodes = Object.entries(stats)
    .filter(([key]) => key.startsWith('error:'))
    .map(([key, value]) => `${key.slice(6)}: ${value}`);

  console.log(`Leaf × IZA — ${day}`);
  console.log(`Cadastros feitos: ${num('persons_registered')} (já existiam: ${num('persons_existing')})`);
  console.log(`Contratos criados: ${num('contracts_created')} (já existiam: ${num('contracts_existing')})`);
  console.log(`Períodos abertos: ${num('periods_opened')}`);
  console.log(`Períodos encerrados: ${num('periods_closed')} (já fechados pela IZA: ${num('periods_already_final')})`);
  console.log(`Períodos cancelados: ${num('periods_canceled')}`);
  console.log(`Corridas acima de 2 h (novo período): ${num('periods_rotated')}`);
  console.log(`Falhas ao abrir: ${num('periods_open_failed')} | falhas ao encerrar: ${num('periods_close_failed')}`);
  console.log(`GPS enviados: ${num('geolocation_sent')} | falhas de GPS: ${num('geolocation_failed')}`);
  console.log(`Erros: ${num('errors')}${errorCodes.length ? ` (${errorCodes.join('; ')})` : ''}`);
  console.log(`Lado da IZA no dia (pode atrasar horas; a conferência oficial é no dia seguinte): ${JSON.stringify(izaSide)}`);
  if (errors.length) {
    console.log('\nÚltimos erros (sem CPF):');
    for (const entry of errors.slice(0, 30)) {
      console.log(`- ${entry.at} ${entry.method || ''} ${entry.path || ''} ${entry.status || ''} ${entry.code || ''} ${entry.stage || ''} ${entry.bookingId || ''}`);
    }
  }
  await redisPool.getConnection().quit?.().catch?.(() => null);
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === 'ping') return ping();
  if (command === 'backfill') return backfill(process.argv.includes('--apply'));
  if (command === 'report') return report(arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : todayBrt());
  console.log('Uso: iza-insurance.cjs ping | backfill [--apply] | report [AAAA-MM-DD]');
  process.exitCode = 1;
  return null;
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((error) => {
    console.error(`Falhou: ${error.message}`);
    process.exit(1);
  });
