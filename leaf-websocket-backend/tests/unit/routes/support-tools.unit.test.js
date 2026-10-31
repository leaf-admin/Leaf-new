jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockDocuments = new Map();

function mockDocument(path) {
  return {
    id: path.split('/').pop(),
    get: async () => ({ exists: mockDocuments.has(path), data: () => mockDocuments.get(path) }),
    set: async (value) => { mockDocuments.set(path, value); },
    delete: async () => { mockDocuments.delete(path); },
    collection: (name) => mockCollection(`${path}/${name}`)
  };
}

function mockCollection(path) {
  const query = {
    doc: (id = `auto-${mockDocuments.size + 1}`) => mockDocument(`${path}/${id}`),
    orderBy: () => query,
    limit: () => query,
    get: async () => ({
      docs: [...mockDocuments.entries()]
        .filter(([key]) => key.startsWith(`${path}/`))
        .map(([, value]) => ({ data: () => value }))
    })
  };
  return query;
}

jest.mock('../../../firebase-config', () => ({
  getFirestore: () => ({ collection: (name) => mockCollection(name) })
}));

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: jest.fn((req, res, next) => {
    const role = req.headers.authorization?.replace('Bearer ', '');
    if (!role) return res.status(401).json({ success: false });
    req.user = { id: `${role}_1`, role, name: `Pessoa ${role}` };
    return next();
  }),
  requireSupportRoles: (roles) => (req, res, next) => (
    roles.includes(req.user.role) ? next() : res.status(403).json({ success: false })
  ),
  isSupportAgent: (user) => ['admin', 'support', 'support_n1'].includes(user?.role)
}));

const supportChatServiceSend = jest.fn();
jest.mock('../../../services/support-chat-service', () => ({ sendMessage: supportChatServiceSend }));

const supportToolsRoutes = require('../../../routes/support-tools');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support', supportToolsRoutes);
  return app;
}

describe('support tools routes', () => {
  beforeEach(() => mockDocuments.clear());

  it('keeps chat notes away from non agents', async () => {
    const app = buildApp();
    await request(app).get('/api/support/tools/chat-notes/user_1')
      .set('Authorization', 'Bearer customer').expect(403);
    await request(app).post('/api/support/tools/chat-notes/user_1')
      .set('Authorization', 'Bearer customer').send({ message: 'x' }).expect(403);
  });

  it('stores a chat note without touching the customer delivery path', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/support/tools/chat-notes/whatsapp:1:5521')
      .set('Authorization', 'Bearer support').send({ message: '  checar Pix  ' }).expect(201);
    expect(created.body.note).toMatchObject({ message: 'checar Pix', isInternal: true, authorName: 'Pessoa support' });
    expect(supportChatServiceSend).not.toHaveBeenCalled();

    const listed = await request(app).get('/api/support/tools/chat-notes/whatsapp:1:5521')
      .set('Authorization', 'Bearer support').expect(200);
    expect(listed.body.notes.map((note) => note.message)).toEqual(['checar Pix']);
  });

  it('refuses notes outside the operational scope', async () => {
    await request(buildApp()).post('/api/support/tools/chat-notes/user_1?scope=sandbox')
      .set('Authorization', 'Bearer support').send({ message: 'x' }).expect(404);
  });

  it('lets agents read saved replies but only managers change them', async () => {
    const app = buildApp();
    await request(app).post('/api/support/tools/saved-replies')
      .set('Authorization', 'Bearer support_n1').send({ shortcut: 'pix', message: 'Oi' }).expect(403);
    await request(app).post('/api/support/tools/saved-replies')
      .set('Authorization', 'Bearer admin').send({ shortcut: '/Pix', message: 'Oi' }).expect(200);
    const listed = await request(app).get('/api/support/tools/saved-replies')
      .set('Authorization', 'Bearer support_n1').expect(200);
    expect(listed.body.replies).toEqual([expect.objectContaining({ shortcut: 'pix', message: 'Oi' })]);
    await request(app).delete('/api/support/tools/saved-replies/pix')
      .set('Authorization', 'Bearer support_n1').expect(403);
    await request(app).delete('/api/support/tools/saved-replies/pix')
      .set('Authorization', 'Bearer admin').expect(200);
  });

  it('rejects an invalid saved reply shortcut', async () => {
    await request(buildApp()).post('/api/support/tools/saved-replies')
      .set('Authorization', 'Bearer admin').send({ shortcut: 'a b', message: 'Oi' }).expect(400);
  });

  it('returns only the allowed ride fields', async () => {
    mockDocuments.set('rides/ride_1', {
      status: 'in_progress',
      estimatedFare: 32.5,
      pickup: { add: 'Rua A' },
      drop: { add: 'Rua B' },
      customerId: 'user_1',
      customerName: 'Ana',
      driverId: 'driver_1',
      driverName: 'Bia',
      paymentStatus: 'paid',
      customerCpf: '00000000000',
      pixKey: 'chave-secreta'
    });
    const response = await request(buildApp()).get('/api/support/tools/rides/ride_1')
      .set('Authorization', 'Bearer support').expect(200);
    expect(response.body.ride).toEqual({
      id: 'ride_1',
      status: 'IN_PROGRESS',
      statusLabel: 'em andamento',
      grossAmount: 32.5,
      pickupAddress: 'Rua A',
      destinationAddress: 'Rua B',
      paymentStatus: 'paid',
      passengerId: 'user_1',
      passengerName: 'Ana',
      driverId: 'driver_1',
      driverName: 'Bia'
    });
  });

  it('does not report a zero fare for a completed ride awaiting the final snapshot', async () => {
    mockDocuments.set('rides/ride_2', { status: 'completed', finalPrice: 32.5 });
    const response = await request(buildApp()).get('/api/support/tools/rides/ride_2')
      .set('Authorization', 'Bearer support').expect(200);
    expect(response.body.ride.grossAmount).toBeNull();
  });

  it('answers 404 for an unknown ride', async () => {
    await request(buildApp()).get('/api/support/tools/rides/nada')
      .set('Authorization', 'Bearer support').expect(404);
  });
});
