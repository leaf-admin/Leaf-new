const fs = require('fs');
const path = require('path');

// expo-task-manager (Android) junta cada novo lote de localizações nos extras do job
// pendente do JobScheduler e reagenda o job. Com o JS lento, esse bundle cresce sem
// limite (228 KB na QA de 2026-10-20) e o app morreu com OutOfMemoryError em
// LocationTaskConsumer.didExecuteJob. Aqui o job pendente guarda só os últimos
// MAX_PENDING_JOB_DATA itens: as posições mais antigas já não servem para a corrida.

const projectRoot = path.resolve(__dirname, '..');
const candidates = [
  path.resolve(projectRoot, 'node_modules', 'expo-task-manager'),
  path.resolve(projectRoot, '..', 'node_modules', 'expo-task-manager'),
];
const relativeFile = path.join(
  'android', 'src', 'main', 'java', 'expo', 'modules', 'taskManager', 'TaskManagerUtils.java'
);
const MARKER = 'LEAF_MAX_PENDING_JOB_DATA';

const originalBody = `  private JobInfo createJobInfoByAddingData(JobInfo jobInfo, List<PersistableBundle> data) {
    PersistableBundle mergedExtras = jobInfo.getExtras();
    int dataSize = mergedExtras.getInt("dataSize", 0);

    if (data != null) {
      mergedExtras.putInt("dataSize", dataSize + data.size());

      for (int i = 0; i < data.size(); i++) {
        mergedExtras.putPersistableBundle(String.valueOf(dataSize + i), data.get(i));
      }
    }
    return createJobInfo(jobInfo.getId(), jobInfo.getService(), mergedExtras);
  }`;

const patchedBody = `  // ${MARKER}: patched by mobile-app/scripts/fix-expo-task-manager-pending-job-data.js
  private static final int ${MARKER} = 100;

  private JobInfo createJobInfoByAddingData(JobInfo jobInfo, List<PersistableBundle> data) {
    PersistableBundle mergedExtras = jobInfo.getExtras();
    int dataSize = mergedExtras.getInt("dataSize", 0);

    if (data != null) {
      int total = dataSize + data.size();
      if (total <= ${MARKER}) {
        mergedExtras.putInt("dataSize", total);
        for (int i = 0; i < data.size(); i++) {
          mergedExtras.putPersistableBundle(String.valueOf(dataSize + i), data.get(i));
        }
      } else {
        List<PersistableBundle> all = new ArrayList<>(total);
        for (int i = 0; i < dataSize; i++) {
          all.add(mergedExtras.getPersistableBundle(String.valueOf(i)));
          mergedExtras.remove(String.valueOf(i));
        }
        all.addAll(data);
        List<PersistableBundle> kept = all.subList(total - ${MARKER}, total);
        for (int i = 0; i < kept.size(); i++) {
          mergedExtras.putPersistableBundle(String.valueOf(i), kept.get(i));
        }
        mergedExtras.putInt("dataSize", kept.size());
      }
    }
    return createJobInfo(jobInfo.getId(), jobInfo.getService(), mergedExtras);
  }`;

function patch(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (original.includes(MARKER)) {
    return 'already';
  }
  if (!original.includes(originalBody)) {
    return 'unknown';
  }
  let patched = original.replace(originalBody, patchedBody);
  if (!/import java\.util\.ArrayList;/.test(patched)) {
    patched = patched.replace('import java.util.List;', 'import java.util.ArrayList;\nimport java.util.List;');
  }
  fs.writeFileSync(filePath, patched);
  return 'patched';
}

function main() {
  const root = candidates.find((candidate) => fs.existsSync(path.join(candidate, relativeFile)));
  if (!root) {
    console.log('[fix-expo-task-manager-pending-job-data] expo-task-manager not found, skipping');
    return;
  }
  const result = patch(path.join(root, relativeFile));
  if (result === 'unknown') {
    // Versão nova do expo-task-manager: revisar se o limite ainda é preciso.
    console.warn('[fix-expo-task-manager-pending-job-data] TaskManagerUtils.java changed upstream, not patched');
    return;
  }
  console.log(`[fix-expo-task-manager-pending-job-data] ${result}`);
}

main();
