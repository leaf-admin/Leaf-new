const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const backendRoot = path.join(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(backendRoot, relative), 'utf8');

// The CTO bot (~/.leaf-bots/bin/leaf-deploy) and people use these scripts for
// production deploys and rollbacks; these checks keep the guarded paths intact.
describe('production rollback contract', () => {
  const deploy = read('scripts/deploy-contabo-docker.sh');
  const santiago = read('scripts/deploy-santiago-docker.sh');
  const dashboard = read('../leaf-dashboard-js/scripts/deploy-contabo-dashboard.sh');

  it('restores a named backup with the same steps as the automatic rollback', () => {
    expect(deploy).toMatch(/^restore_remote_backup\(\) \{/m);
    const automatic = deploy.slice(deploy.indexOf('rollback_on_error() {'), deploy.indexOf('trap rollback_on_error ERR'));
    expect(automatic).toContain('restore_remote_backup');
    const manual = deploy.slice(deploy.indexOf('if [[ -n "$ROLLBACK_TO_BACKUP" ]]; then\n  trap - ERR'));
    expect(manual).toContain('if restore_remote_backup; then');
  });

  it('ships no release in rollback mode: it exits before staging, sync and the release checks', () => {
    const rollbackBlock = deploy.indexOf('if [[ -n "$ROLLBACK_TO_BACKUP" ]]; then\n  trap - ERR');
    expect(rollbackBlock).toBeGreaterThan(-1);
    expect(rollbackBlock).toBeLessThan(deploy.indexOf('git -C "$REPO_ROOT" archive'));
    expect(rollbackBlock).toBeLessThan(deploy.indexOf('Synchronizing tracked application source'));
    expect(deploy).toContain('# A rollback restores a backup that is already on the host; it ships no release.\nif [[ -z "$ROLLBACK_TO_BACKUP" ]]; then');
    expect(deploy).toContain('That backup holds the release already running');
  });

  it('refuses an unexpected backup name before touching any host', () => {
    const result = spawnSync('bash', [path.join(backendRoot, 'scripts/deploy-contabo-docker.sh')], {
      env: { ...process.env, ROLLBACK_TO_BACKUP: '../../etc', CONFIRM_PRODUCTION_DEPLOY: 'true', CONTABO_HOST: '127.0.0.1' },
      encoding: 'utf8'
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('ROLLBACK_TO_BACKUP must be latest or modular-rollout-YYYYMMDD-HHMMSS');
  });

  it('keeps the rollback images on Santiago: no prune or standby refresh after a rollback', () => {
    const exitIndex = santiago.indexOf('if [ -n "${ROLLBACK_TO_BACKUP:-}" ]; then\n  exit 0');
    expect(exitIndex).toBeGreaterThan(santiago.indexOf('deploy-contabo-docker.sh" "$@"'));
    expect(exitIndex).toBeLessThan(santiago.indexOf('prune-leaf-images.sh'));
  });

  it('deploys the dashboard only from origin/main and never deletes host files', () => {
    expect(dashboard).toContain('CONFIRM_PRODUCTION_DEPLOY=true to authorize');
    expect(dashboard).toContain('Production deploy must run from main.');
    expect(dashboard).toContain('HEAD must match origin/main.');
    expect(dashboard).not.toMatch(/rsync[^\n]*--delete/);
    expect(dashboard).toContain('--exclude .env.production.local');
    expect(dashboard).toContain("docker tag leaf-dashboard:contabo 'leaf-dashboard:rollback-$stamp'");
    expect(dashboard).toMatch(/\^rollback-\[0-9\]\{8\}-\[0-9\]\{6\}\$/);
  });

  it('refuses a dashboard rollback tag that is not a rollback image', () => {
    const result = spawnSync('bash', [path.join(backendRoot, '../leaf-dashboard-js/scripts/deploy-contabo-dashboard.sh'), 'rollback', 'latest;rm'], {
      env: { ...process.env, CONFIRM_PRODUCTION_DEPLOY: 'true', DASHBOARD_SSH: 'invalid.invalid' },
      encoding: 'utf8'
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Invalid rollback tag');
  });
});
