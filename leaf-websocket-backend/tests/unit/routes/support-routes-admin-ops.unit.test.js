jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockTickets = new Map();
const mockMessages = new Map();
const mockCreateSupportTicket = jest.fn();
const mockListTickets = jest.fn();
const mockGetTicket = jest.fn();
const mockListMessages = jest.fn();
const mockAddMessage = jest.fn();
const mockAssignTicket = jest.fn();
const mockEscalateTicket = jest.fn();
const mockResolveTicket = jest.fn();
const mockReopenSupportChat = jest.fn();
const mockResolveUserPersistenceScope = jest.fn(async () => ({
  namespace: 'operational',
  financialContextId: 'operational-context'
}));

function authUserFromToken(token) {
  if (token === 'user-token') {
    return { id: 'smoke_customer_1', uid: 'smoke_customer_1', role: 'customer', userType: 'customer' };
  }
  if (token === 'other-user-token') {
    return { id: 'other_customer_1', uid: 'other_customer_1', role: 'customer', userType: 'customer' };
  }
  if (token === 'admin-token') {
    return { id: 'smoke_admin_1', uid: 'smoke_admin_1', role: 'support', email: 'support@leaf.test' };
  }
  if (token === 'sandbox-admin-token') {
    return {
      id: 'smoke_admin_sandbox',
      uid: 'smoke_admin_sandbox',
      role: 'support',
      email: 'support-sandbox@leaf.test',
      permissions: ['support:sandbox']
    };
  }
  return null;
}

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: jest.fn((req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = authUserFromToken(token);
    if (!user) return res.status(401).json({ success: false, error: 'Token inválido' });
    req.user = user;
    return next();
  }),
  requireSupportRoles: jest.fn((roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: 'Acesso negado' });
    }
    return next();
  }),
  isSupportAgent: jest.fn((user) => ['admin', 'manager', 'super-admin', 'support', 'development'].includes(user?.role))
}));

jest.mock('../../../services/support-queue-service', () => ({
  createSupportTicket: (...args) => mockCreateSupportTicket(...args),
  assignTicket: (...args) => mockAssignTicket(...args),
  escalateTicket: (...args) => mockEscalateTicket(...args),
  resolveTicket: (...args) => mockResolveTicket(...args),
  getQueueSummary: jest.fn().mockResolvedValue({ totalOpenTickets: 1 }),
  getBacklog: jest.fn().mockResolvedValue({ tickets: [], total: 0, hasMore: false })
}));

jest.mock('../../../services/support-ticket-service', () => ({
  listTickets: (...args) => mockListTickets(...args),
  getTicket: (...args) => mockGetTicket(...args),
  listMessages: (...args) => mockListMessages(...args),
  addMessage: (...args) => mockAddMessage(...args),
  getAdminStats: jest.fn().mockResolvedValue({ total: 1 })
}));

jest.mock('../../../services/backoffice-cost-guard-service', () => ({
  attachToResponse: jest.fn(async (_res, _scope, payload) => payload)
}));

jest.mock('../../../services/support-driver-identity-reverification-service', () => ({
  handleTicket: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../../services/support-chat-service', () => ({
  reopenChat: mockReopenSupportChat
}));

jest.mock('../../../services/sandbox-persistence-context', () => ({
  resolvePersistenceScope: jest.fn(() => ({ namespace: 'operational' })),
  resolveUserPersistenceScope: (...args) => mockResolveUserPersistenceScope(...args),
  createExplicitSandboxAccessScope: jest.fn(({ authorized }) => {
    if (!authorized) {
      const error = new Error('Acesso ao namespace sandbox não autorizado');
      error.code = 'SANDBOX_PERSISTENCE_ACCESS_DENIED';
      throw error;
    }
    return {
      namespace: 'sandbox',
      explicitSandboxAccess: true,
      financialContextId: null
    };
  })
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

function createApp({ io = null } = {}) {
  const routes = require('../../../routes/support');
  if (typeof routes.setIOInstance === 'function') {
    routes.setIOInstance(io);
  }
  const app = express();
  app.use(express.json());
  app.use('/support', routes);
  return app;
}

function createIoMock() {
  const dashboardEmit = jest.fn();
  const ownerEmit = jest.fn();
  return {
    emit: jest.fn(),
    of: jest.fn(() => ({
      to: jest.fn(() => ({ emit: dashboardEmit }))
    })),
    to: jest.fn(() => ({ emit: ownerEmit })),
    dashboardEmit,
    ownerEmit
  };
}

describe('support routes admin operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTickets.clear();
    mockMessages.clear();

    mockCreateSupportTicket.mockImplementation(async ({ subject, description, requesterId, priority, category }) => {
      const ticket = {
        id: 'ticket_smoke_1',
        subject,
        description,
        userId: requesterId,
        userType: 'customer',
        priority,
        category,
        status: 'open',
        createdAt: '2026-06-10T10:00:00.000Z',
        updatedAt: '2026-06-10T10:00:00.000Z',
        assignedAgent: 'secret-agent-id',
        assignedAgentName: 'Agente Interno',
        adminNotes: 'nota reservada',
        ipAddress: '127.0.0.1',
        userAgent: 'internal-test-agent',
        metadata: {
          bookingId: 'booking_smoke_1',
          queue: { overdueAck: true }
        }
      };
      const initialMessage = {
        id: 'message_smoke_1',
        ticketId: ticket.id,
        senderId: requesterId,
        senderType: 'user',
        message: description,
        isInternal: false,
        readBy: { [requesterId]: true }
      };
      mockTickets.set(ticket.id, ticket);
      mockMessages.set(ticket.id, [initialMessage]);
      return { ticket, initialMessage };
    });

    mockListTickets.mockImplementation(async ({ isAgent, userId }) => {
      const tickets = Array.from(mockTickets.values())
        .filter((ticket) => !userId || ticket.userId === userId)
        .filter((ticket) => isAgent || ticket.userId === userId);
      return { tickets, total: tickets.length, hasMore: false };
    });

    mockGetTicket.mockImplementation(async (ticketId) => mockTickets.get(ticketId) || null);
    mockListMessages.mockImplementation(async (ticketId) => mockMessages.get(ticketId) || []);
    mockAddMessage.mockImplementation(async (ticketId, payload) => {
      const message = {
        id: `message_${mockMessages.get(ticketId)?.length || 0}`,
        ticketId,
        ...payload,
        createdAt: '2026-06-10T10:01:00.000Z'
      };
      mockMessages.set(ticketId, [...(mockMessages.get(ticketId) || []), message]);
      return message;
    });
    mockAssignTicket.mockImplementation(async (ticketId, payload) => {
      const ticket = mockTickets.get(ticketId);
      mockTickets.set(ticketId, {
        ...ticket,
        status: 'assigned',
        assignedAgent: payload.agentId,
        assignedAgentName: payload.agentName
      });
      return mockTickets.get(ticketId);
    });
    mockEscalateTicket.mockResolvedValue({ escalationLevel: 2 });
    mockResolveTicket.mockImplementation(async (ticketId, payload) => {
      const ticket = mockTickets.get(ticketId);
      mockTickets.set(ticketId, {
        ...ticket,
        status: 'resolved',
        resolvedAt: '2026-06-10T10:02:00.000Z'
      });
      mockMessages.set(ticketId, [
        ...(mockMessages.get(ticketId) || []),
        {
          id: 'message_resolution',
          ticketId,
          senderId: payload.actorId,
          senderType: 'agent',
          message: payload.resolution,
          isInternal: false
        }
      ]);
      return { resolvedAt: '2026-06-10T10:02:00.000Z' };
    });
  });

  it('creates a ticket from an app user and lets support resolve it with history', async () => {
    const io = createIoMock();
    const app = createApp({ io });
    const createResponse = await request(app)
      .post('/support/tickets')
      .set('Authorization', 'Bearer user-token')
      .send({
        subject: 'Problema na conta',
        description: 'Preciso de ajuda com meu cadastro.',
        category: 'account',
        priority: 'N2'
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({
      success: true,
      ticket: {
        id: 'ticket_smoke_1',
        userId: 'smoke_customer_1',
        status: 'open'
      }
    });
    expect(io.emit).not.toHaveBeenCalled();
    expect(io.of).toHaveBeenCalledWith('/dashboard');
    expect(io.dashboardEmit).toHaveBeenCalledWith(
      'support:ticket:new',
      expect.objectContaining({
        ticket: expect.objectContaining({
          id: 'ticket_smoke_1',
          userId: 'smoke_customer_1',
          status: 'open'
        })
      })
    );
    expect(io.to).toHaveBeenCalledWith('customer_smoke_customer_1');
    expect(io.ownerEmit).toHaveBeenCalledWith(
      'support:ticket:new',
      expect.objectContaining({
        ticket: expect.objectContaining({ id: 'ticket_smoke_1' })
      })
    );

    const listResponse = await request(app)
      .get('/support/admin/tickets')
      .set('Authorization', 'Bearer admin-token');

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.tickets).toEqual([
      expect.objectContaining({ id: 'ticket_smoke_1', subject: 'Problema na conta' })
    ]);

    const messageResponse = await request(app)
      .post('/support/tickets/ticket_smoke_1/messages')
      .set('Authorization', 'Bearer admin-token')
      .send({ message: 'Estamos verificando sua conta.' });

    expect(messageResponse.status).toBe(201);
    expect(mockAddMessage).toHaveBeenCalledWith('ticket_smoke_1', expect.objectContaining({
      senderId: 'smoke_admin_1',
      senderType: 'agent',
      message: 'Estamos verificando sua conta.',
      isInternal: false
    }), expect.objectContaining({ namespace: 'operational' }));
    expect(io.emit).not.toHaveBeenCalled();
    expect(io.dashboardEmit).toHaveBeenCalledWith(
      'support:message:new',
      {
        ticketId: 'ticket_smoke_1',
        message: expect.objectContaining({
          ticketId: 'ticket_smoke_1',
          senderType: 'agent',
          message: 'Estamos verificando sua conta.'
        })
      }
    );
    expect(io.ownerEmit).toHaveBeenCalledWith(
      'support:message:new',
      expect.objectContaining({ ticketId: 'ticket_smoke_1' })
    );

    const resolveResponse = await request(app)
      .post('/support/admin/tickets/ticket_smoke_1/resolve')
      .set('Authorization', 'Bearer admin-token')
      .send({ resolution: 'Cadastro revisado e orientacao enviada.' });

    expect(resolveResponse.status).toBe(200);
    expect(mockResolveTicket).toHaveBeenCalledWith('ticket_smoke_1', expect.objectContaining({
      actorId: 'smoke_admin_1',
      resolution: 'Cadastro revisado e orientacao enviada.'
    }), expect.objectContaining({ namespace: 'operational' }));
    expect(mockTickets.get('ticket_smoke_1')).toMatchObject({ status: 'resolved' });
    expect(mockMessages.get('ticket_smoke_1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ senderType: 'user' }),
      expect.objectContaining({ senderType: 'agent', message: 'Cadastro revisado e orientacao enviada.' })
    ]));
  });

  it('never exposes internal ticket fields or internal messages to the owner', async () => {
    const app = createApp();
    await mockCreateSupportTicket({
      subject: 'Cobrança',
      description: 'Revisar meu recibo',
      requesterId: 'smoke_customer_1',
      priority: 'N2',
      category: 'payment'
    });
    mockMessages.set('ticket_smoke_1', [
      ...mockMessages.get('ticket_smoke_1'),
      {
        id: 'message_internal_1',
        ticketId: 'ticket_smoke_1',
        senderId: 'secret-agent-id',
        senderType: 'agent',
        message: 'Nota interna invisível',
        messageType: 'system',
        isInternal: true,
        readBy: { 'secret-agent-id': true },
        createdAt: '2026-06-10T10:01:00.000Z'
      },
      {
        id: 'message_public_1',
        ticketId: 'ticket_smoke_1',
        senderId: 'secret-agent-id',
        senderType: 'agent',
        message: 'Resposta pública',
        messageType: 'text',
        isInternal: false,
        readBy: { 'secret-agent-id': true },
        createdAt: '2026-06-10T10:02:00.000Z'
      }
    ]);

    const [listResponse, ticketResponse, messagesResponse] = await Promise.all([
      request(app).get('/support/tickets').set('Authorization', 'Bearer user-token'),
      request(app).get('/support/tickets/ticket_smoke_1').set('Authorization', 'Bearer user-token'),
      request(app).get('/support/tickets/ticket_smoke_1/messages').set('Authorization', 'Bearer user-token')
    ]);
    const postMessageResponse = await request(app)
      .post('/support/tickets/ticket_smoke_1/messages')
      .set('Authorization', 'Bearer user-token')
      .send({ message: 'Complemento público do titular.' });

    expect(listResponse.status).toBe(200);
    expect(ticketResponse.status).toBe(200);
    expect(messagesResponse.status).toBe(200);
    expect(postMessageResponse.status).toBe(201);
    [listResponse.body.tickets[0], ticketResponse.body.ticket].forEach((visibleTicket) => {
      expect(visibleTicket).toEqual(expect.objectContaining({
        id: 'ticket_smoke_1',
        bookingId: 'booking_smoke_1'
      }));
      expect(visibleTicket).not.toHaveProperty('adminNotes');
      expect(visibleTicket).not.toHaveProperty('assignedAgent');
      expect(visibleTicket).not.toHaveProperty('assignedAgentName');
      expect(visibleTicket).not.toHaveProperty('ipAddress');
      expect(visibleTicket).not.toHaveProperty('userAgent');
      expect(visibleTicket).not.toHaveProperty('metadata');
    });
    expect(messagesResponse.body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'message_public_1', message: 'Resposta pública' })
    ]));
    expect(messagesResponse.body.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'message_internal_1' })
    ]));
    messagesResponse.body.messages.forEach((message) => {
      expect(message).not.toHaveProperty('isInternal');
      expect(message).not.toHaveProperty('senderId');
      expect(message).not.toHaveProperty('readBy');
    });
    expect(postMessageResponse.body.message).not.toHaveProperty('isInternal');
    expect(postMessageResponse.body.message).not.toHaveProperty('senderId');
    expect(postMessageResponse.body.message).not.toHaveProperty('readBy');
  });

  it('keeps complete operational fields and internal messages for support agents', async () => {
    const app = createApp();
    await mockCreateSupportTicket({
      subject: 'Cobrança',
      description: 'Revisar meu recibo',
      requesterId: 'smoke_customer_1',
      priority: 'N2',
      category: 'payment'
    });
    mockMessages.set('ticket_smoke_1', [
      {
        id: 'message_internal_1',
        ticketId: 'ticket_smoke_1',
        senderId: 'secret-agent-id',
        senderType: 'agent',
        message: 'Nota interna invisível ao usuário',
        isInternal: true
      }
    ]);

    const [ticketResponse, messagesResponse] = await Promise.all([
      request(app).get('/support/tickets/ticket_smoke_1').set('Authorization', 'Bearer admin-token'),
      request(app).get('/support/tickets/ticket_smoke_1/messages').set('Authorization', 'Bearer admin-token')
    ]);

    expect(ticketResponse.body.ticket).toEqual(expect.objectContaining({
      adminNotes: 'nota reservada',
      assignedAgent: 'secret-agent-id',
      metadata: expect.objectContaining({ queue: { overdueAck: true } })
    }));
    expect(messagesResponse.body.messages).toEqual([
      expect.objectContaining({ id: 'message_internal_1', isInternal: true })
    ]);
  });

  it('denies ticket and message access to a different authenticated user', async () => {
    const app = createApp();
    await mockCreateSupportTicket({
      subject: 'Conta',
      description: 'Acesso do titular',
      requesterId: 'smoke_customer_1',
      priority: 'N3',
      category: 'account'
    });

    const [ticketResponse, messagesResponse] = await Promise.all([
      request(app).get('/support/tickets/ticket_smoke_1').set('Authorization', 'Bearer other-user-token'),
      request(app).get('/support/tickets/ticket_smoke_1/messages').set('Authorization', 'Bearer other-user-token')
    ]);

    expect(ticketResponse.status).toBe(403);
    expect(messagesResponse.status).toBe(403);
  });

  it('requires both explicit scope and sandbox permission for dashboard ticket reads', async () => {
    const app = createApp();
    mockListTickets.mockResolvedValue({ tickets: [], total: 0, hasMore: false });

    const denied = await request(app)
      .get('/support/admin/tickets?scope=sandbox')
      .set('Authorization', 'Bearer admin-token');

    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({
      code: 'SANDBOX_PERSISTENCE_ACCESS_DENIED'
    });
    expect(mockListTickets).not.toHaveBeenCalled();

    const authorized = await request(app)
      .get('/support/admin/tickets?scope=sandbox')
      .set('Authorization', 'Bearer sandbox-admin-token');

    expect(authorized.status).toBe(200);
    expect(mockListTickets).toHaveBeenCalledWith(expect.objectContaining({
      persistenceContext: expect.objectContaining({
        namespace: 'sandbox',
        explicitSandboxAccess: true
      })
    }));
  });

  it('rejects an invalid support scope before any dashboard persistence read', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/support/admin/tickets?scope=sandbo')
      .set('Authorization', 'Bearer sandbox-admin-token');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'SUPPORT_PERSISTENCE_SCOPE_INVALID'
    });
    expect(mockListTickets).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'header and query',
      path: '/support/admin/tickets?scope=operational',
      headerScope: 'sandbox'
    },
    {
      name: 'query aliases',
      path: '/support/admin/tickets?scope=sandbox&persistenceScope=operational',
      headerScope: null
    }
  ])('rejects conflicting support scopes from $name before persistence', async ({ path, headerScope }) => {
    const app = createApp();
    let pendingRequest = request(app)
      .get(path)
      .set('Authorization', 'Bearer sandbox-admin-token');
    if (headerScope) {
      pendingRequest = pendingRequest.set('X-Leaf-Support-Scope', headerScope);
    }

    const response = await pendingRequest;

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'SUPPORT_PERSISTENCE_SCOPE_CONFLICT'
    });
    expect(mockListTickets).not.toHaveBeenCalled();
  });

  it('rejects an app scope that diverges from the authoritative user classification', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/support/tickets?scope=sandbox')
      .set('Authorization', 'Bearer user-token')
      .send({
        subject: 'Teste de divergência',
        description: 'Este ticket não pode cair no namespace operacional.',
        category: 'technical',
        priority: 'N3'
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'SUPPORT_PERSISTENCE_SCOPE_MISMATCH'
    });
    expect(mockCreateSupportTicket).not.toHaveBeenCalled();
  });

  it('keeps sandbox ticket realtime and side effects out of operational support', async () => {
    mockResolveUserPersistenceScope.mockResolvedValueOnce({
      namespace: 'sandbox',
      financialContextId: 'sandbox-context'
    });
    const io = createIoMock();
    const app = createApp({ io });

    const response = await request(app)
      .post('/support/tickets')
      .set('Authorization', 'Bearer user-token')
      .send({
        subject: 'Teste sandbox',
        description: 'Validar ticket isolado do suporte operacional.',
        category: 'technical',
        priority: 'N3'
      });

    expect(response.status).toBe(201);
    expect(mockCreateSupportTicket).toHaveBeenCalledWith(expect.objectContaining({
      persistenceContext: expect.objectContaining({ namespace: 'sandbox' })
    }));
    expect(io.of).not.toHaveBeenCalled();
    expect(io.ownerEmit).toHaveBeenCalledWith(
      'support:ticket:new',
      expect.objectContaining({ ticket: expect.objectContaining({ id: 'ticket_smoke_1' }) })
    );
    expect(mockReopenSupportChat).not.toHaveBeenCalled();
  });

  it('returns a boundary conflict instead of falling back when user classification is unavailable', async () => {
    const error = new Error('Não foi possível classificar o ambiente de persistência do usuário');
    error.code = 'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE';
    mockResolveUserPersistenceScope.mockRejectedValueOnce(error);
    const app = createApp();

    const response = await request(app)
      .post('/support/tickets')
      .set('Authorization', 'Bearer user-token')
      .send({
        subject: 'Teste de fail closed',
        description: 'Este ticket não pode cair no namespace operacional.',
        category: 'technical',
        priority: 'N3'
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE'
    });
    expect(mockCreateSupportTicket).not.toHaveBeenCalled();
  });

  it('forwards an explicit driver filter when an agent loads pending KYC tickets', async () => {
    mockTickets.set('ticket_driver_a', {
      id: 'ticket_driver_a',
      userId: 'driver_a',
      status: 'open',
      metadata: { identityReviewLinkStatus: 'pending', kycEvidenceId: 'evidence_a' }
    });
    mockTickets.set('ticket_driver_b', {
      id: 'ticket_driver_b',
      userId: 'driver_b',
      status: 'open',
      metadata: { identityReviewLinkStatus: 'pending', kycEvidenceId: 'evidence_b' }
    });

    const response = await request(createApp())
      .get('/support/admin/tickets?userId=driver_a&limit=100')
      .set('Authorization', 'Bearer admin-token');

    expect(response.status).toBe(200);
    expect(mockListTickets).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'driver_a',
      isAgent: true,
      limit: '100'
    }));
    expect(response.body.tickets).toEqual([
      expect.objectContaining({ id: 'ticket_driver_a', userId: 'driver_a' })
    ]);
  });
});
