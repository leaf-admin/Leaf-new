'use strict';
module.exports = function databaseScaleConfigErrors(env = process.env) {
  const errors = [];
  for (const [reader, writer] of [
    ['ENABLE_H3_REGIONAL_READS', 'ENABLE_H3_REGIONAL_WRITES'],
    ['ENABLE_OPS_METRIC_READS', 'ENABLE_OPS_METRIC_WRITES']
  ]) if (env[reader] === 'true' && env[writer] !== 'true') errors.push(`${reader}=true exige ${writer}=true`);
  if (env.ENABLE_OPS_METRIC_WRITES === 'true' && ['false', '0', 'no', 'off'].includes(String(env.RIDE_FINALIZATION_OUTBOX_ENABLED).trim().toLowerCase())) {
    errors.push('ENABLE_OPS_METRIC_WRITES=true exige RIDE_FINALIZATION_OUTBOX_ENABLED=true');
  }
  return errors;
};
