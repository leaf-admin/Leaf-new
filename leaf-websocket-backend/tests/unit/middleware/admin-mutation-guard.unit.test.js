const { requireAdminMutationsEnabled } = require('../../../middleware/admin-mutation-guard');

function buildResponse() {
  const response = {
    status: jest.fn(),
    json: jest.fn()
  };
  response.status.mockReturnValue(response);
  return response;
}

describe('admin mutation guard', () => {
  const previousProfile = process.env.LEAF_LAUNCH_PROFILE;
  const previousFlag = process.env.ENABLE_ADMIN_MUTATIONS;

  afterEach(() => {
    if (previousProfile === undefined) delete process.env.LEAF_LAUNCH_PROFILE;
    else process.env.LEAF_LAUNCH_PROFILE = previousProfile;
    if (previousFlag === undefined) delete process.env.ENABLE_ADMIN_MUTATIONS;
    else process.env.ENABLE_ADMIN_MUTATIONS = previousFlag;
  });

  test('blocks mutations when the launch profile is read-only', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'ride_flow_validation';
    delete process.env.ENABLE_ADMIN_MUTATIONS;
    const response = buildResponse();
    const next = jest.fn();

    requireAdminMutationsEnabled(
      {
        method: 'PATCH',
        originalUrl: '/api/geofence/admin/config',
        user: { id: 'admin-1', email: 'admin@example.com', role: 'super-admin' }
      },
      response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'FEATURE_DISABLED_IN_LAUNCH_PROFILE',
      feature: 'admin_mutations'
    }));
  });

  test('allows mutations when explicitly enabled', () => {
    process.env.LEAF_LAUNCH_PROFILE = 'ride_flow_validation';
    process.env.ENABLE_ADMIN_MUTATIONS = 'true';
    const response = buildResponse();
    const next = jest.fn();

    requireAdminMutationsEnabled({ method: 'PATCH', originalUrl: '/api/test' }, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });
});
