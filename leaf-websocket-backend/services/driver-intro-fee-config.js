function validHistoryCutoff(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z');
}

function configErrors(env = process.env) {
  const enabled = env.DRIVER_INTRO_FEE_ENABLED;
  if (enabled !== undefined && enabled !== '' && !['true', 'false'].includes(enabled)) {
    return ['DRIVER_INTRO_FEE_ENABLED deve ser true ou false'];
  }
  if (enabled !== 'true') return [];
  const errors = [];
  if (!validHistoryCutoff(env.DRIVER_INTRO_FEE_HISTORY_CUTOFF)) {
    errors.push('DRIVER_INTRO_FEE_HISTORY_CUTOFF deve identificar o corte histórico aprovado em ISO UTC');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(env.REDIS_CRITICAL_DATASET_GENERATION || '')) {
    errors.push('Promoção exige REDIS_CRITICAL_DATASET_GENERATION válida');
  }
  if (env.KYC_ACTIVE_TRIP_AUTHORITY_MODE !== 'redis_noeviction'
    || env.REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED !== 'true'
    || env.REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED !== 'true') {
    errors.push('Promoção exige autoridade Redis redis_noeviction, atestação e quarentena ativas');
  }
  if (env.RIDE_FINALIZATION_OUTBOX_ENABLED === 'false') {
    errors.push('Promoção exige RIDE_FINALIZATION_OUTBOX_ENABLED=true para persistir checkpoints');
  }
  // Reassignment has per-leg fee waivers and transfers booking ownership. Its
  // counter release needs a separate integration before these modes coexist.
  if (env.ENABLE_OPERATIONAL_REASSIGNMENT === 'true' || env.ENABLE_MULTI_LEG_BILLING === 'true') {
    errors.push('Promoção ainda não pode coexistir com reatribuição operacional ou faturamento de múltiplos trechos');
  }
  return errors;
}

module.exports = { configErrors, validHistoryCutoff };
