const fs = require('fs');
const path = require('path');

// expo-task-manager (Android) entrega as posições do tracking em segundo plano por um job
// do JobScheduler. A cada posição nova (a cada 2 s) ele cancela o job pendente e agenda
// outro com setOverrideDeadline(60 s) contado a partir de agora. O prazo nunca chega, e no
// Android 15 (restrição FLEXIBILITY) o sistema segura o job até o prazo: com o Leaf em
// segundo plano (motorista no Maps ou Waze) o job não rodava e o servidor ficou 4 min 22 s
// sem posição do motorista (QA de 2026-10-22, Xiaomi HyperOS 2).
//
// Aqui o job guarda a hora em que a primeira posição entrou na fila e o prazo passa a ser
// LEAF_JOB_DEADLINE_MS a partir dela: juntar posições não empurra mais o prazo, e o lote
// roda no máximo ~3 s depois da primeira posição pendente.

const projectRoot = path.resolve(__dirname, '..');
const candidates = [
  path.resolve(projectRoot, 'node_modules', 'expo-task-manager'),
  path.resolve(projectRoot, '..', 'node_modules', 'expo-task-manager'),
];
const relativeFile = path.join(
  'android', 'src', 'main', 'java', 'expo', 'modules', 'taskManager', 'TaskManagerUtils.java'
);
const MARKER = 'LEAF_JOB_DEADLINE_MS';

const originalBody = `  private JobInfo createJobInfo(int jobId, ComponentName jobService, PersistableBundle extras) {
    return new JobInfo.Builder(jobId, jobService)
      .setExtras(extras)
      .setMinimumLatency(0)
      .setOverrideDeadline(DEFAULT_OVERRIDE_DEADLINE)
      .build();
  }`;

const patchedBody = `  // ${MARKER}: patched by mobile-app/scripts/fix-expo-task-manager-job-deadline.js
  private static final long ${MARKER} = 3000L;
  private static final String LEAF_FIRST_QUEUED_AT = "leafFirstQueuedAt";

  private JobInfo createJobInfo(int jobId, ComponentName jobService, PersistableBundle extras) {
    long now = System.currentTimeMillis();
    long firstQueuedAt = extras.getLong(LEAF_FIRST_QUEUED_AT, 0L);
    if (firstQueuedAt <= 0L || firstQueuedAt > now) {
      firstQueuedAt = now;
      extras.putLong(LEAF_FIRST_QUEUED_AT, firstQueuedAt);
    }
    long deadline = Math.max(0L, firstQueuedAt + ${MARKER} - now);
    return new JobInfo.Builder(jobId, jobService)
      .setExtras(extras)
      .setMinimumLatency(0)
      .setOverrideDeadline(deadline)
      .build();
  }`;

function patch(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (original.includes(MARKER)) {
    return 'already';
  }
  if (!original.includes(originalBody)) {
    return 'unknown';
  }
  fs.writeFileSync(filePath, original.replace(originalBody, patchedBody));
  return 'patched';
}

function main() {
  const root = candidates.find((candidate) => fs.existsSync(path.join(candidate, relativeFile)));
  if (!root) {
    console.log('[fix-expo-task-manager-job-deadline] expo-task-manager not found, skipping');
    return;
  }
  const result = patch(path.join(root, relativeFile));
  if (result === 'unknown') {
    // Versão nova do expo-task-manager: revisar se o prazo ainda é empurrado a cada posição.
    console.warn('[fix-expo-task-manager-job-deadline] TaskManagerUtils.java changed upstream, not patched');
    return;
  }
  console.log(`[fix-expo-task-manager-job-deadline] ${result}`);
}

main();
