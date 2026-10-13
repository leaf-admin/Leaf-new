import {
  describeDriverWithdrawal,
  describeDriverWithdrawals,
  summarizeOpenWithdrawals,
} from '../src/screens/driverWithdrawalStatus';

describe('driver withdrawal status', () => {
  it('describes a withdrawal waiting for the manual check', () => {
    const requestedAt = new Date(2026, 9, 13, 9, 0).toISOString();
    expect(
      describeDriverWithdrawal({
        id: 'w1',
        amountCents: 123450,
        status: 'in_review',
        statusLabel: 'Em conferência',
        pixKeyMasked: '219••••••86',
        requestedAt,
      }),
    ).toEqual({
      id: 'w1',
      amountLabel: 'R$ 1.234,50',
      details: '13/10 · Pix 219••••••86',
      statusLabel: 'Em conferência',
      tone: 'pending',
    });
  });

  it('uses its own label and a calm state for anything unknown', () => {
    expect(describeDriverWithdrawal({ id: 'w2', amountCents: 5000, status: 'paid' })).toMatchObject({
      statusLabel: 'Pix enviado',
      tone: 'success',
      details: '',
    });
    expect(describeDriverWithdrawal({ id: 'w3', status: 'whatever' })).toMatchObject({
      amountLabel: 'R$ 0,00',
      statusLabel: 'Em conferência',
      tone: 'pending',
    });
    expect(describeDriverWithdrawal({ id: 'w4', status: 'failed' }).tone).toBe('danger');
  });

  it('lists at most five and skips entries without id', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `w${index}`, amountCents: 100, status: 'paid' }));
    expect(describeDriverWithdrawals(many)).toHaveLength(5);
    expect(describeDriverWithdrawals([{ amountCents: 100 }])).toEqual([]);
    expect(describeDriverWithdrawals(null)).toEqual([]);
  });

  it('summarizes what is still to be paid', () => {
    expect(summarizeOpenWithdrawals([{ status: 'paid', amountCents: 100 }])).toBe('');
    expect(summarizeOpenWithdrawals([{ status: 'in_review', amountCents: 12000 }])).toBe(
      'R$ 120,00 em conferência. Você recebe um aviso quando o Pix for enviado.',
    );
    expect(
      summarizeOpenWithdrawals([
        { status: 'in_review', amountCents: 12000 },
        { status: 'sending', amountCents: 3000 },
      ]),
    ).toBe('2 saques em conferência (R$ 150,00). Você recebe um aviso a cada Pix enviado.');
  });
});
