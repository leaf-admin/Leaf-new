'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

module.exports = async function withPrivateRealtime(run) {
  const jar = path.join(os.homedir(), '.cache/firebase/emulators/firebase-database-emulator-v4.11.2.jar');
  if (!fs.existsSync(jar)) throw new Error('Cached RTDB emulator required; this script never downloads tools');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-rtdb-scale-'));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)); });
  });
  const address = `127.0.0.1:${port}`;
  const namespace = 'demo-leaf-scale';
  const child = spawn('java', ['-Xmx256m', '-jar', jar, '--host', '127.0.0.1', '--port', String(port),
    '--single_project_mode', 'Error'], { cwd: directory, stdio: ['ignore', 'ignore', 'pipe'] });
  let error;
  let diagnostic = '';
  child.on('error', value => { error = value; });
  child.stderr.on('data', value => { diagnostic = (diagnostic + value).slice(-2000); });
  const previous = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  let app;
  try {
    let started = false;
    for (let i = 0; i < 150; i++) {
      if (error) throw error;
      if (child.exitCode !== null) throw new Error(`Local emulator exited: ${diagnostic}`);
      try { await fetch(`http://${address}/.json?ns=${namespace}`); started = true; break; } catch (_) { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!started) throw new Error('Local emulator startup timed out');
    const rules = fs.readFileSync(path.resolve(__dirname, '../../../config/firebase/database.rules.json'), 'utf8');
    const response = await fetch(`http://${address}/.settings/rules.json?ns=${namespace}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: rules
    });
    if (!response.ok) throw new Error(`Cannot load local rules: ${response.status}`);
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = address;
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');
    // Built-in emulator marker, never ADC, service accounts or production tokens.
    app = initializeApp({ projectId: namespace, databaseURL: `http://${address}/?ns=${namespace}`,
      credential: { getAccessToken: async () => ({ access_token: 'owner', expires_in: 3600 }) } }, `local-scale-${port}`);
    try { return await run(getDatabase(app)); } finally { await deleteApp(app); app = null; }
  } finally {
    if (previous === undefined) delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    else process.env.FIREBASE_DATABASE_EMULATOR_HOST = previous;
    if (child.pid && child.exitCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exit;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
