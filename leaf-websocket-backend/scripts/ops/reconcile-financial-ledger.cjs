#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function printHelp() {
  process.stdout.write(`Uso:
  npm run ops:financial-reconcile -- --ride-id <rideId>
  npm run ops:financial-reconcile -- --limit 100

Opcional:
  --out <arquivo.json>   grava o resumo no caminho informado
  --help                 mostra esta ajuda

O script reconcilia documentos financeiros existentes contra o ledger e grava
financial_reconciliation_reports/{rideId}. Ele nao cria eventos contabeis
retroativos automaticamente.
`);
}

async function main() {
  if (hasFlag('--help')) {
    printHelp();
    return;
  }

  const rideId = readArg('--ride-id');
  const limit = Number.parseInt(readArg('--limit') || process.env.FINANCIAL_RECONCILIATION_LIMIT || '100', 10);
  const FinancialLedgerService = require('../../services/financial-ledger-service');
  const service = new FinancialLedgerService();
  const summary = await service.reconcileRecentRideFinancials({
    rideId,
    limit
  });

  const output = {
    generatedAt: new Date().toISOString(),
    rideId: rideId || null,
    limit,
    summary
  };

  const explicitOutputPath = readArg('--out');
  if (explicitOutputPath) {
    const outputPath = path.resolve(process.cwd(), explicitOutputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    output.outputPath = outputPath;
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
