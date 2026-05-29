#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const CnhFaceBiometricService = require('../../services/cnh-face-biometric-service');

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.production.sandbox') });

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/kyc/benchmark-cnh-face-embedding.cjs --file <cnh.pdf> [--iterations 5]',
    '',
    'Required env:',
    '  BIOMETRIC_FACE_SERVICE_URL',
    '  BIOMETRIC_FACE_SERVICE_API_KEY'
  ].join('\n');
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.round((pct / 100) * (sorted.length - 1));
  return sorted[index] || 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = String(args.file || '').trim();
  const iterations = Math.max(1, Number.parseInt(args.iterations || '5', 10) || 5);

  if (!filePath) {
    console.error(usage());
    process.exit(2);
  }

  const buffer = fs.readFileSync(filePath);
  const service = new CnhFaceBiometricService();
  if (!service.isConfigured()) {
    throw new Error('BIOMETRIC_FACE_SERVICE_URL e BIOMETRIC_FACE_SERVICE_API_KEY devem estar configurados');
  }

  const rows = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const started = Date.now();
    const result = await service.generateCnhFaceEmbeddingFromPdf(buffer, {
      filename: `benchmark-first-registration-${Date.now()}-${iteration}${path.extname(filePath) || '.pdf'}`,
      disableFullPageFallback: true
    });

    rows.push({
      iteration,
      durationMs: Date.now() - started,
      source: result.source,
      dimension: result.dimension || null,
      embeddingLength: Array.isArray(result.embedding) ? result.embedding.length : 0,
      faceCount: result.face_count || null,
      detectionScore: result.selected_face?.detection_score || null,
      model: result.model || null
    });
  }

  const durations = rows.map(row => row.durationMs);
  const avg = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;

  console.log(JSON.stringify({
    success: true,
    mode: 'fresh_cnh_pdf_to_embedding_no_persist_no_cache',
    note: 'Cada iteração reprocessa o PDF bruto da CNH e chama /generate-embedding; não reutiliza users/{driverId}/biometrics/cnhFace.',
    fileBytes: buffer.length,
    iterations,
    summary: {
      minMs: Math.min(...durations),
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: Math.max(...durations),
      avgMs: Math.round(avg)
    },
    rows
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    success: false,
    error: error.message
  }, null, 2));
  process.exit(1);
});
