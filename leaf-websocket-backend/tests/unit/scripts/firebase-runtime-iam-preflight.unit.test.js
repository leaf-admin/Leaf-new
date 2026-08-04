const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '../../..');
const deployScriptPath = path.join(backendRoot, 'scripts/deploy-contabo-docker.sh');
const {
  FORBIDDEN_BUCKET_PERMISSIONS,
  FORBIDDEN_PROJECT_PERMISSIONS,
  evaluatePermissionBoundary,
  resolveAuditTarget,
  runPreflight,
  shouldEnforce
} = require('../../../scripts/ops/preflight-firebase-runtime-iam.cjs');

describe('Firebase runtime IAM boundary', () => {
  it('does not add a network gate to pilot or local execution by default', () => {
    expect(shouldEnforce({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldEnforce({
      NODE_ENV: 'production',
      LEAF_BROAD_LAUNCH_APPROVED: 'false'
    })).toBe(false);
  });

  it('requires the live audit for broad launch or an explicit operational run', () => {
    expect(shouldEnforce({
      NODE_ENV: 'production',
      LEAF_BROAD_LAUNCH_APPROVED: 'true'
    })).toBe(true);
    expect(shouldEnforce({
      NODE_ENV: 'development',
      FIREBASE_RUNTIME_IAM_PREFLIGHT_REQUIRED: 'true'
    })).toBe(true);
  });

  it('fails when the runtime can mutate recovery controls or delete backups', () => {
    const result = evaluatePermissionBoundary({
      projectPermissions: [
        'datastore.backups.delete',
        'datastore.databases.update'
      ],
      bucketPermissions: [
        'storage.buckets.update',
        'storage.objects.get'
      ]
    });

    expect(result).toEqual({
      ok: false,
      grantedForbiddenPermissions: [
        'datastore.backups.delete',
        'datastore.databases.update',
        'storage.buckets.update'
      ]
    });
  });

  it('passes only when none of the forbidden permissions is granted', () => {
    expect(evaluatePermissionBoundary({
      projectPermissions: ['datastore.entities.get'],
      bucketPermissions: [
        'storage.objects.create',
        'storage.objects.delete',
        'storage.objects.get'
      ]
    })).toEqual({
      ok: true,
      grantedForbiddenPermissions: []
    });
  });

  it('covers database deletion, recovery administration and bucket policy mutation', () => {
    expect(FORBIDDEN_PROJECT_PERMISSIONS).toEqual(expect.arrayContaining([
      'datastore.backupSchedules.delete',
      'datastore.backups.delete',
      'datastore.backups.restoreDatabase',
      'datastore.databases.delete',
      'datastore.databases.update',
      'resourcemanager.projects.setIamPolicy'
    ]));
    expect(FORBIDDEN_BUCKET_PERMISSIONS).toEqual(expect.arrayContaining([
      'storage.buckets.delete',
      'storage.buckets.setIamPolicy',
      'storage.buckets.update'
    ]));
  });

  it('rejects a configured project that differs from the credential project', () => {
    expect(() => resolveAuditTarget({ project_id: 'credential-project' }, {
      FIREBASE_PROJECT_ID: 'other-project',
      FIREBASE_STORAGE_BUCKET: 'bucket.example'
    })).toThrow('FIREBASE_PROJECT_ID diverge');
  });

  it('uses read-only permission probes and never exposes the principal or token', async () => {
    const requests = [];
    const credential = {
      getAccessToken: jest.fn().mockResolvedValue({ access_token: 'private-oauth-token' })
    };
    const deleteApp = jest.fn().mockResolvedValue(undefined);
    const adminImpl = {
      credential: {
        cert: jest.fn().mockReturnValue(credential)
      },
      initializeApp: jest.fn().mockReturnValue({ delete: deleteApp })
    };
    const fetchImpl = jest.fn(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      const isProjectProbe = String(url).includes('cloudresourcemanager.googleapis.com');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          permissions: isProjectProbe ? [] : ['storage.objects.get']
        })
      };
    });
    const environment = {
      NODE_ENV: 'production',
      LEAF_BROAD_LAUNCH_APPROVED: 'true',
      FIREBASE_PROJECT_ID: 'leaf-test-project',
      FIREBASE_STORAGE_BUCKET: 'leaf-test-project.example',
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'leaf-test-project',
        client_email: 'runtime@example.invalid'
      })
    };

    const report = await runPreflight({ environment, fetchImpl, adminImpl });

    expect(report).toMatchObject({
      ok: true,
      skipped: false,
      projectId: 'leaf-test-project',
      bucketName: 'leaf-test-project.example',
      grantedForbiddenPermissions: []
    });
    expect(report).not.toHaveProperty('clientEmail');
    expect(JSON.stringify(report)).not.toContain('private-oauth-token');
    expect(JSON.stringify(report)).not.toContain('runtime@example.invalid');
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.options.method !== 'PUT')).toBe(true);
    expect(requests.every((request) => request.options.method !== 'PATCH')).toBe(true);
    expect(requests.every((request) => request.options.method !== 'DELETE')).toBe(true);
    expect(requests.every((request) => (
      request.options.headers.authorization === 'Bearer private-oauth-token'
    ))).toBe(true);
    expect(deleteApp).toHaveBeenCalledTimes(1);
  });

  it('runs the live preflight against the immutable candidate before rollout', () => {
    const deploySource = fs.readFileSync(deployScriptPath, 'utf8');
    const buildMarker = deploySource.indexOf('echo "[deploy] 4/7 Building modular services"');
    const preflightMarker = deploySource.indexOf('scripts/ops/preflight-firebase-runtime-iam.cjs');
    const rolloutMarker = deploySource.indexOf('echo "[deploy] 5/7 Rolling gateways"');

    expect(buildMarker).toBeGreaterThan(-1);
    expect(preflightMarker).toBeGreaterThan(buildMarker);
    expect(preflightMarker).toBeLessThan(rolloutMarker);
    expect(deploySource).toContain(
      '-v "\\$PWD/firebase-credentials.json:/app/firebase-credentials.json:ro"'
    );
    expect(deploySource).toContain(
      '-e GOOGLE_APPLICATION_CREDENTIALS=/app/firebase-credentials.json'
    );
  });
});
