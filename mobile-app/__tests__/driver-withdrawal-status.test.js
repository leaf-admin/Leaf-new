import {
  buildWithdrawalFeeNotice,
  countWithdrawalsToday,
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

  it('counts today withdrawals that were not refused', () => {
    const now = new Date(2026, 9, 13, 18, 0);
    const today = new Date(2026, 9, 13, 9, 0).toISOString();
    const yesterday = new Date(2026, 9, 12, 23, 0).toISOString();
    expect(
      countWithdrawalsToday(
        [
          { status: 'in_review', requestedAt: today },
          { status: 'paid', requestedAt: today },
          { status: 'failed', requestedAt: today },
          { status: 'paid', requestedAt: yesterday },
          { status: 'paid' },
        ],
        now,
      ),
    ).toBe(2);
  });

  it('states the fee before the first withdrawal of the day and suggests one per day', () => {
    expect(buildWithdrawalFeeNotice({ fee: 1, withdrawalsToday: 0 })).toEqual({
      tone: 'neutral',
      title: 'Taxa de R$ 1,00 por saque',
      body: 'Taxa fixa cobrada a cada saque. Fazer um saque por dia evita pagar a taxa mais de uma vez.',
    });
  });

  it('warns that another withdrawal on the same day pays the fee again', () => {
    expect(buildWithdrawalFeeNotice({ fee: 1, withdrawalsToday: 1 })).toMatchObject({
      tone: 'warning',
      title: 'Taxa de R$ 1,00 neste saque',
      body: 'Você já fez 1 saque hoje. A taxa é de R$ 1,00 por saque, então este também paga a taxa.',
    });
    expect(buildWithdrawalFeeNotice({ fee: 1, withdrawalsToday: 3 }).body).toMatch(/3 saques hoje/);
  });

  it('says when the amount has no fee', () => {
    expect(buildWithdrawalFeeNotice({ fee: 0, withdrawalsToday: 2 }).title).toBe('Taxa de saque');
  });
});
