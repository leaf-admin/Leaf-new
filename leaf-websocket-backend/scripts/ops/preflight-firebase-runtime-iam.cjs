#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const FORBIDDEN_PROJECT_PERMISSIONS = Object.freeze([
  'datastore.backupSchedules.create',
  'datastore.backupSchedules.delete',
  'datastore.backups.delete',
  'datastore.backups.restoreDatabase',
  'datastore.databases.delete',
  'datastore.databases.update',
  'resourcemanager.projects.delete',
  'resourcemanager.projects.setIamPolicy'
]);

const FORBIDDEN_BUCKET_PERMISSIONS = Object.freeze([
  'storage.buckets.delete',
  'storage.buckets.setIamPolicy',
  'storage.buckets.update'
]);

function readBooleanLike(value, fallback = false) {
  if (value == null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function shouldEnforce(environment = process.env) {
  const nodeEnv = String(environment.NODE_ENV || '').trim().toLowerCase();
  return readBooleanLike(environment.FIREBASE_RUNTIME_IAM_PREFLIGHT_REQUIRED, false)
    || (nodeEnv === 'production'
      && readBooleanLike(environment.LEAF_BROAD_LAUNCH_APPROVED, false));
}

function parseCredentialJson(rawValue, source) {
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid_shape');
    }
    if (!String(parsed.project_id || '').trim() || !String(parsed.client_email || '').trim()) {
      throw new Error('missing_identity');
    }
    return parsed;
  } catch (_error) {
    throw new Error(`Credencial Firebase inválida em ${source}`);
  }
}

function resolveCredentialJson(environment = process.env) {
  const inline = String(
    environment.FIREBASE_SERVICE_ACCOUNT_JSON
      || environment.GOOGLE_APPLICATION_CREDENTIALS_JSON
      || ''
  ).trim();
  if (inline) {
    return parseCredentialJson(inline, 'FIREBASE_SERVICE_ACCOUNT_JSON/GOOGLE_APPLICATION_CREDENTIALS_JSON');
  }

  const configuredPath = String(environment.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (!configuredPath) {
    throw new Error('Credencial Firebase ausente para o preflight IAM');
  }
  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error('Arquivo de credencial Firebase não encontrado para o preflight IAM');
  }
  return parseCredentialJson(fs.readFileSync(absolutePath, 'utf8'), 'GOOGLE_APPLICATION_CREDENTIALS');
}

function resolveAuditTarget(credentialJson, environment = process.env) {
  const credentialProjectId = String(credentialJson.project_id || '').trim();
  const configuredProjectId = String(environment.FIREBASE_PROJECT_ID || '').trim();
  if (configuredProjectId && configuredProjectId !== credentialProjectId) {
    throw new Error('FIREBASE_PROJECT_ID diverge do projeto da credencial do runtime');
  }

  const bucketName = String(environment.FIREBASE_STORAGE_BUCKET || '').trim();
  if (!bucketName) {
    throw new Error('FIREBASE_STORAGE_BUCKET é obrigatório para o preflight IAM');
  }

  return {
    projectId: credentialProjectId,
    bucketName
  };
}

async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_error) {
    throw new Error(`Resposta inválida do preflight IAM (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(
      `Preflight IAM recusado (${response.status}): ${body?.error?.message || 'falha da API'}`
    );
  }
  return body;
}

async function testProjectPermissions({ fetchImpl, token, projectId }) {
  const body = await requestJson(
    fetchImpl,
    `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:testIamPermissions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ permissions: FORBIDDEN_PROJECT_PERMISSIONS })
    }
  );
  return Array.isArray(body.permissions) ? body.permissions : [];
}

async function testBucketPermissions({ fetchImpl, token, bucketName }) {
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/iam/testPermissions`
  );
  for (const permission of FORBIDDEN_BUCKET_PERMISSIONS) {
    url.searchParams.append('permissions', permission);
  }
  const body = await requestJson(fetchImpl, url, {
    headers: { authorization: `Bearer ${token}` }
  });
  return Array.isArray(body.permissions) ? body.permissions : [];
}

function evaluatePermissionBoundary({ projectPermissions = [], bucketPermissions = [] }) {
  const grantedForbiddenPermissions = [...new Set([
    ...projectPermissions.filter((permission) => FORBIDDEN_PROJECT_PERMISSIONS.includes(permission)),
    ...bucketPermissions.filter((permission) => FORBIDDEN_BUCKET_PERMISSIONS.includes(permission))
  ])].sort();

  return {
    ok: grantedForbiddenPermissions.length === 0,
    grantedForbiddenPermissions
  };
}

async function runPreflight({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  adminImpl = admin
} = {}) {
  if (!shouldEnforce(environment)) {
    return {
      ok: true,
      skipped: true,
      reason: 'not_required_outside_broad_launch'
    };
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Runtime sem fetch para executar o preflight IAM');
  }

  const credentialJson = resolveCredentialJson(environment);
  const { projectId, bucketName } = resolveAuditTarget(credentialJson, environment);
  const appName = `firebase-runtime-iam-preflight-${process.pid}-${Date.now()}`;
  const credential = adminImpl.credential.cert(credentialJson);
  const app = adminImpl.initializeApp({ credential, projectId }, appName);

  try {
    const tokenResult = await credential.getAccessToken();
    const token = String(tokenResult?.access_token || '').trim();
    if (!token) throw new Error('Token OAuth ausente no preflight IAM');

    const [projectPermissions, bucketPermissions] = await Promise.all([
      testProjectPermissions({ fetchImpl, token, projectId }),
      testBucketPermissions({ fetchImpl, token, bucketName })
    ]);
    const boundary = evaluatePermissionBoundary({ projectPermissions, bucketPermissions });

    return {
      ...boundary,
      skipped: false,
      projectId,
      bucketName,
      checkedPermissionCount:
        FORBIDDEN_PROJECT_PERMISSIONS.length + FORBIDDEN_BUCKET_PERMISSIONS.length
    };
  } finally {
    await app.delete();
  }
}

async function main() {
  try {
    const report = await runPreflight();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  FORBIDDEN_BUCKET_PERMISSIONS,
  FORBIDDEN_PROJECT_PERMISSIONS,
  evaluatePermissionBoundary,
  parseCredentialJson,
  readBooleanLike,
  requestJson,
  resolveAuditTarget,
  resolveCredentialJson,
  runPreflight,
  shouldEnforce,
  testBucketPermissions,
  testProjectPermissions
};
