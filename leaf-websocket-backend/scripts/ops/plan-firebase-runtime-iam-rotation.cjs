#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  FORBIDDEN_BUCKET_PERMISSIONS,
  FORBIDDEN_PROJECT_PERMISSIONS,
  REQUIRED_BUCKET_PERMISSIONS,
  REQUIRED_PROJECT_PERMISSIONS
} = require('./preflight-firebase-runtime-iam.cjs');

const PROJECT_ROLE_ID = 'leafFirebaseRuntimeProject';
const STORAGE_ROLE_ID = 'leafFirebaseRuntimeStorage';
const DEFAULT_SERVICE_ACCOUNT_ID = 'leaf-firebase-runtime';
const backendRoot = path.resolve(__dirname, '../..');
const PROJECT_ROLE_PATH = path.join(
  backendRoot,
  'config/iam/firebase-runtime-project-role.json'
);
const STORAGE_ROLE_PATH = path.join(
  backendRoot,
  'config/iam/firebase-runtime-storage-role.json'
);

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function readRoleDefinition(rolePath) {
  return JSON.parse(fs.readFileSync(rolePath, 'utf8'));
}

function validateRoleDefinition({ definition, requiredPermissions, forbiddenPermissions, label }) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error(`${label}: definição inválida`);
  }
  const allowedKeys = ['description', 'includedPermissions', 'stage', 'title'];
  const unexpectedKeys = Object.keys(definition).filter((key) => !allowedKeys.includes(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`${label}: campos não aceitos pela CLI: ${unexpectedKeys.sort().join(', ')}`);
  }
  if (!String(definition.title || '').trim() || !String(definition.description || '').trim()) {
    throw new Error(`${label}: título e descrição são obrigatórios`);
  }
  if (definition.stage !== 'GA') {
    throw new Error(`${label}: stage deve permanecer GA`);
  }
  if (!Array.isArray(definition.includedPermissions)) {
    throw new Error(`${label}: includedPermissions deve ser uma lista`);
  }

  const declared = definition.includedPermissions;
  const duplicates = declared.filter((permission, index) => declared.indexOf(permission) !== index);
  if (duplicates.length > 0) {
    throw new Error(`${label}: permissões duplicadas: ${sortedUnique(duplicates).join(', ')}`);
  }
  const forbidden = declared.filter((permission) => forbiddenPermissions.includes(permission));
  if (forbidden.length > 0) {
    throw new Error(`${label}: permissões proibidas: ${forbidden.sort().join(', ')}`);
  }

  const expected = sortedUnique(requiredPermissions);
  const actual = sortedUnique(declared);
  const missing = expected.filter((permission) => !actual.includes(permission));
  const excessive = actual.filter((permission) => !expected.includes(permission));
  if (missing.length > 0 || excessive.length > 0) {
    throw new Error(
      `${label}: boundary divergente; ausentes=[${missing.join(', ')}] excessivas=[${excessive.join(', ')}]`
    );
  }
  return true;
}

function validateIdentifiers({ projectId, bucketName, serviceAccountId }) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('FIREBASE_PROJECT_ID inválido para o plano IAM');
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucketName)) {
    throw new Error('FIREBASE_STORAGE_BUCKET inválido para o plano IAM');
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(serviceAccountId)) {
    throw new Error('FIREBASE_RUNTIME_SERVICE_ACCOUNT_ID inválido para o plano IAM');
  }
}

function loadAndValidateRoleDefinitions() {
  const projectRole = readRoleDefinition(PROJECT_ROLE_PATH);
  const storageRole = readRoleDefinition(STORAGE_ROLE_PATH);
  validateRoleDefinition({
    definition: projectRole,
    requiredPermissions: REQUIRED_PROJECT_PERMISSIONS,
    forbiddenPermissions: FORBIDDEN_PROJECT_PERMISSIONS,
    label: 'project-role'
  });
  validateRoleDefinition({
    definition: storageRole,
    requiredPermissions: REQUIRED_BUCKET_PERMISSIONS,
    forbiddenPermissions: FORBIDDEN_BUCKET_PERMISSIONS,
    label: 'storage-role'
  });
  return { projectRole, storageRole };
}

function buildRotationPlan({ projectId, bucketName, serviceAccountId = DEFAULT_SERVICE_ACCOUNT_ID }) {
  validateIdentifiers({ projectId, bucketName, serviceAccountId });
  const { projectRole, storageRole } = loadAndValidateRoleDefinitions();
  const serviceAccountEmail = `${serviceAccountId}@${projectId}.iam.gserviceaccount.com`;
  return {
    ok: true,
    mode: 'plan_only',
    mutatesCloud: false,
    authorizationRequiredForApply: true,
    target: {
      projectId,
      bucketName,
      serviceAccountEmail,
      projectRole: `projects/${projectId}/roles/${PROJECT_ROLE_ID}`,
      storageRole: `projects/${projectId}/roles/${STORAGE_ROLE_ID}`
    },
    boundaries: {
      projectPermissionCount: projectRole.includedPermissions.length,
      bucketPermissionCount: storageRole.includedPermissions.length,
      grantsBasicRole: false,
      grantsBucketAdministration: false,
      grantsBackupAdministration: false,
      grantsIamAdministration: false
    },
    sequence: [
      'create_or_update_custom_roles',
      'create_dedicated_service_account',
      'bind_project_role_on_project',
      'bind_storage_role_on_canonical_bucket_only',
      'create_new_key_into_secure_temporary_path',
      'run_candidate_iam_preflight_and_data_plane_canary',
      'rotate_contabo_credential_atomically_and_roll_gateways',
      'observe_health_and_error_budget',
      'disable_previous_runtime_key_only_after_stability_window'
    ],
    rollback: [
      'restore_previous_credential_file',
      'roll_gateways_with_previous_credential',
      're_enable_previous_key_if_it_was_already_disabled'
    ],
    prohibited: [
      'delete_previous_key_during_initial_rotation',
      'remove_previous_service_account_roles_before_canary',
      'grant_editor_owner_or_storage_admin_to_runtime'
    ]
  };
}

function main() {
  try {
    const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
    const bucketName = String(process.env.FIREBASE_STORAGE_BUCKET || '').trim();
    const serviceAccountId = String(
      process.env.FIREBASE_RUNTIME_SERVICE_ACCOUNT_ID || DEFAULT_SERVICE_ACCOUNT_ID
    ).trim();
    const plan = buildRotationPlan({ projectId, bucketName, serviceAccountId });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_SERVICE_ACCOUNT_ID,
  PROJECT_ROLE_ID,
  PROJECT_ROLE_PATH,
  STORAGE_ROLE_ID,
  STORAGE_ROLE_PATH,
  buildRotationPlan,
  loadAndValidateRoleDefinitions,
  readRoleDefinition,
  sortedUnique,
  validateIdentifiers,
  validateRoleDefinition
};
