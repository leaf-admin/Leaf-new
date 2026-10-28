const { createWhatsAppSupportService } = require('../../../services/whatsapp-support-service');
const { WhatsAppSupportRepository, WINDOW_MS } = require('../../../repositories/whatsapp-support-repository');

// Models transactional rollback/serialization, not the Firestore provider.
function memoryFirestore() {
  const documents = new Map();
  let tail = Promise.resolve();
  const snapshot = (path) => ({ exists: documents.has(path), data: () => documents.get(path) });
  const collection = (path, filters = [], ordering = null, count = Infinity) => ({
    doc: (id) => ref(`${path}/${id}`),
    where: (key, _operator, value) => collection(path, [...filters, [key, value]], ordering, count),
    orderBy: (key, direction) => collection(path, filters, [key, direction], count),
    limit: (limit) => collection(path, filters, ordering, limit),
    get: async () => {
      let values = [...documents.entries()].filter(([key, value]) =>
        key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')
        && filters.every(([field, expected]) => value[field] === expected));
      if (ordering) values.sort((a, b) => String(a[1][ordering[0]]).localeCompare(String(b[1][ordering[0]])) * (ordering[1] === 'desc' ? -1 : 1));
      return { docs: values.slice(0, count).map(([key]) => snapshot(key)) };
    }
  });
  const ref = (path) => ({ path, get: async () => snapshot(path),
    collection: (name) => collection(`${path}/${name}`),
    update: async (value) => {
      if (!documents.has(path)) throw new Error('missing document');
      documents.set(path, { ...documents.get(path), ...value });
    }
  });
  return { collection, runTransaction: (callback) => {
    const result = tail.then(async () => {
      const writes = [];
      const result = await callback({ get: (doc) => doc.get(),
        set: (doc, value) => writes.push(() => documents.set(doc.path, { ...value })),
        update: (doc, value) => writes.push(() => documents.set(doc.path, { ...documents.get(doc.path), ...value }))
      });
      writes.forEach((write) => write());
      return result;
    });
    tail = result.catch(() => undefined);
    return result;
  } };
}

const cfg = { enabled: true, phoneNumberId: '12345', wabaId: '67890',
  appSecret: 'fixture-app-secret', verifyToken: 'fixture-verify', accessToken: 'fixture-access', graphVersion: 'v25.0' };
const userId = 'whatsapp:12345:5521999990000';
const requestId = 'fixture-request-0001';

describe('WhatsApp support delivery and durable conversation boundary', () => {
  let repository;
  let service;
  let post;
  let now;
  const payload = (id = 'wamid.inbound', timestamp = now) => ({ object: 'whatsapp_business_account', entry: [{ id: cfg.wabaId,
    changes: [{ field: 'messages', value: { metadata: { phone_number_id: cfg.phoneNumberId },
      contacts: [{ wa_id: '5521999990000', profile: { name: 'Contato de teste' } }],
      messages: [{ from: '5521999990000', id, type: 'text', text: { body: 'Preciso de ajuda' }, timestamp: String(timestamp / 1000) }]
    } }] }] });

  beforeEach(() => {
    now = Date.parse('2026-10-26T15:00:00Z');
    repository = new WhatsAppSupportRepository(memoryFirestore());
    post = jest.fn().mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.outbound' }] } });
    service = createWhatsAppSupportService({ repository, config: () => cfg, post, clock: () => now });
  });

  it('persists an inbound message once across concurrent Meta retries and preserves its original window', async () => {
    await Promise.all([service.receive(payload()), service.receive(payload())]);
    now += 5 * 60 * 1000;
    await service.receive(payload('wamid.inbound', now - 5 * 60 * 1000));
    const chat = await service.status(userId);
    expect(chat.messageCount).toBe(1);
    expect(chat.unreadFromUser).toBe(1);
    expect(chat.identityVerified).toBe(false);
    expect(Date.parse(chat.replyWindowExpiresAt)).toBe(now - 5 * 60 * 1000 + WINDOW_MS);
    expect(await service.history(userId)).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects disabled/missing config and ignores messages belonging to another account or phone', async () => {
    const wrongWaba = payload();
    wrongWaba.entry[0].id = '99999';
    await service.receive(wrongWaba);
    const wrongPhone = payload();
    wrongPhone.entry[0].changes[0].value.metadata.phone_number_id = '11111';
    await service.receive(wrongPhone);
    expect(await service.listActiveChats()).toEqual([]);
    const disabled = createWhatsAppSupportService({ config: () => ({ ...cfg, enabled: false }), post });
    expect(await disabled.listActiveChats()).toEqual([]);
    await expect(disabled.send(userId, 'Olá', requestId, 'agent')).rejects.toMatchObject({ status: 503 });
    await expect(service.status('whatsapp:777:5521999990000')).rejects.toMatchObject({ status: 404 });
  });

  it('sends only text to the inbound sender and deduplicates the operator retry', async () => {
    await service.receive(payload());
    const first = await service.send(userId, 'Olá', requestId, 'agent');
    const retry = await service.send(userId, 'Olá', requestId, 'agent');
    expect(retry.id).toBe(first.id);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('https://graph.facebook.com/v25.0/12345/messages');
    expect(post.mock.calls[0][1]).toMatchObject({ to: '5521999990000', type: 'text', text: { body: 'Olá', preview_url: false } });
    expect((await service.status(userId)).messageCount).toBe(2);
    await expect(service.send(userId, 'Outro conteúdo', requestId, 'agent')).rejects.toMatchObject({ status: 409 });
  });

  it('enforces the exact 24h boundary, message length and closed state before contacting Meta', async () => {
    await service.receive(payload());
    await expect(service.send(userId, 'x'.repeat(4097), requestId, 'agent')).rejects.toMatchObject({ status: 400 });
    now += WINDOW_MS;
    await expect(service.send(userId, 'Olá', requestId, 'agent')).rejects.toMatchObject({ status: 409 });
    await service.receive(payload('wamid.new-window'));
    await service.close(userId);
    await expect(service.send(userId, 'Olá', requestId, 'agent')).rejects.toMatchObject({ status: 409 });
    expect(post).not.toHaveBeenCalled();
    await service.receive(payload('wamid.reopen'));
    expect((await service.status(userId)).status).toBe('active');
  });

  it('keeps a timed-out send pending until a matching delivery webhook reconciles it', async () => {
    await service.receive(payload());
    post.mockRejectedValueOnce(new Error('timeout'));
    await expect(service.send(userId, 'Olá', requestId, 'agent')).rejects.toMatchObject({ status: 503 });
    await expect(service.send(userId, 'Olá', requestId, 'agent')).rejects.toMatchObject({ status: 409 });
    await expect(service.send(userId, 'Outra resposta', 'fixture-request-0002', 'agent')).rejects.toMatchObject({ status: 409 });
    const statusPayload = payload();
    const value = statusPayload.entry[0].changes[0].value;
    value.messages = [];
    value.statuses = [{ id: 'wamid.outbound', recipient_id: '5521999990000', status: 'read',
      biz_opaque_callback_data: post.mock.calls[0][1].biz_opaque_callback_data }];
    await service.receive(statusPayload);
    const retried = await service.send(userId, 'Olá', requestId, 'agent');
    expect(retried.deliveryStatus).toBe('read');
    expect((await service.status(userId)).pendingOperationId).toBeNull();
    expect((await service.status(userId)).messageCount).toBe(2);
    value.statuses[0].status = 'sent';
    await service.receive(statusPayload);
    expect((await service.send(userId, 'Olá', requestId, 'agent')).deliveryStatus).toBe('read');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps transient failures pending, but records definitive rejection without a retry', async () => {
    await service.receive(payload());
    post.mockResolvedValueOnce({ status: 400, data: { error: { message: 'provider private details' } } });
    await expect(service.send(userId, 'Olá', requestId, 'agent')).rejects.toMatchObject({ code: 'WHATSAPP_REJECTED' });
    expect((await service.status(userId)).pendingOperationId).toBeNull();
    post.mockResolvedValueOnce({ status: 500, data: {} });
    await expect(service.send(userId, 'Outra resposta', 'fixture-request-0002', 'agent')).rejects.toMatchObject({ code: 'WHATSAPP_UNCONFIRMED' });
    expect((await service.status(userId)).pendingOperationId).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('emits external conversations only to the authenticated dashboard, never mobile owner rooms', async () => {
    const emit = jest.fn();
    const room = jest.fn(() => ({ emit }));
    const io = { of: jest.fn(() => ({ to: room })), to: jest.fn() };
    service.setIO(io);
    await service.receive(payload());
    expect(room).toHaveBeenCalledWith('dashboard:authenticated');
    expect(emit).toHaveBeenCalledWith('support:chat:new', expect.objectContaining({ channel: 'whatsapp' }));
    expect(io.to).not.toHaveBeenCalled();
  });

  it('shows unsupported inbound media explicitly, and does not download external assets', async () => {
    const media = payload();
    media.entry[0].changes[0].value.messages[0].type = 'image';
    await service.receive(media);
    expect((await service.history(userId))[0]).toMatchObject({ messageType: 'unsupported' });
    await service.markRead(userId);
    expect((await service.status(userId)).unreadFromUser).toBe(0);
    expect((await service.history(userId))[0].read).toBe(true);
  });
});
