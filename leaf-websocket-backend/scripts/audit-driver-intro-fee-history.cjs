#!/usr/bin/env node
// Offline only: no credentials, Firebase/Redis connections, or writes to source data.
const fs = require('fs');
const crypto = require('crypto');
const { auditDriverIntroFeeHistory } = require('../utils/driver-intro-fee-history');

function main(args) {
  if (args.length !== 1 || args[0].startsWith('-')) {
    throw new Error('Usage: node scripts/audit-driver-intro-fee-history.cjs /absolute/path/history.json');
  }
  const source = fs.readFileSync(args[0]);
  const report = auditDriverIntroFeeHistory(JSON.parse(source.toString('utf8')));
  process.stdout.write(`${JSON.stringify({
    ...report,
    inputSha256: crypto.createHash('sha256').update(source).digest('hex')
  }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
