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

const AGENT_ROLES = ['admin', 'manager', 'super-admin'];

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

function getRealtimeDBOrFail(res) {
  if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
    res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    return null;
  }

  const db = firebaseConfig.getRealtimeDB();
  if (!db) {
    res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    return null;
  }

  return db;
}

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

router.post(
  '/tickets',
  supportRateLimit,
  authenticateSupport,
  sanitizeInput,
  validateTicketData,
  async (req, res) => {
    try {
      const { subject, description, category = 'general', priority = 'N3', userInfo, metadata } = req.body;

      const db = getRealtimeDBOrFail(res);
      if (!db) return;

      const ticketId = `TICKET-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const now = new Date().toISOString();
      const requesterId = getRequesterId(req);

      const ticket = {
        id: ticketId,
        userId: requesterId,
        userType: req.user?.userType || 'passenger',
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
        status: 'open',
        assignedAgent: null,
        assignedAt: null,
        resolvedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        tags: [],
        attachments: [],
        escalationLevel: 1,
        escalationHistory: [],
        userInfo: userInfo || {},
        metadata: metadata || {},
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      };

      await db.ref(`support_tickets/${ticketId}`).set(ticket);

      const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const initialMessage = {
        id: messageId,
        ticketId,
        senderId: requesterId,
        senderType: 'user',
        message: description.trim(),
        messageType: 'text',
        isInternal: false,
        attachments: [],
        createdAt: now,
        readBy: {
          [requesterId]: now
        }
      };

      await db.ref(`support_messages/${ticketId}/${messageId}`).set(initialMessage);
      await notifyAvailableAgents(ticket);

      logStructured('info', `Novo ticket criado: ${ticketId}`, {
        service: 'support-routes',
        ticketId,
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

    const db = getRealtimeDBOrFail(res);
    if (!db) return;

    let snapshot;
    const requesterId = getRequesterId(req);

    if (isSupportAgent(req.user)) {
      if (userId) {
        snapshot = await db.ref('support_tickets').orderByChild('userId').equalTo(String(userId)).once('value');
      } else {
        snapshot = await db.ref('support_tickets').once('value');
      }
    } else {
      snapshot = await db.ref('support_tickets').orderByChild('userId').equalTo(requesterId).once('value');
    }

    let tickets = snapshot.val() ? Object.values(snapshot.val()) : [];

    if (status) tickets = tickets.filter((ticket) => ticket.status === status);
    if (priority) tickets = tickets.filter((ticket) => ticket.priority === priority);
    if (category) tickets = tickets.filter((ticket) => ticket.category === category);

    tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const numericOffset = Number.parseInt(offset, 10) || 0;
    const numericLimit = Number.parseInt(limit, 10) || 50;
    const paginatedTickets = tickets.slice(numericOffset, numericOffset + numericLimit);

    res.json({
      success: true,
      tickets: paginatedTickets,
      total: tickets.length,
      hasMore: numericOffset + numericLimit < tickets.length
    });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'listTickets' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/tickets/:ticketId', authenticateSupport, async (req, res) => {
  try {
    const { ticketId } = req.params;

    const db = getRealtimeDBOrFail(res);
    if (!db) return;

    const snapshot = await db.ref(`support_tickets/${ticketId}`).once('value');
    const ticket = snapshot.val();

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

    const db = getRealtimeDBOrFail(res);
    if (!db) return;

    const ticketSnapshot = await db.ref(`support_tickets/${ticketId}`).once('value');
    const ticket = ticketSnapshot.val();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    if (!canAccessTicket(req, ticket)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const messagesSnapshot = await db.ref(`support_messages/${ticketId}`).orderByChild('createdAt').once('value');
    const messages = messagesSnapshot.val() ? Object.values(messagesSnapshot.val()) : [];

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

    const db = getRealtimeDBOrFail(res);
    if (!db) return;

    const ticketSnapshot = await db.ref(`support_tickets/${ticketId}`).once('value');
    const ticket = ticketSnapshot.val();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    if (!canAccessTicket(req, ticket)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const senderId = getRequesterId(req);
    const senderType = senderId === String(ticket.userId) ? 'user' : 'agent';
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date().toISOString();

    const newMessage = {
      id: messageId,
      ticketId,
      senderId,
      senderType,
      message: message.trim(),
      messageType,
      isInternal: false,
      attachments,
      createdAt: now,
      readBy: {
        [senderId]: now
      }
    };

    await db.ref(`support_messages/${ticketId}/${messageId}`).set(newMessage);
    await db.ref(`support_tickets/${ticketId}`).update({ updatedAt: now });

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

// ===== APIS DE AGENTES =====

router.get('/admin/tickets', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { status, priority, category, agent, limit = 100, offset = 0 } = req.query;

    const db = getRealtimeDBOrFail(res);
    if (!db) return;

    const snapshot = await db.ref('support_tickets').once('value');
    let tickets = snapshot.val() ? Object.values(snapshot.val()) : [];

    if (status) tickets = tickets.filter((ticket) => ticket.status === status);
    if (priority) tickets = tickets.filter((ticket) => ticket.priority === priority);
    if (category) tickets = tickets.filter((ticket) => ticket.category === category);
    if (agent) tickets = tickets.filter((ticket) => ticket.assignedAgent === agent);

    tickets.sort((a, b) => {
      const priorityOrder = { N1: 3, N2: 2, N3: 1 };
      const aPriority = priorityOrder[a.priority] || 0;
      const bPriority = priorityOrder[b.priority] || 0;

      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }

      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const numericOffset = Number.parseInt(offset, 10) || 0;
    const numericLimit = Number.parseInt(limit, 10) || 100;

    res.json({
      success: true,
      tickets: tickets.slice(numericOffset, numericOffset + numericLimit),
      total: tickets.length,
      hasMore: numericOffset + numericLimit < tickets.length
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

    const db = getRealtimeDBOrFail(res);
    if (!db) return;

    const now = new Date().toISOString();

    await db.ref(`support_tickets/${ticketId}`).update({
      assignedAgent: agentId,
      assignedAt: now,
      status: 'assigned',
      updatedAt: now
    });

    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const senderId = getRequesterId(req);

    const systemMessage = {
      id: messageId,
      ticketId,
      senderId,
      senderType: 'agent',
      message: `Ticket atribuído ao agente ${agentName}`,
      messageType: 'system',
      isInternal: true,
      attachments: [],
      createdAt: now,
      readBy: {
        [senderId]: now
      }
    };

    await db.ref(`support_messages/${ticketId}/${messageId}`).set(systemMessage);

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

    const db = getRealtimeDBOrFail(res);
    if (!db) return;

    const ticketSnapshot = await db.ref(`support_tickets/${ticketId}`).once('value');
    const ticket = ticketSnapshot.val();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    const newLevel = Math.min((ticket.escalationLevel || 1) + 1, 3);
    const now = new Date().toISOString();
    const senderId = getRequesterId(req);

    const escalationEntry = {
      level: newLevel,
      reason: reason.trim(),
      escalatedBy: senderId,
      escalatedAt: now
    };

    await db.ref(`support_tickets/${ticketId}`).update({
      escalationLevel: newLevel,
      status: 'escalated',
      assignedAgent: null,
      assignedAt: null,
      updatedAt: now,
      escalationHistory: [...(ticket.escalationHistory || []), escalationEntry]
    });

    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const systemMessage = {
      id: messageId,
      ticketId,
      senderId,
      senderType: 'agent',
      message: `Ticket escalado para nível ${newLevel}. Motivo: ${reason.trim()}`,
      messageType: 'system',
      isInternal: true,
      attachments: [],
      createdAt: now,
      readBy: {
        [senderId]: now
      }
    };

    await db.ref(`support_messages/${ticketId}/${messageId}`).set(systemMessage);

    logStructured('info', `Ticket ${ticketId} escalado`, {
      service: 'support-routes',
      ticketId,
      escalationLevel: newLevel,
      actor: getRequesterLabel(req)
    });

    res.json({ success: true, message: 'Ticket escalado com sucesso', escalationLevel: newLevel });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'escalateTicket' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/admin/tickets/:ticketId/resolve', authenticateSupport, requireSupportRoles(AGENT_ROLES), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { resolution } = req.body;

    const db = getRealtimeDBOrFail(res);
    if (!db) return;

    const now = new Date().toISOString();
    const senderId = getRequesterId(req);

    await db.ref(`support_tickets/${ticketId}`).update({
      status: 'resolved',
      resolvedAt: now,
      updatedAt: now
    });

    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const systemMessage = {
      id: messageId,
      ticketId,
      senderId,
      senderType: 'agent',
      message: resolution ? `Ticket resolvido. ${resolution}` : 'Ticket resolvido.',
      messageType: 'system',
      isInternal: false,
      attachments: [],
      createdAt: now,
      readBy: {
        [senderId]: now
      }
    };

    await db.ref(`support_messages/${ticketId}/${messageId}`).set(systemMessage);

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

    const db = getRealtimeDBOrFail(res);
    if (!db) return;

    const snapshot = await db.ref('support_tickets').once('value');
    let tickets = snapshot.val() ? Object.values(snapshot.val()) : [];

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      tickets = tickets.filter((ticket) => {
        const ticketDate = new Date(ticket.createdAt);
        return ticketDate >= start && ticketDate <= end;
      });
    }

    const stats = {
      total: tickets.length,
      open: tickets.filter((ticket) => ticket.status === 'open').length,
      assigned: tickets.filter((ticket) => ticket.status === 'assigned').length,
      inProgress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
      resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
      closed: tickets.filter((ticket) => ticket.status === 'closed').length,
      escalated: tickets.filter((ticket) => ticket.status === 'escalated').length,
      byPriority: {
        N1: tickets.filter((ticket) => ticket.priority === 'N1').length,
        N2: tickets.filter((ticket) => ticket.priority === 'N2').length,
        N3: tickets.filter((ticket) => ticket.priority === 'N3').length
      },
      byCategory: {
        technical: tickets.filter((ticket) => ticket.category === 'technical').length,
        payment: tickets.filter((ticket) => ticket.category === 'payment').length,
        account: tickets.filter((ticket) => ticket.category === 'account').length,
        general: tickets.filter((ticket) => ticket.category === 'general').length
      },
      averageResolutionTime: calculateAverageResolutionTime(tickets)
    };

    res.json({ success: true, stats });
  } catch (error) {
    logError(error, { service: 'support-routes', operation: 'supportStats' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

function calculateAverageResolutionTime(tickets) {
  const resolvedTickets = tickets.filter((ticket) => ticket.resolvedAt);
  if (resolvedTickets.length === 0) return 0;

  const totalTime = resolvedTickets.reduce((sum, ticket) => {
    const created = new Date(ticket.createdAt);
    const resolved = new Date(ticket.resolvedAt);
    return sum + (resolved - created);
  }, 0);

  return Math.round(totalTime / resolvedTickets.length / (1000 * 60 * 60));
}

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
