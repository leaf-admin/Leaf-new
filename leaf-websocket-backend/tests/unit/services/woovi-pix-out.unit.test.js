'use strict';

jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn() }));

const { createPixOutClient, normalizePixKey, classifyStatus } = require('../../../services/woovi-pix-out');

function httpError(status, error = 'erro') {
  return Object.assign(new Error(error), { response: { status, data: { error } } });
}

// Woovi falsa: guarda os pagamentos por correlationID.
function fakeWoovi({ createFails = null, approveStatus = 'APPROVED', createStatus = 'APPROVED', getFails = null } = {}) {
  const payments = new Map();
  const calls = { created: 0, approved: 0 };
  const api = {
    get: jest.fn(async (path) => {
      if (getFails) throw getFails;
      const id = decodeURIComponent(path.replace('/payment/', ''));
      if (!payments.has(id)) throw httpError(404, 'not found');
      return { data: { payment: payments.get(id), transaction: { endToEndId: `E2E-${id}` } } };
    }),
    post: jest.fn(async (path, body) => {
      if (path === '/payment') {
        if (createFails) {
          if (createFails.persist) payments.set(body.correlationID, { ...body, status: 'CREATED' });
          throw createFails.error;
        }
        calls.created += 1;
        const payment = { ...body, status: createStatus };
        payments.set(body.correlationID, payment);
        return { data: { payment, transaction: { endToEndId: `E2E-${body.correlationID}` } } };
      }
      if (path === '/payment/approve') {
        calls.approved += 1;
        const payment = payments.get(body.correlationID);
        payment.status = approveStatus;
        return { data: { payment } };
      }
      throw new Error(`rota inesperada ${path}`);
    })
  };
  return { api, payments, calls };
}

describe('normalizePixKey', () => {
  it('reconhece cada tipo de chave', () => {
    expect(normalizePixKey('Motorista@Email.com')).toEqual({ type: 'EMAIL', alias: 'motorista@email.com' });
    expect(normalizePixKey('529.982.247-25')).toEqual({ type: 'CPF', alias: '52998224725' });
    expect(normalizePixKey('21987654321')).toEqual({ type: 'PHONE', alias: '+5521987654321' });
    expect(normalizePixKey('+55 21 98765-4321')).toEqual({ type: 'PHONE', alias: '+5521987654321' });
    expect(normalizePixKey('11.222.333/0001-81')).toEqual({ type: 'CNPJ', alias: '11222333000181' });
    expect(normalizePixKey('c4249323-b4ca-43f2-8139-8232aab09b93')).toEqual({ type: 'RANDOM', alias: 'c4249323-b4ca-43f2-8139-8232aab09b93' });
    expect(normalizePixKey('abc')).toBeNull();
  });

  it('classifica os status da Woovi', () => {
    expect(classifyStatus('CONFIRMED')).toBe('sent');
    expect(classifyStatus('APPROVED')).toBe('sent');
    expect(classifyStatus('FAILED')).toBe('failed');
    expect(classifyStatus('CREATED')).toBe('created');
    expect(classifyStatus('NOVO_STATUS')).toBe('unknown');
  });
});

describe('sendPixOut', () => {
  const base = { value: 100, pixKey: 'motorista@email.com', correlationID: 'leaf_withdrawal_w1' };

  it('cria com autoApprove e o tipo certo da chave', async () => {
    const woovi = fakeWoovi();
    const result = await createPixOutClient(woovi.api).sendPixOut(base);
    expect(result).toMatchObject({ outcome: 'sent', status: 'APPROVED', endToEndId: 'E2E-leaf_withdrawal_w1' });
    expect(woovi.api.post).toHaveBeenCalledWith('/payment', expect.objectContaining({
      type: 'PIX_KEY', value: 100, destinationAlias: 'motorista@email.com', destinationAliasType: 'EMAIL',
      correlationID: 'leaf_withdrawal_w1', autoApprove: true
    }));
  });

  it('chamada repetida não cria um segundo pagamento', async () => {
    const woovi = fakeWoovi();
    const client = createPixOutClient(woovi.api);
    await client.sendPixOut(base);
    const again = await client.sendPixOut(base);
    expect(again.outcome).toBe('sent');
    expect(woovi.calls.created).toBe(1);
  });

  it('pagamento criado e não aprovado é aprovado, não recriado', async () => {
    const woovi = fakeWoovi();
    woovi.payments.set(base.correlationID, { value: 100, status: 'CREATED' });
    const result = await createPixOutClient(woovi.api).sendPixOut(base);
    expect(result.outcome).toBe('sent');
    expect(woovi.calls).toEqual({ created: 0, approved: 1 });
  });

  it('erro de rede na criação com o pagamento criado do lado da Woovi: aprova esse, não cria outro', async () => {
    const woovi = fakeWoovi({ createFails: { error: new Error('socket hang up'), persist: true } });
    const result = await createPixOutClient(woovi.api).sendPixOut(base);
    expect(result.outcome).toBe('sent');
    expect(woovi.calls.approved).toBe(1);
  });

  it('erro 4xx sem pagamento criado: recusado (seguro tentar de novo)', async () => {
    const woovi = fakeWoovi({ createFails: { error: httpError(400, 'saldo insuficiente') } });
    const result = await createPixOutClient(woovi.api).sendPixOut(base);
    expect(result).toMatchObject({ outcome: 'failed', error: 'saldo insuficiente' });
  });

  it('erro 5xx sem pagamento visível: incerto (não reenviar às cegas)', async () => {
    const woovi = fakeWoovi({ createFails: { error: httpError(502, 'bad gateway') } });
    const result = await createPixOutClient(woovi.api).sendPixOut(base);
    expect(result.outcome).toBe('unknown');
  });

  it('consulta indisponível: incerto e não cria nada', async () => {
    const woovi = fakeWoovi({ getFails: httpError(503, 'indisponível') });
    const result = await createPixOutClient(woovi.api).sendPixOut(base);
    expect(result.outcome).toBe('unknown');
    expect(woovi.calls.created).toBe(0);
  });

  it('pagamento existente com valor diferente: incerto', async () => {
    const woovi = fakeWoovi();
    woovi.payments.set(base.correlationID, { value: 999, status: 'CONFIRMED' });
    const result = await createPixOutClient(woovi.api).sendPixOut(base);
    expect(result.outcome).toBe('unknown');
  });

  it('chave inválida nem chama a Woovi', async () => {
    const woovi = fakeWoovi();
    const result = await createPixOutClient(woovi.api).sendPixOut({ ...base, pixKey: 'abc' });
    expect(result.outcome).toBe('failed');
    expect(woovi.api.get).not.toHaveBeenCalled();
  });
});

describe('lookupPixOut', () => {
  it('404 vira not_found; status vira outcome', async () => {
    const woovi = fakeWoovi();
    const client = createPixOutClient(woovi.api);
    expect((await client.lookupPixOut('x')).outcome).toBe('not_found');
    woovi.payments.set('y', { value: 1, status: 'FAILED' });
    expect((await client.lookupPixOut('y')).outcome).toBe('failed');
  });
});
