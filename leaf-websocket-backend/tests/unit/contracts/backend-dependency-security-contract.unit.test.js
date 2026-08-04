const fs = require('fs');
const path = require('path');

function numericVersion(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Versão semântica inválida: ${version}`);
  return match.slice(1).map(Number);
}

function expectAtLeast(actual, minimum) {
  const actualParts = numericVersion(actual);
  const minimumParts = numericVersion(minimum);
  for (let index = 0; index < minimumParts.length; index += 1) {
    if (actualParts[index] > minimumParts[index]) return;
    if (actualParts[index] < minimumParts[index]) {
      throw new Error(`Versão ${actual} abaixo do mínimo seguro ${minimum}`);
    }
  }
}

describe('backend production dependency security contract', () => {
  const backendRoot = path.resolve(__dirname, '../../..');
  const repositoryRoot = path.resolve(backendRoot, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));
  const lockfiles = [
    JSON.parse(fs.readFileSync(path.join(backendRoot, 'package-lock.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'))
  ];
  const reportServiceSource = fs.readFileSync(
    path.join(backendRoot, 'services/report-service.js'),
    'utf8'
  );

  function resolvedVersion(lockfile, packageName) {
    return (
      lockfile.packages[`leaf-websocket-backend/node_modules/${packageName}`]?.version ||
      lockfile.packages[`node_modules/${packageName}`]?.version
    );
  }

  test('pins supported direct upgrades that remove live critical and high advisories', () => {
    expect(packageJson.dependencies).toMatchObject({
      'express-rate-limit': '^8.6.1',
      'firebase-admin': '^13.10.0',
      sharp: '^0.35.3',
      'socket.io': '^4.8.3'
    });

    for (const lockfile of lockfiles) {
      expectAtLeast(resolvedVersion(lockfile, 'express-rate-limit'), '8.6.1');
      expectAtLeast(resolvedVersion(lockfile, 'firebase-admin'), '13.10.0');
      expectAtLeast(resolvedVersion(lockfile, 'sharp'), '0.35.3');
      expectAtLeast(resolvedVersion(lockfile, 'socket.io'), '4.8.3');
    }
  });

  test('does not regress patched transitive parsers and network dependencies', () => {
    for (const [packageName, minimumVersion] of Object.entries({
      'body-parser': '1.20.6',
      'fast-xml-parser': '5.10.1',
      'ip-address': '10.4.0',
      'socket.io-parser': '4.2.7',
      'websocket-driver': '0.7.5'
    })) {
      for (const lockfile of lockfiles) {
        expectAtLeast(resolvedVersion(lockfile, packageName), minimumVersion);
      }
    }
  });

  test('removes end-of-life Apollo Server 3 from the production dependency graph', () => {
    expect(packageJson.dependencies).not.toHaveProperty('apollo-server-core');
    expect(packageJson.dependencies).not.toHaveProperty('apollo-server-express');
    for (const lockfile of lockfiles) {
      expect(resolvedVersion(lockfile, 'apollo-server-core')).toBeUndefined();
      expect(resolvedVersion(lockfile, 'apollo-server-express')).toBeUndefined();
    }
    expect(fs.existsSync(path.join(backendRoot, 'graphql/server.js'))).toBe(false);
  });

  test('removes vulnerable XLSX dependency and keeps export fail-closed', () => {
    expect(packageJson.dependencies).not.toHaveProperty('xlsx');
    for (const lockfile of lockfiles) {
      expect(resolvedVersion(lockfile, 'xlsx')).toBeUndefined();
    }
    expect(reportServiceSource).not.toMatch(/require\(['"]xlsx['"]\)/);
    expect(reportServiceSource).toMatch(/isExcelExportEnabled\(\) \{\s+return false;/);
    expect(reportServiceSource).toContain("error.code = 'XLSX_EXPORT_DISABLED_SECURITY'");
  });
});
