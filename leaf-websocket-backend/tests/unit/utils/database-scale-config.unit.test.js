const errors = require('../../../utils/database-scale-config');
describe('scale read model prerequisites', () => {
  test('defaults keep all new work disabled', () => expect(errors({})).toEqual([]));
  test.each(['H3_REGIONAL', 'RECEIPT_HISTORY', 'OPS_METRIC'])('reader%s requires its writer', name => {
    expect(errors({ [`ENABLE_${name}_READS`]: 'true' })).toHaveLength(1);
    expect(errors({ [`ENABLE_${name}_READS`]: 'true', [`ENABLE_${name}_WRITES`]: 'true' })).toEqual([]);
  });
  test('durable work cannot be enabled with the existing consumer disabled', () => {
    expect(errors({ ENABLE_OPS_METRIC_WRITES: 'true', RIDE_FINALIZATION_OUTBOX_ENABLED: 'false' })).toHaveLength(1);
  });
});
