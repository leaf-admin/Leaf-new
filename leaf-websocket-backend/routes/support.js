const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRole } = require('./auth');
const jwt = require('jsonwebtoken');

// Firebase integration
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'support-routes' });
}

// Redis integration
let Redis = null;
try {
  Redis = require('ioredis');
const { logStructured, logError } = require('../utils/logger');
} catch (e) {
  logStructured('warn', '⚠️ Redis não encontrado', { service: 'support-routes' });
}

// Configurações
const JWT_SECRET = process.env.JWT_SECRET || 'leaf-dashboard-secret-key-2025';

// ===== MIDDLEWARE DE SEGURANÇA =====

// Rate limiting para APIs de suporte
const rateLimit = require('express-rate-limit');
const supportRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP
  message: 'Muitas tentativas, tente novamente em 15 minutos',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware de validação de entrada
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
  
  next();
};

// Middleware de sanitização
const sanitizeInput = (req, res, next) => {
  // Sanitizar strings para prevenir XSS
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/[<>]/g, '') // Remove < e >
      .replace(/javascript:/gi, '') // Remove javascript:
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  };
  
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    });
  }
  
  next();
};

// ===== APIS DE TICKETS =====

// Criar ticket
router.post('/tickets', supportRateLimit, sanitizeInput, validateTicketData, async (req, res) => {
  try {
    const { subject, description, category = 'general', priority = 'N3', userInfo, metadata } = req.body;
    
    // Verificar se Firebase está disponível
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const ticketId = `TICKET-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const ticket = {
      id: ticketId,
      userId: req.user?.id || 'anonymous',
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
    
    // Salvar no Firebase
    await db.ref(`support_tickets/${ticketId}`).set(ticket);
    
    // Criar mensagem inicial
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const initialMessage = {
      id: messageId,
      ticketId,
      senderId: ticket.userId,
      senderType: 'user',
      message: description.trim(),
      messageType: 'text',
      isInternal: false,
      attachments: [],
      createdAt: now,
      readBy: {
        [ticket.userId]: now
      }
    };
    
    await db.ref(`support_messages/${ticketId}/${messageId}`).set(initialMessage);
    
    // ✅ Notificar agentes disponíveis via WebSocket (TEMPO REAL)
    await notifyAvailableAgents(ticket);
    
    logStructured('info', `🎫 Novo ticket criado: ${ticketId} - Prioridade: ${priority}`, { service: 'support-routes' });
    
    res.status(201).json({
      success: true,
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt
      }
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao criar ticket:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Listar tickets do usuário
router.get('/tickets', authenticateToken, async (req, res) => {
  try {
    const { status, priority, category, limit = 50, offset = 0 } = req.query;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const snapshot = await db.ref('support_tickets')
      .orderByChild('userId')
      .equalTo(req.user.id)
      .once('value');
    
    let tickets = [];
    if (snapshot.val()) {
      tickets = Object.values(snapshot.val());
    }
    
    // Aplicar filtros
    if (status) {
      tickets = tickets.filter(ticket => ticket.status === status);
    }
    if (priority) {
      tickets = tickets.filter(ticket => ticket.priority === priority);
    }
    if (category) {
      tickets = tickets.filter(ticket => ticket.category === category);
    }
    
    // Ordenar por data de criação (mais recente primeiro)
    tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Paginação
    const paginatedTickets = tickets.slice(offset, offset + parseInt(limit));
    
    res.json({
      success: true,
      tickets: paginatedTickets,
      total: tickets.length,
      hasMore: (offset + parseInt(limit)) < tickets.length
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao listar tickets:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter ticket específico
router.get('/tickets/:ticketId', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const snapshot = await db.ref(`support_tickets/${ticketId}`).once('value');
    
    if (!snapshot.val()) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticket = snapshot.val();
    
    // Verificar se o usuário tem acesso ao ticket
    if (ticket.userId !== req.user.id && !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    res.json({
      success: true,
      ticket
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao obter ticket:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ===== APIS DE MENSAGENS =====

// Listar mensagens do ticket
router.get('/tickets/:ticketId/messages', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Verificar se o ticket existe e se o usuário tem acesso
    const ticketSnapshot = await db.ref(`support_tickets/${ticketId}`).once('value');
    if (!ticketSnapshot.val()) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticket = ticketSnapshot.val();
    if (ticket.userId !== req.user.id && !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    // Buscar mensagens
    const messagesSnapshot = await db.ref(`support_messages/${ticketId}`)
      .orderByChild('createdAt')
      .once('value');
    
    let messages = [];
    if (messagesSnapshot.val()) {
      messages = Object.values(messagesSnapshot.val());
    }
    
    res.json({
      success: true,
      messages
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao listar mensagens:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Enviar mensagem
router.post('/tickets/:ticketId/messages', supportRateLimit, sanitizeInput, authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message, messageType = 'text', attachments = [] } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Mensagem é obrigatória' });
    }
    
    if (message.length > 1000) {
      return res.status(400).json({ error: 'Mensagem muito longa (máximo 1000 caracteres)' });
    }
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Verificar se o ticket existe e se o usuário tem acesso
    const ticketSnapshot = await db.ref(`support_tickets/${ticketId}`).once('value');
    if (!ticketSnapshot.val()) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticket = ticketSnapshot.val();
    if (ticket.userId !== req.user.id && !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const newMessage = {
      id: messageId,
      ticketId,
      senderId: req.user.id,
      senderType: ticket.userId === req.user.id ? 'user' : 'agent',
      message: message.trim(),
      messageType,
      isInternal: false,
      attachments,
      createdAt: now,
      readBy: {
        [req.user.id]: now
      }
    };
    
    // Salvar mensagem
    await db.ref(`support_messages/${ticketId}/${messageId}`).set(newMessage);
    
    // Atualizar timestamp do ticket
    await db.ref(`support_tickets/${ticketId}`).update({
      updatedAt: now
    });
    
    // Notificar participantes
    await notifyParticipants(ticketId, newMessage);
    
    logStructured('info', `💬 Mensagem enviada no ticket ${ticketId} por ${req.user.username}`, { service: 'support-routes' });
    
    res.status(201).json({
      success: true,
      message: newMessage
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao enviar mensagem:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ===== APIS DE AGENTES (ADMIN/MANAGER) =====

// Listar todos os tickets (apenas admin/manager)
router.get('/admin/tickets', authenticateToken, authorizeRole(['admin', 'manager']), async (req, res) => {
  try {
    const { status, priority, category, agent, limit = 100, offset = 0 } = req.query;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const snapshot = await db.ref('support_tickets').once('value');
    
    let tickets = [];
    if (snapshot.val()) {
      tickets = Object.values(snapshot.val());
    }
    
    // Aplicar filtros
    if (status) {
      tickets = tickets.filter(ticket => ticket.status === status);
    }
    if (priority) {
      tickets = tickets.filter(ticket => ticket.priority === priority);
    }
    if (category) {
      tickets = tickets.filter(ticket => ticket.category === category);
    }
    if (agent) {
      tickets = tickets.filter(ticket => ticket.assignedAgent === agent);
    }
    
    // Ordenar por prioridade e data
    tickets.sort((a, b) => {
      const priorityOrder = { 'N1': 3, 'N2': 2, 'N3': 1 };
      const aPriority = priorityOrder[a.priority] || 0;
      const bPriority = priorityOrder[b.priority] || 0;
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    
    // Paginação
    const paginatedTickets = tickets.slice(offset, offset + parseInt(limit));
    
    res.json({
      success: true,
      tickets: paginatedTickets,
      total: tickets.length,
      hasMore: (offset + parseInt(limit)) < tickets.length
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao listar tickets admin:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Atribuir ticket a agente
router.post('/admin/tickets/:ticketId/assign', authenticateToken, authorizeRole(['admin', 'manager']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { agentId, agentName } = req.body;
    
    if (!agentId || !agentName) {
      return res.status(400).json({ error: 'ID e nome do agente são obrigatórios' });
    }
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const now = new Date().toISOString();
    
    // Atualizar ticket
    await db.ref(`support_tickets/${ticketId}`).update({
      assignedAgent: agentId,
      assignedAt: now,
      status: 'assigned',
      updatedAt: now
    });
    
    // Adicionar mensagem de sistema
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const systemMessage = {
      id: messageId,
      ticketId,
      senderId: req.user.id,
      senderType: 'agent',
      message: `Ticket atribuído ao agente ${agentName}`,
      messageType: 'system',
      isInternal: true,
      attachments: [],
      createdAt: now,
      readBy: {
        [req.user.id]: now
      }
    };
    
    await db.ref(`support_messages/${ticketId}/${messageId}`).set(systemMessage);
    
    logStructured('info', `👤 Ticket ${ticketId} atribuído ao agente ${agentName} por ${req.user.username}`, { service: 'support-routes' });
    
    res.json({
      success: true,
      message: 'Ticket atribuído com sucesso'
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao atribuir ticket:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Escalar ticket
router.post('/admin/tickets/:ticketId/escalate', authenticateToken, authorizeRole(['admin', 'manager']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { reason } = req.body;
    
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Motivo da escalação é obrigatório' });
    }
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Buscar ticket atual
    const ticketSnapshot = await db.ref(`support_tickets/${ticketId}`).once('value');
    if (!ticketSnapshot.val()) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticket = ticketSnapshot.val();
    const newLevel = Math.min(ticket.escalationLevel + 1, 3);
    const now = new Date().toISOString();
    
    const escalationEntry = {
      level: newLevel,
      reason: reason.trim(),
      escalatedBy: req.user.id,
      escalatedAt: now
    };
    
    // Atualizar ticket
    await db.ref(`support_tickets/${ticketId}`).update({
      escalationLevel: newLevel,
      status: 'escalated',
      assignedAgent: null,
      assignedAt: null,
      updatedAt: now,
      escalationHistory: [...(ticket.escalationHistory || []), escalationEntry]
    });
    
    // Adicionar mensagem de sistema
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const systemMessage = {
      id: messageId,
      ticketId,
      senderId: req.user.id,
      senderType: 'agent',
      message: `Ticket escalado para nível ${newLevel}. Motivo: ${reason.trim()}`,
      messageType: 'system',
      isInternal: true,
      attachments: [],
      createdAt: now,
      readBy: {
        [req.user.id]: now
      }
    };
    
    await db.ref(`support_messages/${ticketId}/${messageId}`).set(systemMessage);
    
    logStructured('info', `⬆️ Ticket ${ticketId} escalado para nível ${newLevel} por ${req.user.username}`, { service: 'support-routes' });
    
    res.json({
      success: true,
      message: 'Ticket escalado com sucesso',
      escalationLevel: newLevel
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao escalar ticket:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Resolver ticket
router.post('/admin/tickets/:ticketId/resolve', authenticateToken, authorizeRole(['admin', 'manager']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { resolution } = req.body;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const now = new Date().toISOString();
    
    // Atualizar ticket
    await db.ref(`support_tickets/${ticketId}`).update({
      status: 'resolved',
      resolvedAt: now,
      updatedAt: now
    });
    
    // Adicionar mensagem de sistema
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const systemMessage = {
      id: messageId,
      ticketId,
      senderId: req.user.id,
      senderType: 'agent',
      message: resolution ? `Ticket resolvido. ${resolution}` : 'Ticket resolvido.',
      messageType: 'system',
      isInternal: false,
      attachments: [],
      createdAt: now,
      readBy: {
        [req.user.id]: now
      }
    };
    
    await db.ref(`support_messages/${ticketId}/${messageId}`).set(systemMessage);
    
    logStructured('info', `✅ Ticket ${ticketId} resolvido por ${req.user.username}`, { service: 'support-routes' });
    
    res.json({
      success: true,
      message: 'Ticket resolvido com sucesso'
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao resolver ticket:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ===== ESTATÍSTICAS =====

// Estatísticas de tickets
router.get('/admin/stats', authenticateToken, authorizeRole(['admin', 'manager']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de tickets temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const snapshot = await db.ref('support_tickets').once('value');
    
    let tickets = [];
    if (snapshot.val()) {
      tickets = Object.values(snapshot.val());
    }
    
    // Aplicar filtro de data se fornecido
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      tickets = tickets.filter(ticket => {
        const ticketDate = new Date(ticket.createdAt);
        return ticketDate >= start && ticketDate <= end;
      });
    }
    
    const stats = {
      total: tickets.length,
      open: tickets.filter(t => t.status === 'open').length,
      assigned: tickets.filter(t => t.status === 'assigned').length,
      inProgress: tickets.filter(t => t.status === 'in_progress').length,
      resolved: tickets.filter(t => t.status === 'resolved').length,
      closed: tickets.filter(t => t.status === 'closed').length,
      escalated: tickets.filter(t => t.status === 'escalated').length,
      byPriority: {
        N1: tickets.filter(t => t.priority === 'N1').length,
        N2: tickets.filter(t => t.priority === 'N2').length,
        N3: tickets.filter(t => t.priority === 'N3').length
      },
      byCategory: {
        technical: tickets.filter(t => t.category === 'technical').length,
        payment: tickets.filter(t => t.category === 'payment').length,
        account: tickets.filter(t => t.category === 'account').length,
        general: tickets.filter(t => t.category === 'general').length
      },
      averageResolutionTime: calculateAverageResolutionTime(tickets)
    };
    
    res.json({
      success: true,
      stats
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao obter estatísticas:', { service: 'support-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ===== FUNÇÕES AUXILIARES =====

// Calcular tempo médio de resolução
function calculateAverageResolutionTime(tickets) {
  const resolvedTickets = tickets.filter(t => t.resolvedAt);
  
  if (resolvedTickets.length === 0) return 0;

  const totalTime = resolvedTickets.reduce((sum, ticket) => {
    const created = new Date(ticket.createdAt);
    const resolved = new Date(ticket.resolvedAt);
    return sum + (resolved - created);
  }, 0);

  return Math.round(totalTime / resolvedTickets.length / (1000 * 60 * 60)); // Converter para horas
}

// Obter instância do Socket.IO (será injetada)
let ioInstance = null;

function setIOInstance(io) {
  ioInstance = io;
}

// Notificar agentes disponíveis
async function notifyAvailableAgents(ticket) {
  try {
    logStructured('info', `🔔 Notificando agentes sobre novo ticket: ${ticket.id}`, { service: 'support-routes' });
    
    // Notificar via WebSocket para dashboard (todos os admins conectados)
    if (ioInstance) {
      // Emitir para todos os clientes conectados (dashboard admins)
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
      
      logStructured('info', `✅ Notificação WebSocket enviada para dashboard sobre ticket: ${ticket.id}`, { service: 'support-routes' });
    }
    
    // Aqui você implementaria:
    // - Push notifications para agentes
    // - Email para supervisores se necessário
    
  } catch (error) {
    logError(error, '❌ Erro ao notificar agentes:', { service: 'support-routes' });
  }
}

// Notificar participantes sobre nova mensagem
async function notifyParticipants(ticketId, message) {
  try {
    logStructured('info', `🔔 Notificando participantes sobre nova mensagem no ticket: ${ticketId}`, { service: 'support-routes' });
    
    // Notificar via WebSocket
    if (ioInstance) {
      // Notificar dashboard sobre nova mensagem
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
      
      logStructured('info', `✅ Notificação WebSocket enviada sobre nova mensagem no ticket: ${ticketId}`, { service: 'support-routes' });
    }
    
  } catch (error) {
    logError(error, '❌ Erro ao notificar participantes:', { service: 'support-routes' });
  }
}

module.exports.setIOInstance = setIOInstance;

module.exports = router;










