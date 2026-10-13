const {
  DRIVER_WITHDRAWAL_STATUS,
  maskPixKey,
  sortDriverWithdrawals,
  toDriverWithdrawalView
} = require('../../../services/driver-withdrawal-view');

describe('driver withdrawal view', () => {
  it('shows a requested withdrawal as in review until operations process it', () => {
    const view = toDriverWithdrawalView('w1', {
      driverId: 'driver-1',
      pixKey: '21998991886',
      amountCents: 12000,
      feeCents: 100,
      totalDebitCents: 12100,
      status: 'pending',
      createdAt: { toDate: () => new Date('2026-10-13T12:00:00.000Z') }
    });

    expect(view).toEqual({
      id: 'w1',
      amountCents: 12000,
      feeCents: 100,
      totalDebitCents: 12100,
      status: DRIVER_WITHDRAWAL_STATUS.IN_REVIEW,
      statusLabel: 'Em conferência',
      pixKeyMasked: '219••••••86',
      requestedAt: '2026-10-13T12:00:00.000Z',
      updatedAt: null
    });
    expect(JSON.stringify(view)).not.toContain('21998991886');
  });

  it('maps every internal state to what the driver can act on', () => {
    const statusOf = (status) => toDriverWithdrawalView('w', { status }).status;
    expect(statusOf('ledger_pending')).toBe('in_review');
    expect(statusOf('processing')).toBe('sending');
    expect(statusOf('processed')).toBe('paid');
    expect(statusOf('processed_ledger_pending')).toBe('paid');
    expect(statusOf('failed')).toBe('failed');
    expect(statusOf('something_new')).toBe('in_review');
    expect(toDriverWithdrawalView('w', { status: 'processed' }).statusLabel).toBe('Pix enviado');
  });

  it('masks e-mail, short and empty keys', () => {
    expect(maskPixKey('motorista@leaf.app.br')).toBe('mo••••••@leaf.app.br');
    expect(maskPixKey('1234')).toBe('••••');
    expect(maskPixKey('')).toBe('');
  });

  it('orders newest first', () => {
    const sorted = sortDriverWithdrawals([
      { id: 'old', requestedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'none', requestedAt: null },
      { id: 'new', requestedAt: '2026-10-12T00:00:00.000Z' }
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['new', 'old', 'none']);
  });
});
