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

function authUserFromToken(token) {
  if (token === 'user-token') {
    return { id: 'smoke_customer_1', uid: 'smoke_customer_1', role: 'customer', userType: 'customer' };
  }
  if (token === 'admin-token') {
    return { id: 'smoke_admin_1', uid: 'smoke_admin_1', role: 'support', email: 'support@leaf.test' };
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

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

function createApp() {
  const routes = require('../../../routes/support');
  const app = express();
  app.use(express.json());
  app.use('/support', routes);
  return app;
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
        updatedAt: '2026-06-10T10:00:00.000Z'
      };
      const initialMessage = {
        id: 'message_smoke_1',
        ticketId: ticket.id,
        senderId: requesterId,
        senderType: 'user',
        message: description,
        isInternal: false
      };
      mockTickets.set(ticket.id, ticket);
      mockMessages.set(ticket.id, [initialMessage]);
      return { ticket, initialMessage };
    });

    mockListTickets.mockImplementation(async ({ isAgent, userId }) => {
      const tickets = Array.from(mockTickets.values())
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
    const createResponse = await request(createApp())
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

    const listResponse = await request(createApp())
      .get('/support/admin/tickets')
      .set('Authorization', 'Bearer admin-token');

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.tickets).toEqual([
      expect.objectContaining({ id: 'ticket_smoke_1', subject: 'Problema na conta' })
    ]);

    const messageResponse = await request(createApp())
      .post('/support/tickets/ticket_smoke_1/messages')
      .set('Authorization', 'Bearer admin-token')
      .send({ message: 'Estamos verificando sua conta.' });

    expect(messageResponse.status).toBe(201);
    expect(mockAddMessage).toHaveBeenCalledWith('ticket_smoke_1', expect.objectContaining({
      senderId: 'smoke_admin_1',
      senderType: 'agent',
      message: 'Estamos verificando sua conta.',
      isInternal: false
    }));

    const resolveResponse = await request(createApp())
      .post('/support/admin/tickets/ticket_smoke_1/resolve')
      .set('Authorization', 'Bearer admin-token')
      .send({ resolution: 'Cadastro revisado e orientacao enviada.' });

    expect(resolveResponse.status).toBe(200);
    expect(mockResolveTicket).toHaveBeenCalledWith('ticket_smoke_1', expect.objectContaining({
      actorId: 'smoke_admin_1',
      resolution: 'Cadastro revisado e orientacao enviada.'
    }));
    expect(mockTickets.get('ticket_smoke_1')).toMatchObject({ status: 'resolved' });
    expect(mockMessages.get('ticket_smoke_1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ senderType: 'user' }),
      expect.objectContaining({ senderType: 'agent', message: 'Cadastro revisado e orientacao enviada.' })
    ]));
  });
});
