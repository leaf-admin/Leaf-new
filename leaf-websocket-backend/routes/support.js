const express = require('express');
const rateLimit = require('express-rate-limit');
const { logStructured, logError } = require('../utils/logger');
const {
  authenticateSupport,
  requireSupportRoles,
  isSupportAgent
} = require('../middleware/support-auth');

const router = express.Router();

let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (error) {
  logStructured('warn', 'Firebase config não encontrado para suporte', {
    service: 'support-routes',
    error: error.message
  });
}

let supportChatService = null;
try {
  supportChatService = require('../services/support-chat-service');
} catch (error) {
  logStructured('warn', 'Support Chat Service não encontrado para reabertura automática', {
    service: 'support-routes',
    error: error.message
  });
}

const supportTicketService = require('../services/support-ticket-service');
const supportQueueService = require('../services/support-queue-service');
const supportDriverIdentityReverificationService = require('../services/support-driver-identity-reverification-service');

const AGENT_ROLES = ['admin', 'manager', 'super-admin', 'support', 'development'];

const supportRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Muitas tentativas, tente novamente em 15 minutos',
  standardHeaders: true,
  legacyHeaders: false
});

const validateTicketData = (req, res, next) => {
  const { subject, description, category, priority } = req.body;

  if (!subject || !description) {
    return res.status(400).json({ error: 'Assunto e descrição são obrigatórios' });
  }

  if (subject.length > 200) {
    return res.status(400).json({ error: 'Assunto muito longo (máximo 200 caracteres)' });
  }

  if (description.length > 2000) {
    return res.status(400).json({ error: 'Descrição muito longa (máximo 2000 caracteres)' });
  }

  const validCategories = ['technical', 'payment', 'account', 'general'];
  if (category && !validCategories.includes(category)) {
    return res.status(400).json({ error: 'Categoria inválida' });
  }

  const validPriorities = ['N1', 'N2', 'N3'];
  if (priority && !validPriorities.includes(priority)) {
    return res.status(400).json({ error: 'Prioridade inválida' });
  }

  return next();
};

const sanitizeInput = (req, _res, next) => {
  const sanitizeString = (value) => {
    if (typeof value !== 'string') return value;
    return value
      .replace(/[<>]/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '')
      .trim();
  };

  if (req.body && typeof req.body === 'object') {
    Object.keys(req.body).forEach((key) => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    });
  }

  return next();
};

function getRequesterId(req) {
  return String(req.user?.uid || req.user?.id || '');
}

function getRequesterLabel(req) {
  return req.user?.email || req.user?.username || req.user?.id || 'unknown';
}

function canAccessTicket(req, ticket) {
  if (!ticket) return false;

  const requesterId = getRequesterId(req);
  if (requesterId && String(ticket.userId) === requesterId) {
    return true;
  }

  return isSupportAgent(req.user);
}

router.get('/faq', (_req, res) => {
  res.json({
    faqs: [
      {
        question: 'Como entrar em contato com o suporte?',
        answer: 'Use o chat em tempo real no app ou abra um ticket com o contexto da solicitação.'
      },
      {
        question: 'Qual o horário de atendimento?',
        answer: 'O suporte da plataforma opera 24 horas por dia, 7 dias por semana.'
      },
      {
        question: 'Como criar um ticket?',
        answer: 'No app, acesse Suporte > Tickets e informe assunto, categoria e descrição.'
      }
    ]
  });
});

// ===== APIS DE TICKETS =====

router.get('/queue/summary', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (_req, res) => {
  try {
    const summary = await supportQueueService.getQueueSummary({ autoEscalate: true });
    res.json({ success: true, summary });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'queueSummary' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/queue/backlog', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { priority, status, limit = 100, offset = 0 } = req.query;
    const backlog = await supportQueueService.getBacklog({
      priority,
      status,
      limit,
      offset,
      autoEscalate: true
    });
    res.json({ success: true, ...backlog });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'queueBacklog' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post(
  '/tickets',
  supportRateLimit,
  authenticateSupport,
  sanitizeInput,
  validateTicketData,
  async (req, res) => {
    try {
      const { subject, description, category = 'general', priority = 'N3', userInfo, metadata } = req.body;
      const requesterId = getRequesterId(req);
      const { ticket } = await supportQueueService.createSupportTicket({
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
        requesterId,
        userType: req.user?.userType || 'passenger',
        userInfo: userInfo || {},
        metadata: metadata || {},
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      await notifyAvailableAgents(ticket);
      await supportDriverIdentityReverificationService.handleTicket(ticket).catch((identityError) => {
        logError(identityError, {
          service: 'support-routes',
          operation: 'driverIdentityReverification',
          ticketId: ticket.id
        });
      });

      // Garantir que o chat do usuário volte para ativo ao abrir novo ticket.
      if (supportChatService && supportChatService.reopenChat) {
        await supportChatService.reopenChat(requesterId, 'ticket_created', { ticketId: ticket.id });
      }

      logStructured('info', `Novo ticket criado: ${ticket.id}`, {
        service: 'support-routes',
        ticketId: ticket.id,
        priority,
        requesterId
      });

      res.status(201).json({
        success: true,
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          createdAt: ticket.createdAt,
          userId: ticket.userId
        }
      });
    } catch (error) {
      logError(error, { service: 'support-routes', operation: 'createTicket' });
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
);

router.get('/tickets', authenticateSupport, async (req, res) => {
  try {
    const { status, priority, category, limit = 50, offset = 0, userId } = req.query;
    const requesterId = getRequesterId(req);
    const { tickets, total, hasMore } = await supportTicketService.listTickets({
      status,
      priority,
      category,
      limit,
      offset,
      userId: isSupportAgent(req.user) ? (userId ? String(userId) : null) : requesterId,
      isAgent: isSupportAgent(req.user)
    });

    res.json({
      success: true,
      tickets,
      total,
      hasMore
    });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'listTickets' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/tickets/:ticketId', authenticateSupport, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const ticket = await supportTicketService.getTicket(ticketId);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    if (!canAccessTicket(req, ticket)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    return res.json({ success: true, ticket });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'getTicket' });
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/tickets/:ticketId/messages', authenticateSupport, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const ticket = await supportTicketService.getTicket(ticketId);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    if (!canAccessTicket(req, ticket)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const messages = await supportTicketService.listMessages(ticketId);

    return res.json({ success: true, messages });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'listTicketMessages' });
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/tickets/:ticketId/messages', supportRateLimit, sanitizeInput, authenticateSupport, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message, messageType = 'text', attachments = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Mensagem é obrigatória' });
    }

    if (message.length > 1000) {
      return res.status(400).json({ error: 'Mensagem muito longa (máximo 1000 caracteres)' });
    }

    const ticket = await supportTicketService.getTicket(ticketId);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    if (!canAccessTicket(req, ticket)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const senderId = getRequesterId(req);
    const senderType = senderId === String(ticket.userId) ? 'user' : 'agent';
    const newMessage = await supportTicketService.addMessage(ticketId, {
      senderId,
      senderType,
      message: message.trim(),
      messageType,
      attachments,
      isInternal: false
    });

    await notifyParticipants(ticketId, newMessage);

    logStructured('info', `Mensagem enviada no ticket ${ticketId}`, {
      service: 'support-routes',
      ticketId,
      senderId,
      actor: getRequesterLabel(req)
    });

    return res.status(201).json({ success: true, message: newMessage });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'sendTicketMessage' });
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/tickets/:ticketId/assign', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { agentId, agentName } = req.body;

    if (!agentId || !agentName) {
      return res.status(400).json({ error: 'ID e nome do agente são obrigatórios' });
    }

    await supportQueueService.assignTicket(ticketId, {
      agentId,
      agentName,
      actorId: getRequesterId(req)
    });

    res.json({ success: true, message: 'Ticket atribuído com sucesso' });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'assignTicketAlias' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/tickets/:ticketId/escalate', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Motivo da escalação é obrigatório' });
    }

    const result = await supportQueueService.escalateTicket(ticketId, {
      reason: reason.trim(),
      actorId: getRequesterId(req)
    });

    res.json({ success: true, message: 'Ticket escalado com sucesso', escalationLevel: result.escalationLevel });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'escalateTicketAlias' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/tickets/:ticketId/resolve', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { resolution } = req.body;

    await supportQueueService.resolveTicket(ticketId, {
      resolution,
      actorId: getRequesterId(req)
    });

    res.json({ success: true, message: 'Ticket resolvido com sucesso' });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'resolveTicketAlias' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ===== APIS DE AGENTES =====

router.get('/admin/tickets', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { status, priority, category, agent, limit = 100, offset = 0 } = req.query;
    const { tickets, total, hasMore } = await supportTicketService.listTickets({
      status,
      priority,
      category,
      agent,
      limit,
      offset,
      isAgent: true
    });

    res.json({
      success: true,
      tickets,
      total,
      hasMore
    });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'listAdminTickets' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/admin/tickets/:ticketId/assign', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { agentId, agentName } = req.body;

    if (!agentId || !agentName) {
      return res.status(400).json({ error: 'ID e nome do agente são obrigatórios' });
    }

    const senderId = getRequesterId(req);
    await supportQueueService.assignTicket(ticketId, {
      agentId,
      agentName,
      actorId: senderId
    });

    logStructured('info', `Ticket ${ticketId} atribuído`, {
      service: 'support-routes',
      ticketId,
      assignedAgent: agentId,
      actor: getRequesterLabel(req)
    });

    res.json({ success: true, message: 'Ticket atribuído com sucesso' });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'assignTicket' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/admin/tickets/:ticketId/escalate', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Motivo da escalação é obrigatório' });
    }

    const senderId = getRequesterId(req);
    const result = await supportQueueService.escalateTicket(ticketId, {
      reason: reason.trim(),
      actorId: senderId
    });

    logStructured('info', `Ticket ${ticketId} escalado`, {
      service: 'support-routes',
      ticketId,
      escalationLevel: result.escalationLevel,
      actor: getRequesterLabel(req)
    });

    res.json({ success: true, message: 'Ticket escalado com sucesso', escalationLevel: result.escalationLevel });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'escalateTicket' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/admin/tickets/:ticketId/resolve', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { resolution } = req.body;

    const senderId = getRequesterId(req);
    await supportQueueService.resolveTicket(ticketId, {
      resolution,
      actorId: senderId
    });

    logStructured('info', `Ticket ${ticketId} resolvido`, {
      service: 'support-routes',
      ticketId,
      actor: getRequesterLabel(req)
    });

    res.json({ success: true, message: 'Ticket resolvido com sucesso' });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'resolveTicket' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/admin/stats', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await supportTicketService.getAdminStats({ startDate, endDate });

    res.json({ success: true, stats });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'supportStats' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

let ioInstance = null;

function setIOInstance(io) {
  ioInstance = io;
}

async function notifyAvailableAgents(ticket) {
  try {
    if (!ioInstance) return;

    ioInstance.emit('support:ticket:new', {
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        userId: ticket.userId,
        userType: ticket.userType,
        category: ticket.category,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt
      }
    });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'notifyAvailableAgents' });
  }
}

async function notifyParticipants(ticketId, message) {
  try {
    if (!ioInstance) return;

    ioInstance.emit('support:message:new', {
      ticketId,
      message: {
        id: message.id,
        ticketId: message.ticketId,
        senderId: message.senderId,
        senderType: message.senderType,
        message: message.message,
        messageType: message.messageType,
        createdAt: message.createdAt
      }
    });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'notifyParticipants' });
  }
}

router.setIOInstance = setIOInstance;

module.exports = router;
