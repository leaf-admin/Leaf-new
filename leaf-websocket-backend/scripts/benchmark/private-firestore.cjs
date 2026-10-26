'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

module.exports = async function withPrivateFirestore(run) {
  const jar = path.join(os.homedir(), '.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar');
  if (!fs.existsSync(jar)) throw new Error('Cached Firestore emulator required; no tools are downloaded');
  const java = ['/opt/homebrew/opt/openjdk@21/bin/java', '/opt/homebrew/opt/openjdk@17/bin/java']
    .find(candidate => fs.existsSync(candidate)) || 'java';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-firestore-scale-'));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const chosen = probe.address().port; probe.close(() => resolve(chosen)); });
  });
  const address = `127.0.0.1:${port}`;
  const projectId = 'demo-leaf-scale';
  const child = spawn(java, ['-Xmx256m', '-jar', jar, '--host', '127.0.0.1', '--port', String(port),
    '--project_id', projectId, '--single_project_mode', 'true', '--single_project_mode_error', 'true'],
  { cwd: directory, stdio: ['ignore', 'ignore', 'pipe'] });
  let startupError;
  let diagnostic = '';
  child.on('error', error => { startupError = error; });
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2000); });
  const previous = { emulator: process.env.FIRESTORE_EMULATOR_HOST, credential: process.env.GOOGLE_APPLICATION_CREDENTIALS };
  let firestore;
  try {
    let started = false;
    for (let i = 0; i < 150; i++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error(`Local emulator exited: ${diagnostic}`);
      try { await fetch(`http://${address}/`); started = true; break; } catch (_) { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!started) throw new Error('Private Firestore startup timed out');
    process.env.FIRESTORE_EMULATOR_HOST = address;
    // If any SDK path attempts ADC, fail instead of reading a real credential.
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(directory, 'credentials-must-not-be-loaded.json');
    const { Firestore } = require('@google-cloud/firestore');
    firestore = new Firestore({ projectId, host: address, ssl: false, preferRest: false });
    return await run(firestore);
  } finally {
    if (firestore) await firestore.terminate();
    for (const [name, value] of [['FIRESTORE_EMULATOR_HOST', previous.emulator], ['GOOGLE_APPLICATION_CREDENTIALS', previous.credential]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (child.pid && child.exitCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exit;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
