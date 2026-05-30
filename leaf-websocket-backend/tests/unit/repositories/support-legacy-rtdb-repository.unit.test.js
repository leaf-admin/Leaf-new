const SupportLegacyRtdbRepository = require('../../../repositories/support-legacy-rtdb-repository');

function createSnapshot(value, exists = value !== null && value !== undefined) {
  return {
    exists: jest.fn(() => exists),
    val: jest.fn(() => value),
  };
}

function createRef(path, refs) {
  refs.push(path);
  const refApi = {
    once: jest.fn(async () => createSnapshot({ [`value_for_${path}`]: true })),
    update: jest.fn(async () => undefined),
    set: jest.fn(async () => undefined),
    orderByChild: jest.fn(() => ({
      equalTo: jest.fn(() => ({
        once: jest.fn(async () => createSnapshot({ ticket_1: { userId: 'user_1' } })),
      })),
    })),
  };
  return refApi;
}

describe('SupportLegacyRtdbRepository', () => {
  it('returns safe empty values when RTDB is unavailable', async () => {
    const repository = new SupportLegacyRtdbRepository(null);

    expect(repository.isAvailable()).toBe(false);
    expect(await repository.getTicket('ticket_1')).toBeNull();
    expect(await repository.listTickets()).toEqual({});
    expect(await repository.listTicketsByUser('user_1')).toEqual({});
    expect(await repository.getMessages('ticket_1')).toEqual({});
    expect(await repository.updateTicket('ticket_1', {})).toBe(false);
    expect(await repository.setMessage('ticket_1', 'message_1', {})).toBe(false);
  });

  it('centralizes legacy support RTDB paths', async () => {
    const refs = [];
    const db = {
      ref: jest.fn((path) => createRef(path, refs)),
    };
    const repository = new SupportLegacyRtdbRepository(db);

    await repository.getTicket('ticket_1');
    await repository.listTickets();
    await repository.listTicketsByUser('user_1');
    await repository.getMessages('ticket_1');
    await repository.updateTicket('ticket_1', { status: 'open' });
    await repository.setMessage('ticket_1', 'message_1', { message: 'Oi' });

    expect(refs).toEqual([
      'support_tickets/ticket_1',
      'support_tickets',
      'support_tickets',
      'support_messages/ticket_1',
      'support_tickets/ticket_1',
      'support_messages/ticket_1/message_1',
    ]);
  });
});
