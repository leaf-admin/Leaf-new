#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const redisPool = require('../../utils/redis-pool');
const { materializePricingBaselines } = require('../../services/pricing-baseline-materializer');

async function main() {
  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();

  const summary = await materializePricingBaselines({
    redis,
    maxCells: Number.parseInt(process.env.PRICING_BASELINE_MAX_CELLS || '250', 10)
  });

  const outputDir = path.resolve(__dirname, '../../reports');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `pricing-baseline-materialization-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  process.stdout.write(`${JSON.stringify({ outputPath, summary }, null, 2)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
