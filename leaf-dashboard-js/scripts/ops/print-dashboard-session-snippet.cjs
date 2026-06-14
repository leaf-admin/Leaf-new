#!/usr/bin/env node

'use strict';

const fs = require('fs');

const input = fs.readFileSync(0, 'utf8');
const session = JSON.parse(input);

if (!session.accessToken || !session.refreshToken || !session.user) {
  console.error('[dashboard-session] arquivo de sessao invalido');
  process.exit(1);
}

const userJson = JSON.stringify(session.user);
const accessToken = JSON.stringify(session.accessToken);
const refreshToken = JSON.stringify(session.refreshToken);

console.log([
  'sessionStorage.setItem("leaf_admin_access_token", ' + accessToken + ');',
  'sessionStorage.setItem("leaf_admin_refresh_token", ' + refreshToken + ');',
  'sessionStorage.setItem("leaf_admin_user", ' + JSON.stringify(userJson) + ');',
  'location.href = "/dashboard";'
].join('\n'));
