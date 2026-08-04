const fs = require('fs');
const {
  FORBIDDEN_BUCKET_PERMISSIONS,
  FORBIDDEN_PROJECT_PERMISSIONS,
  REQUIRED_BUCKET_PERMISSIONS,
  REQUIRED_PROJECT_PERMISSIONS
} = require('../../../scripts/ops/preflight-firebase-runtime-iam.cjs');
const {
  PROJECT_ROLE_PATH,
  STORAGE_ROLE_PATH,
  buildRotationPlan,
  loadAndValidateRoleDefinitions,
  validateIdentifiers,
  validateRoleDefinition
} = require('../../../scripts/ops/plan-firebase-runtime-iam-rotation.cjs');

describe('Firebase runtime IAM rotation plan', () => {
  it('keeps both gcloud-compatible role files exactly aligned with the live preflight', () => {
    const { projectRole, storageRole } = loadAndValidateRoleDefinitions();

    expect(Object.keys(projectRole).sort()).toEqual([
      'description',
      'includedPermissions',
      'stage',
      'title'
    ]);
    expect(Object.keys(storageRole).sort()).toEqual([
      'description',
      'includedPermissions',
      'stage',
      'title'
    ]);
    expect([...projectRole.includedPermissions].sort()).toEqual(
      [...REQUIRED_PROJECT_PERMISSIONS].sort()
    );
    expect([...storageRole.includedPermissions].sort()).toEqual(
      [...REQUIRED_BUCKET_PERMISSIONS].sort()
    );
    expect(fs.existsSync(PROJECT_ROLE_PATH)).toBe(true);
    expect(fs.existsSync(STORAGE_ROLE_PATH)).toBe(true);
  });

  it('rejects forbidden, missing, excessive and duplicate permissions', () => {
    const base = {
      title: 'Runtime',
      description: 'Runtime boundary',
      stage: 'GA',
      includedPermissions: [...REQUIRED_PROJECT_PERMISSIONS]
    };

    expect(() => validateRoleDefinition({
      definition: {
        ...base,
        includedPermissions: [
          ...base.includedPermissions,
          'datastore.databases.update'
        ]
      },
      requiredPermissions: REQUIRED_PROJECT_PERMISSIONS,
      forbiddenPermissions: FORBIDDEN_PROJECT_PERMISSIONS,
      label: 'project-role'
    })).toThrow('permissões proibidas');

    expect(() => validateRoleDefinition({
      definition: {
        ...base,
        includedPermissions: base.includedPermissions.slice(1)
      },
      requiredPermissions: REQUIRED_PROJECT_PERMISSIONS,
      forbiddenPermissions: FORBIDDEN_PROJECT_PERMISSIONS,
      label: 'project-role'
    })).toThrow('boundary divergente');

    expect(() => validateRoleDefinition({
      definition: {
        ...base,
        includedPermissions: [...base.includedPermissions, 'logging.logEntries.create']
      },
      requiredPermissions: REQUIRED_PROJECT_PERMISSIONS,
      forbiddenPermissions: FORBIDDEN_PROJECT_PERMISSIONS,
      label: 'project-role'
    })).toThrow('boundary divergente');

    expect(() => validateRoleDefinition({
      definition: {
        ...base,
        includedPermissions: [
          ...base.includedPermissions,
          base.includedPermissions[0]
        ]
      },
      requiredPermissions: REQUIRED_PROJECT_PERMISSIONS,
      forbiddenPermissions: FORBIDDEN_PROJECT_PERMISSIONS,
      label: 'project-role'
    })).toThrow('permissões duplicadas');
  });

  it('rejects metadata that cannot be passed directly to gcloud role files', () => {
    expect(() => validateRoleDefinition({
      definition: {
        title: 'Storage runtime',
        description: 'Storage boundary',
        stage: 'GA',
        includedPermissions: [...REQUIRED_BUCKET_PERMISSIONS],
        roleId: 'unexpected'
      },
      requiredPermissions: REQUIRED_BUCKET_PERMISSIONS,
      forbiddenPermissions: FORBIDDEN_BUCKET_PERMISSIONS,
      label: 'storage-role'
    })).toThrow('campos não aceitos pela CLI');
  });

  it('builds a plan that scopes object access to one bucket and disables instead of deleting', () => {
    const plan = buildRotationPlan({
      projectId: 'leaf-reactnative',
      bucketName: 'leaf-reactnative.firebasestorage.app',
      serviceAccountId: 'leaf-firebase-runtime'
    });

    expect(plan).toMatchObject({
      ok: true,
      mode: 'plan_only',
      mutatesCloud: false,
      authorizationRequiredForApply: true,
      target: {
        serviceAccountEmail: 'leaf-firebase-runtime@leaf-reactnative.iam.gserviceaccount.com',
        projectRole: 'projects/leaf-reactnative/roles/leafFirebaseRuntimeProject',
        storageRole: 'projects/leaf-reactnative/roles/leafFirebaseRuntimeStorage'
      },
      boundaries: {
        projectPermissionCount: REQUIRED_PROJECT_PERMISSIONS.length,
        bucketPermissionCount: REQUIRED_BUCKET_PERMISSIONS.length,
        grantsBasicRole: false,
        grantsBucketAdministration: false,
        grantsBackupAdministration: false,
        grantsIamAdministration: false
      }
    });
    expect(plan.sequence).toContain('bind_storage_role_on_canonical_bucket_only');
    expect(plan.sequence).toContain('disable_previous_runtime_key_only_after_stability_window');
    expect(plan.prohibited).toContain('delete_previous_key_during_initial_rotation');
    expect(JSON.stringify(plan)).not.toContain('roles/editor');
    expect(JSON.stringify(plan)).not.toContain('roles/storage.admin');
  });

  it('rejects identifiers that could expand or inject the target scope', () => {
    expect(() => validateIdentifiers({
      projectId: 'leaf-reactnative; rm',
      bucketName: 'leaf-reactnative.firebasestorage.app',
      serviceAccountId: 'leaf-firebase-runtime'
    })).toThrow('FIREBASE_PROJECT_ID inválido');
    expect(() => validateIdentifiers({
      projectId: 'leaf-reactnative',
      bucketName: '*',
      serviceAccountId: 'leaf-firebase-runtime'
    })).toThrow('FIREBASE_STORAGE_BUCKET inválido');
    expect(() => validateIdentifiers({
      projectId: 'leaf-reactnative',
      bucketName: 'leaf-reactnative.firebasestorage.app',
      serviceAccountId: 'runtime@other-project'
    })).toThrow('FIREBASE_RUNTIME_SERVICE_ACCOUNT_ID inválido');
  });
});
