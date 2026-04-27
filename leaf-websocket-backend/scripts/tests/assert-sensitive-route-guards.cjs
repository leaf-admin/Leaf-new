#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
}

function routeLines(source) {
  return source
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => /router\.(get|post|put|patch|delete)\s*\(/.test(line));
}

function extractPath(line) {
  const match = line.match(/router\.(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/);
  return match ? match[1] : null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertLineHasToken({ file, line, lineNumber, token }) {
  assert(
    line.includes(token),
    `${file}:${lineNumber} rota sensivel sem ${token}: ${line.trim()}`
  );
}

function main() {
  const failures = [];
  const check = (fn) => {
    try {
      fn();
    } catch (error) {
      failures.push(error.message);
    }
  };

  check(() => {
    const file = 'routes/dashboard.js';
    const source = read(file);
    assert(source.includes('function hardenDashboardApiRoutes'), `${file} sem hardenDashboardApiRoutes`);
    assert(source.includes('hardenDashboardApiRoutes();'), `${file} nao aplica hardenDashboardApiRoutes()`);
    assert(source.includes('rejectDashboardMockEndpointInProduction'), `${file} sem bloqueio de mock em producao`);
  });

  check(() => {
    const file = 'routes/payment.js';
    for (const item of routeLines(read(file))) {
      const routePath = extractPath(item.line);
      if (!routePath || !routePath.startsWith('/payment')) continue;
      assertLineHasToken({ file, ...item, token: 'authenticatePaymentActor' });
    }
  });

  check(() => {
    const file = 'routes/woovi.js';
    for (const item of routeLines(read(file))) {
      const routePath = extractPath(item.line);
      if (!routePath || !routePath.startsWith('/woovi')) continue;
      if (routePath === '/woovi/webhook' || routePath === '/woovi-webhook') continue;
      assertLineHasToken({ file, ...item, token: 'authenticateJWT' });
    }
    assert(read(file).includes('verifyWooviWebhookSignature'), `${file} sem verifyWooviWebhookSignature`);
  });

  check(() => {
    const file = 'routes/driver-approval.js';
    const source = read(file);
    assert(source.includes('authenticateJWT'), `${file} sem authenticateJWT`);
    assert(source.includes('requireRole'), `${file} sem requireRole`);
    assert(!source.includes('TODO: Implementar autenticação de admin'), `${file} com TODO de autenticação`);
  });

  check(() => {
    const file = 'routes/woovi-driver.js';
    const source = read(file);
    assert(source.includes('authenticateJWT'), `${file} sem authenticateJWT`);
    assert(source.includes('requireRole'), `${file} sem requireRole`);
    assert(!source.includes('TODO: Implementar autenticação do motorista'), `${file} com TODO de autenticação`);
  });

  check(() => {
    const file = 'routes/geofence-routes.js';
    for (const item of routeLines(read(file))) {
      const routePath = extractPath(item.line);
      if (!routePath || !routePath.startsWith('/admin')) continue;
      assertLineHasToken({ file, ...item, token: 'authenticateJWT' });
    }
  });

  check(() => {
    const file = 'routes/waitlist.js';
    const sensitivePrefixes = [
      '/api/waitlist/drivers',
      '/api/waitlist/approve',
      '/api/waitlist/reject',
      '/api/waitlist/position',
      '/api/waitlist/stats',
      '/api/waitlist/landing/list',
      '/api/waitlist/landing/:id'
    ];
    for (const item of routeLines(read(file))) {
      const routePath = extractPath(item.line);
      if (!routePath || !sensitivePrefixes.some((prefix) => routePath.startsWith(prefix))) continue;
      assertLineHasToken({ file, ...item, token: 'authenticateSupport' });
      assertLineHasToken({ file, ...item, token: 'requireSupportRoles' });
    }
  });

  check(() => {
    const file = 'server.vps.js';
    const source = read(file);
    assert(!source.includes("require('./routes/support-routes')"), `${file} ainda registra rota placeholder support-routes`);
  });

  if (failures.length > 0) {
    console.error('Sensitive route guard assertion failed:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log('Sensitive route guard assertion passed.');
}

main();
