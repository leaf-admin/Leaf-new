const fs = require('fs');
const path = require('path');

describe('worker health route auth boundary', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../routes/worker-health.js'),
    'utf8'
  );

  it('keeps worker observability endpoints behind support auth', () => {
    expect(source).toContain('const requireWorkerReadAccess = [');
    for (const routePath of [
      '/api/workers/health',
      '/api/workers/consumers',
      '/api/workers/lag',
      '/api/workers/pending',
      '/api/workers/dlq/events',
      '/api/workers/dlq'
    ]) {
      expect(source).toContain(`router.get('${routePath}', ...requireWorkerReadAccess`);
    }
  });
});
