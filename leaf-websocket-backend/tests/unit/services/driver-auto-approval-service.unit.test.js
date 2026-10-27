const { createDriverAutoApprovalService, resolveDriverCpf } = require('../../../services/driver-auto-approval-service');
const { createTreeFirestore } = require('../../helpers/rtdb-tree-firestore');

// The user record lives in the native users collection; `db` is only handed
// through to the CPF registry.
let currentFirestore = null;
function fakeDb(user) {
  const state = { users: { d1: JSON.parse(JSON.stringify(user)) } };
  currentFirestore = createTreeFirestore(state);
  const firestore = currentFirestore;
  return {
    state,
    get writes() {
      return firestore.commits;
    }
  };
}

function build(overrides = {}) {
  const deps = {
    env: { ENABLE_DRIVER_AUTO_APPROVAL: 'true' },
    claimCpf: jest.fn().mockResolvedValue({ digits: '12345678909' }),
    assertNotPermanentlyBlocked: jest.fn().mockResolvedValue(undefined),
    auditService: { logEvent: jest.fn().mockResolvedValue(undefined) },
    getFirestore: () => currentFirestore,
    now: () => '2026-10-14T12:00:00.000Z',
    ...overrides
  };
  return { deps, service: createDriverAutoApprovalService(deps) };
}

const ACTIVE = { canGoOnline: true, state: 'ACTIVE', checklist: { cnhEar: true, vehicleRegistration: true } };
const driver = { status: 'pending', documents: { cnh: { extractedData: { cpf: '123.456.789-09' } } } };

describe('driver auto approval', () => {
  it('stays off unless the flag is enabled', async () => {
    const db = fakeDb(driver);
    const { service } = build({ env: {} });
    await expect(service.maybeAutoApprove({ db, driverId: 'd1', canonicalState: ACTIVE })).resolves.toEqual({ approved: false, status: 'disabled' });
    expect(db.writes).toHaveLength(0);
  });

  it('does nothing while the canonical activation is not complete', async () => {
    const db = fakeDb(driver);
    const { service } = build();
    const result = await service.maybeAutoApprove({ db, driverId: 'd1', canonicalState: { canGoOnline: false } });
    expect(result.status).toBe('not_eligible');
    expect(db.writes).toHaveLength(0);
  });

  it('approves when every rule passes, claiming the CNH CPF and auditing', async () => {
    const db = fakeDb(driver);
    const { service, deps } = build();
    const result = await service.maybeAutoApprove({ db, driverId: 'd1', canonicalState: ACTIVE });

    expect(result).toEqual({ approved: true, status: 'approved' });
    expect(deps.claimCpf).toHaveBeenCalledWith(expect.objectContaining({ userId: 'd1', cpf: '123.456.789-09' }));
    expect(db.state.users.d1).toEqual(expect.objectContaining({ approved: true, status: 'approved', approvedBy: 'system:auto_canonical_evidence' }));
    expect(db.state.users.d1.documents.cnh.extractedData.cpf).toBe('123.456.789-09');
    expect(deps.auditService.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'driver.auto_approval' }));
  });

  it('never overrides a manual rejection or an existing approval', async () => {
    const { service } = build();
    expect((await service.maybeAutoApprove({ db: fakeDb({ ...driver, manualReviewStatus: 'rejected' }), driverId: 'd1', canonicalState: ACTIVE })).status).toBe('manual_decision');
    expect((await service.maybeAutoApprove({ db: fakeDb({ ...driver, approved: true }), driverId: 'd1', canonicalState: ACTIVE })).status).toBe('already_approved');
  });

  it('sends to manual review when the CPF is taken or identity is blocked', async () => {
    const taken = build({ claimCpf: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'PROFILE_CPF_ALREADY_REGISTERED' })) });
    const db1 = fakeDb(driver);
    expect(await taken.service.maybeAutoApprove({ db: db1, driverId: 'd1', canonicalState: ACTIVE })).toEqual({ approved: false, status: 'needs_review', reason: 'cpf_uniqueness' });
    expect(db1.state.users.d1.approved).toBeUndefined();
    expect(db1.state.users.d1.autoApproval).toEqual(expect.objectContaining({ status: 'needs_review', reason: 'cpf_uniqueness' }));

    const blocked = build({ assertNotPermanentlyBlocked: jest.fn().mockRejectedValue(new Error('blocked')) });
    expect((await blocked.service.maybeAutoApprove({ db: fakeDb(driver), driverId: 'd1', canonicalState: ACTIVE })).reason).toBe('identity_enforcement');

    const noCpf = build();
    expect((await noCpf.service.maybeAutoApprove({ db: fakeDb({ status: 'pending' }), driverId: 'd1', canonicalState: ACTIVE })).reason).toBe('cpf_missing');
  });

  it('prefers the CPF read from the CNH', () => {
    expect(resolveDriverCpf({ cpf: '111', documents: { cnh: { extractedData: { cpf: '222' } } } })).toBe('222');
    expect(resolveDriverCpf({ cpf: '111' })).toBe('111');
  });
});
