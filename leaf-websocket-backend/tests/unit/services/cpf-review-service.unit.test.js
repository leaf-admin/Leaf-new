const { memoryFirestore } = require('../helpers/lifecycle-memory.cjs');
const { decideCpfReview, reviewKey } = require('../../../services/cpf-review-service');
const { claimCpf } = require('../../../services/cpf-identity-registry-service');
const cpf = '12345678909';
const now = Date.parse('2026-09-07T00:00:00Z');
const input = { action: 'restrict', expectedRevision: 0, decisionReason: 'Documented review',
  reason: 'fraud_confirmed', evidenceRef: 'ticket-1', legalBasis: 'approved-policy-reference',
  reviewAt: '2026-09-08T00:00:00Z', expiresAt: '2026-09-09T00:00:00Z' };
let previousEnabled;
let previousKey;
beforeEach(() => {
  previousEnabled = process.env.CPF_REVIEW_ENABLED; previousKey = process.env.CPF_REVIEW_HMAC_KEY;
  process.env.CPF_REVIEW_ENABLED = 'true'; process.env.CPF_REVIEW_HMAC_KEY = 'unit-test-only-key'.repeat(3);
  jest.useFakeTimers().setSystemTime(now);
});
afterEach(() => {
  jest.useRealTimers();
  if (previousEnabled === undefined) delete process.env.CPF_REVIEW_ENABLED; else process.env.CPF_REVIEW_ENABLED = previousEnabled;
  if (previousKey === undefined) delete process.env.CPF_REVIEW_HMAC_KEY; else process.env.CPF_REVIEW_HMAC_KEY = previousKey;
});

test('protected restriction blocks profile/CPF commit and release allows a fresh registration', async () => {
  const firestore = memoryFirestore();
  const decision = await decideCpfReview({ firestore, cpf, input, actor: 'admin-1', now });
  await expect(claimCpf({ firestore, userId: 'new', cpf, profile: { name: 'new' } }))
    .rejects.toMatchObject({ code: 'PROFILE_CPF_REVIEW_REQUIRED', reviewReference: decision.caseId });
  expect(firestore.records.has('users/new')).toBe(false);
  expect(JSON.stringify([...firestore.records])).not.toContain(cpf);
  await decideCpfReview({ firestore, input: { action: 'release', caseId: decision.caseId,
    expectedRevision: 1, decisionReason: 'Appeal upheld: ticket-2' }, actor: 'admin-2', now });
  await expect(claimCpf({ firestore, userId: 'new', cpf })).resolves.toMatchObject({ digits: cpf });
});

test('expiry stops blocking without extending retention; explicit cleanup is audited', async () => {
  const firestore = memoryFirestore();
  const decision = await decideCpfReview({ firestore, cpf, input, actor: 'admin-1', now });
  jest.setSystemTime(Date.parse(input.expiresAt));
  await expect(claimCpf({ firestore, userId: 'new', cpf })).resolves.toMatchObject({ digits: cpf });
  await decideCpfReview({ firestore, input: { action: 'expire', caseId: decision.caseId,
    expectedRevision: 1, decisionReason: 'Retention ended' }, actor: 'admin-2', now: Date.now() });
  expect(firestore.records.has(`cpf_review_restrictions/${reviewKey(cpf)}`)).toBe(false);
  expect([...firestore.records.values()]).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'expire', actor: 'admin-2' })]));
});

test.each([
  { reason: 'suspicion' }, { legalBasis: '' }, { evidenceRef: '' },
  { expiresAt: '2026-09-06T00:00:00Z' }, { reviewAt: '2026-09-10T00:00:00Z' }
])('rejects an unjustified or unbounded restriction: %j', async patch => {
  const firestore = memoryFirestore();
  await expect(decideCpfReview({ firestore, cpf, input: { ...input, ...patch }, actor: 'admin', now })).rejects.toThrow();
  expect(firestore.records.size).toBe(0);
});

test('stale revision cannot release or overwrite a case', async () => {
  const firestore = memoryFirestore();
  const decision = await decideCpfReview({ firestore, cpf, input, actor: 'admin', now });
  await expect(decideCpfReview({ firestore, input: { action: 'release', caseId: decision.caseId,
    expectedRevision: 0, decisionReason: 'stale' }, actor: 'admin', now })).rejects.toMatchObject({ status: 409 });
});

test('enabled enforcement fails closed without a dedicated HMAC key', async () => {
  delete process.env.CPF_REVIEW_HMAC_KEY;
  await expect(claimCpf({ firestore: memoryFirestore(), userId: 'new', cpf }))
    .rejects.toMatchObject({ code: 'CPF_REVIEW_CONFIG_UNAVAILABLE', status: 503 });
});
