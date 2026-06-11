#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const defaultApiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.LEAF_API_URL || 'https://api.leaf.app.br/api';
const apiUrl = String(process.env.LEAF_DASHBOARD_API_URL || defaultApiUrl).replace(/\/+$/, '');
const email = process.env.LEAF_DASHBOARD_ADMIN_EMAIL || process.env.ADMIN_AUTH_EMAIL || process.env.TEST_ADMIN_EMAIL;
const password = process.env.LEAF_DASHBOARD_ADMIN_PASSWORD || process.env.ADMIN_AUTH_PASSWORD || process.env.TEST_ADMIN_PASSWORD;
const outputPath = process.env.LEAF_DASHBOARD_SESSION_PATH || path.join(os.homedir(), '.leaf', 'dashboard-session.json');

function fail(message) {
  console.error(`[dashboard-session] ${message}`);
  process.exit(1);
}

async function main() {
  if (!email || !password) {
    fail([
      'defina LEAF_DASHBOARD_ADMIN_EMAIL e LEAF_DASHBOARD_ADMIN_PASSWORD.',
      'Nada e gravado no repo; a sessao local vai para ~/.leaf/dashboard-session.json.'
    ].join(' '));
  }

  const response = await fetch(`${apiUrl}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true) {
    fail(`login admin falhou (${response.status}): ${payload?.error || payload?.message || 'sem detalhe'}`);
  }

  const session = {
    apiUrl,
    createdAt: new Date().toISOString(),
    expiresIn: payload.expiresIn || null,
    user: payload.user || null,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, JSON.stringify(session, null, 2), { mode: 0o600 });
  fs.chmodSync(outputPath, 0o600);

  console.log(`[dashboard-session] sessao criada: ${outputPath}`);
  console.log(`[dashboard-session] usuario: ${session.user?.email || email} (${session.user?.role || 'role desconhecida'})`);
  console.log('[dashboard-session] para injetar no browser local, rode:');
  console.log(`node leaf-dashboard-js/scripts/ops/print-dashboard-session-snippet.cjs < ${outputPath}`);
}

main().catch((error) => {
  fail(error?.message || String(error));
});
