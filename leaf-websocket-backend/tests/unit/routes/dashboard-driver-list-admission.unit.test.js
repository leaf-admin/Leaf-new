const { EventEmitter } = require('node:events');
const mockRoutes = new Map();
const mockRouter = new Proxy({}, { get: (_target, method) => (path, ...handlers) => {
  mockRoutes.set(`${method}:${path}`, handlers); return mockRouter;
} });
const mockReadPage = jest.fn();
jest.mock('../../../services/dashboard-driver-list-data', () => ({ readPage: (...args) => mockReadPage(...args) }));
jest.mock('../../../services/promotion-service', () => ({}));
jest.mock('../../../routes/dashboard/shared', () => new Proxy({
  router: mockRouter,
  authenticateJWT: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
  firebaseConfig: { getRealtimeDB: () => ({}), getFirestore: () => ({}) },
  logger: { error: jest.fn() }
}, { get: (target, name) => name in target ? target[name] : () => {} }));

require('../../../routes/dashboard/08-driver-plans-and-status');

function response() {
  const res = new EventEmitter();
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

test('admission remains held until DB work finishes, even if the HTTP clients close', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  mockReadPage.mockImplementation(() => pending);
  const handlers = mockRoutes.get('get:/api/drivers/complete');
  const run = handlers[handlers.length - 1];
  const a = response(); const b = response(); const c = response();
  const req = { query: {} };
  const first = run(req, a);
  const second = run(req, b);
  a.emit('close'); b.emit('close');
  await run(req, c);
  expect(c.status).toHaveBeenCalledWith(503);
  expect(mockReadPage).toHaveBeenCalledTimes(2);
  release({ users: {}, carsByDriver: new Map(), statsByDriver: new Map(), mode: 'legacy-bounded' });
  await Promise.all([first, second]);
  const after = response();
  await run(req, after);
  expect(after.status).not.toHaveBeenCalledWith(503);
  expect(mockReadPage).toHaveBeenCalledTimes(3);
});


test('legacy approval filter uses the requested status rather than the derived local variable', async () => {
  mockReadPage.mockResolvedValueOnce({ users: {
    approved: { approved: true, firstName: 'Approved' },
    pending: { approved: false, firstName: 'Pending', licenseImage: 'synthetic-document-url' }
  }, carsByDriver: new Map(), statsByDriver: new Map(), mode: 'legacy-bounded' });
  const handlers = mockRoutes.get('get:/api/drivers/complete');
  const res = response();
  await handlers[handlers.length - 1]({ query: { approvalStatus: 'pending' } }, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ drivers: [expect.objectContaining({ id: 'pending' })] }));
});
