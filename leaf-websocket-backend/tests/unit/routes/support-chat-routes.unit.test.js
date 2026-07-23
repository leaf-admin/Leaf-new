jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockSendMessage = jest.fn();
const mockGetChatStatus = jest.fn();
const mockReopenChatForOpenTicket = jest.fn();

jest.mock('../../../services/support-chat-service', () => ({
  getChatStatus: (...args) => mockGetChatStatus(...args),
  reopenChatForOpenTicket: (...args) => mockReopenChatForOpenTicket(...args),
  sendMessage: (...args) => mockSendMessage(...args)
}));

jest.mock('../../../services/backoffice-cost-guard-service', () => ({
  attachToResponse: jest.fn(async (_res, _scope, payload) => payload)
}));

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: jest.fn((req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token === 'user-token') {
      req.user = { id: 'user_1', uid: 'user_1', role: 'user', userType: 'customer' };
      return next();
    }
    if (token === 'agent-token') {
      req.user = { id: 'agent_1', uid: 'agent_1', role: 'support', email: 'support@leaf.test' };
      return next();
    }
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }),
  canAccessUserScope: jest.fn((user, targetUserId) => {
    if (String(user?.uid || user?.id || '') === String(targetUserId || '')) {
      return true;
    }
    return ['admin', 'manager', 'super-admin', 'support', 'development'].includes(user?.role);
  }),
  isSupportAgent: jest.fn((user) =>
    ['admin', 'manager', 'super-admin', 'support', 'development'].includes(user?.role)
  )
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  }
}));

function createApp() {
  const routes = require('../../../routes/support-chat');
  const app = express();
  app.use(express.json());
  app.use('/support', routes);
  return app;
}

describe('support chat REST routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetChatStatus.mockResolvedValue({ status: 'open' });
    mockReopenChatForOpenTicket.mockResolvedValue({ reopened: true });
    mockSendMessage.mockResolvedValue({
      message: {
        id: 'message_1',
        message: 'Oi',
        senderType: 'user'
      }
    });
  });

  it('forces user senderType for regular users even when body tries to spoof agent', async () => {
    const response = await request(createApp())
      .post('/support/chat/user_1/message')
      .set('Authorization', 'Bearer user-token')
      .send({
        message: 'Oi',
        senderType: 'agent'
      });

    expect(response.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledWith('user_1', 'Oi', 'user');
  });

  it('keeps agent senderType only for support agents', async () => {
    const response = await request(createApp())
      .post('/support/chat/user_1/message')
      .set('Authorization', 'Bearer agent-token')
      .send({ message: 'Resposta do suporte' });

    expect(response.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledWith('user_1', 'Resposta do suporte', 'agent');
  });
});
