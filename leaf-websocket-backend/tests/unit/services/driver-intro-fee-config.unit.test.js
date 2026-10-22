const { configErrors } = require('../../../services/driver-intro-fee-config');

const ready = {
  DRIVER_INTRO_FEE_ENABLED: 'true', DRIVER_INTRO_FEE_HISTORY_CUTOFF: '2026-10-22T18:00:00Z',
  REDIS_CRITICAL_DATASET_GENERATION: 'test-generation', KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
  REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true', REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true'
};

describe('introductory fee activation prerequisites', () => {
  it('is disabled by default without new configuration requirements', () => {
    expect(configErrors({})).toEqual([]);
    expect(configErrors({ DRIVER_INTRO_FEE_ENABLED: 'false' })).toEqual([]);
  });
  it('accepts a complete critical-authority contract', () => expect(configErrors(ready)).toEqual([]));
  it.each(['yes', '1', 'TRUE'])('rejects the ambiguous flag %s', value => {
    expect(configErrors({ DRIVER_INTRO_FEE_ENABLED: value })).not.toEqual([]);
  });
  it.each(['', '2026', '2026-02-31T18:00:00Z', '2026-10-22T18:00:00-03:00'])('requires a valid UTC cutoff: %s', cutoff => {
    expect(configErrors({ ...ready, DRIVER_INTRO_FEE_HISTORY_CUTOFF: cutoff }).join()).toContain('HISTORY_CUTOFF');
  });
  it.each(['KYC_ACTIVE_TRIP_AUTHORITY_MODE', 'REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED', 'REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED', 'REDIS_CRITICAL_DATASET_GENERATION'])('rejects incomplete durability: %s', key => {
    expect(configErrors({ ...ready, [key]: '' })).not.toEqual([]);
  });
  it('requires the existing outbox processor', () => {
    expect(configErrors({ ...ready, RIDE_FINALIZATION_OUTBOX_ENABLED: 'false' }).join()).toContain('OUTBOX');
  });
  it.each(['ENABLE_OPERATIONAL_REASSIGNMENT', 'ENABLE_MULTI_LEG_BILLING'])('rejects incompatible per-leg ownership mode: %s', key => {
    expect(configErrors({ ...ready, [key]: 'true' }).join()).toContain('trechos');
    expect(configErrors({ ...ready, [key]: 'false' })).toEqual([]);
  });
});
