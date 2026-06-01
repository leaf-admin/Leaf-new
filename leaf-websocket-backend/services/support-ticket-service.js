const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const SupportLegacyRtdbRepository = require('../repositories/support-legacy-rtdb-repository');
const { logStructured, logError } = require('../utils/logger');

const TICKETS_COLLECTION = 'support_tickets';
const LEGACY_TICKETS_PATH = 'support_tickets';
const LEGACY_MESSAGES_PATH = 'support_messages';
const MESSAGES_SUBCOLLECTION = 'messages';
const OPEN_TICKET_STATUSES = new Set(['open', 'assigned', 'in_progress', 'escalated']);
const LEGACY_IMPORT_ENABLED = process.env.SUPPORT_TICKETS_ENABLE_LEGACY_IMPORT !== 'false';
const LEGACY_MIRROR_ENABLED = process.env.SUPPORT_TICKETS_ENABLE_LEGACY_RTDB_MIRROR === 'true';

function getFirestoreOrThrow() {
  const firestore = firebaseConfig?.getFirestore ? firebaseConfig.getFirestore() : null;
  if (!firestore) {
    throw new Error('Firestore indisponível para support tickets');
  }
  return firestore;
}

function getLegacyDb() {
  return firebaseConfig?.getRealtimeDB ? firebaseConfig.getRealtimeDB() : null;
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      const dt = value.toDate();
      return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
    }
    if (typeof value._seconds === 'number') {
      return new Date((value._seconds * 1000) + Math.round((value._nanoseconds || 0) / 1e6)).toISOString();
    }
  }
  return fallback;
}

function normalizeTicket(ticketId, raw = {}) {
  const createdAt = toIso(raw.createdAt, new Date().toISOString());
  const updatedAt = toIso(raw.updatedAt, createdAt);
  const assignedAgent = raw.assignedAgent || raw.assignedTo || null;
  return {
    id: ticketId,
    userId: raw.userId ? String(raw.userId) : '',
    userType: raw.userType || 'passenger',
    subject: String(raw.subject || '').trim(),
    description: String(raw.description || '').trim(),
    category: raw.category || 'general',
    priority: raw.priority || 'N3',
    status: raw.status || 'open',
    assignedAgent,
    assignedTo: assignedAgent,
    assignedAt: toIso(raw.assignedAt, null),
    resolvedAt: toIso(raw.resolvedAt, null),
    closedAt: toIso(raw.closedAt, null),
    createdAt,
    updatedAt,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    escalationLevel: Number(raw.escalationLevel || 1),
    escalationHistory: Array.isArray(raw.escalationHistory) ? raw.escalationHistory : [],
    userInfo: raw.userInfo && typeof raw.userInfo === 'object' ? raw.userInfo : {},
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    ipAddress: raw.ipAddress || null,
    userAgent: raw.userAgent || null,
    assignedAgentName: raw.assignedAgentName || raw.assignedToName || null,
    adminNotes: raw.adminNotes || '',
    source: raw.source || 'firestore'
  };
}

function normalizeMessage(ticketId, messageId, raw = {}) {
  const createdAt = toIso(raw.createdAt, new Date().toISOString());
  return {
    id: messageId,
    ticketId,
    senderId: raw.senderId ? String(raw.senderId) : '',
    senderType: raw.senderType || 'user',
    message: String(raw.message || '').trim(),
    messageType: raw.messageType || 'text',
    isInternal: raw.isInternal === true,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    createdAt,
    readBy: raw.readBy && typeof raw.readBy === 'object' ? raw.readBy : {}
  };
}

function sortTicketsForUser(a, b) {
  return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
}

function sortTicketsForAgent(a, b) {
  const priorityOrder = { N1: 3, N2: 2, N3: 1 };
  const aPriority = priorityOrder[a.priority] || 0;
  const bPriority = priorityOrder[b.priority] || 0;
  if (aPriority !== bPriority) return bPriority - aPriority;
  return sortTicketsForUser(a, b);
}

function filterTickets(tickets, { status, priority, category, userId, agent, isAgent }) {
  let next = Array.isArray(tickets) ? tickets.slice() : [];

  if (!isAgent && userId) {
    next = next.filter((ticket) => String(ticket.userId || '') === String(userId));
  }

  if (status) next = next.filter((ticket) => ticket.status === status);
  if (priority) next = next.filter((ticket) => ticket.priority === priority);
  if (category) next = next.filter((ticket) => ticket.category === category);
  if (agent) next = next.filter((ticket) => String(ticket.assignedAgent || '') === String(agent));

  next.sort(isAgent ? sortTicketsForAgent : sortTicketsForUser);
  return next;
}

async function chunkedBatchWrite(items, writer) {
  const firestore = getFirestoreOrThrow();
  for (let index = 0; index < items.length; index += 400) {
    const batch = firestore.batch();
    const slice = items.slice(index, index + 400);
    slice.forEach((item) => writer(batch, item));
    await batch.commit();
  }
}

class SupportTicketService {
  constructor() {
    this.firestore = null;
    this.legacyRepository = null;
  }

  getFirestore() {
    if (!this.firestore) this.firestore = getFirestoreOrThrow();
    return this.firestore;
  }

  getLegacyRepository() {
    if (!this.legacyRepository) {
      this.legacyRepository = new SupportLegacyRtdbRepository(getLegacyDb(), {
        ticketsPath: LEGACY_TICKETS_PATH,
        messagesPath: LEGACY_MESSAGES_PATH
      });
    }
    return this.legacyRepository;
  }

  ticketDoc(ticketId) {
    return this.getFirestore().collection(TICKETS_COLLECTION).doc(String(ticketId));
  }

  ticketMessagesCollection(ticketId) {
    return this.ticketDoc(ticketId).collection(MESSAGES_SUBCOLLECTION);
  }

  async importLegacyTicket(ticketId, { includeMessages = true } = {}) {
    if (!LEGACY_IMPORT_ENABLED) return null;
    const legacyRepository = this.getLegacyRepository();
    if (!legacyRepository.isAvailable()) return null;

    const rawTicket = await legacyRepository.getTicket(ticketId);
    if (!rawTicket) return null;
    const ticket = normalizeTicket(ticketId, { ...rawTicket, source: 'rtdb_migrated' });

    await this.ticketDoc(ticketId).set({
      ...ticket,
      migratedFrom: 'rtdb',
      migratedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (includeMessages) {
      const rawMessages = await legacyRepository.getMessages(ticketId);
      const normalizedMessages = Object.entries(rawMessages).map(([messageId, value]) =>
        normalizeMessage(ticketId, messageId, value)
      );

      await chunkedBatchWrite(normalizedMessages, (batch, message) => {
        batch.set(
          this.ticketMessagesCollection(ticketId).doc(message.id),
          {
            ...message,
            migratedFrom: 'rtdb',
            migratedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });
    }

    logStructured('info', 'Support ticket legado migrado sob demanda', {
      service: 'support-ticket-service',
      ticketId
    });

    return ticket;
  }

  async importLegacyTicketsForQuery({ userId, isAgent, status, priority, category, agent }) {
    if (!LEGACY_IMPORT_ENABLED) return [];
    const legacyRepository = this.getLegacyRepository();
    if (!legacyRepository.isAvailable()) return [];

    const rawTickets = !isAgent && userId
      ? await legacyRepository.listTicketsByUser(userId)
      : await legacyRepository.listTickets();
    const filtered = filterTickets(
      Object.entries(rawTickets).map(([ticketId, value]) =>
        normalizeTicket(ticketId, { ...value, source: 'rtdb_migrated' })
      ),
      { status, priority, category, userId, agent, isAgent }
    );

    if (filtered.length === 0) return [];

    await chunkedBatchWrite(filtered, (batch, ticket) => {
      batch.set(
        this.ticketDoc(ticket.id),
        {
          ...ticket,
          migratedFrom: 'rtdb',
          migratedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    return filtered;
  }

  async listTicketsByStatuses(statuses = [], {
    priority,
    category,
    limit = 50,
    offset = 0,
    agent = null,
    isAgent = true
  } = {}) {
    const safeStatuses = Array.isArray(statuses)
      ? statuses.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    if (safeStatuses.length === 0) {
      return { tickets: [], total: 0, hasMore: false };
    }

    const snapshot = safeStatuses.length <= 10
      ? await this.getFirestore()
        .collection(TICKETS_COLLECTION)
        .where('status', 'in', safeStatuses)
        .get()
      : await this.getFirestore().collection(TICKETS_COLLECTION).get();

    let tickets = snapshot.docs.map((doc) => normalizeTicket(doc.id, doc.data()));
    tickets = filterTickets(tickets, {
      status: null,
      priority,
      category,
      agent,
      isAgent
    }).filter((ticket) => safeStatuses.includes(String(ticket.status || '')));

    const numericOffset = Number.parseInt(offset, 10) || 0;
    const numericLimit = Number.parseInt(limit, 10) || 50;
    return {
      tickets: tickets.slice(numericOffset, numericOffset + numericLimit),
      total: tickets.length,
      hasMore: numericOffset + numericLimit < tickets.length
    };
  }

  async listTickets({ status, priority, category, limit = 50, offset = 0, userId = null, agent = null, isAgent = false } = {}) {
    let snapshot;
    if (!isAgent && userId) {
      snapshot = await this.getFirestore()
        .collection(TICKETS_COLLECTION)
        .where('userId', '==', String(userId))
        .get();
    } else {
      snapshot = await this.getFirestore().collection(TICKETS_COLLECTION).get();
    }

    let tickets = snapshot.docs.map((doc) => normalizeTicket(doc.id, doc.data()));
    tickets = filterTickets(tickets, { status, priority, category, userId, agent, isAgent });

    if (tickets.length === 0) {
      const imported = await this.importLegacyTicketsForQuery({ status, priority, category, userId, agent, isAgent });
      if (imported.length > 0) {
        tickets = imported;
      }
    }

    const numericOffset = Number.parseInt(offset, 10) || 0;
    const numericLimit = Number.parseInt(limit, 10) || 50;
    return {
      tickets: tickets.slice(numericOffset, numericOffset + numericLimit),
      total: tickets.length,
      hasMore: numericOffset + numericLimit < tickets.length
    };
  }

  async getTicket(ticketId) {
    const doc = await this.ticketDoc(ticketId).get();
    if (doc.exists) {
      return normalizeTicket(doc.id, doc.data());
    }

    const imported = await this.importLegacyTicket(ticketId, { includeMessages: false });
    if (imported) return imported;
    return null;
  }

  async listMessages(ticketId, { importLegacy = true } = {}) {
    let snapshot = await this.ticketMessagesCollection(ticketId).get();
    let messages = snapshot.docs.map((doc) => normalizeMessage(ticketId, doc.id, doc.data()));
    messages.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

    if (messages.length === 0 && importLegacy) {
      const imported = await this.importLegacyTicket(ticketId, { includeMessages: true });
      if (imported) {
        snapshot = await this.ticketMessagesCollection(ticketId).get();
        messages = snapshot.docs.map((doc) => normalizeMessage(ticketId, doc.id, doc.data()));
        messages.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
      }
    }

    return messages;
  }

  async mirrorLegacyTicket(ticket) {
    if (!LEGACY_MIRROR_ENABLED) return;
    const legacyRepository = this.getLegacyRepository();
    await legacyRepository.updateTicket(ticket.id, ticket);
  }

  async mirrorLegacyMessage(ticketId, message) {
    if (!LEGACY_MIRROR_ENABLED) return;
    const legacyRepository = this.getLegacyRepository();
    await legacyRepository.setMessage(ticketId, message.id, message);
  }

  async createTicket({
    subject,
    description,
    category = 'general',
    priority = 'N3',
    requesterId,
    userType = 'passenger',
    userInfo = {},
    metadata = {},
    ipAddress = null,
    userAgent = null
  }) {
    const ticketId = `TICKET-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date().toISOString();

    const ticket = normalizeTicket(ticketId, {
      userId: requesterId,
      userType,
      subject,
      description,
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
      userInfo,
      metadata,
      ipAddress,
      userAgent,
      source: 'firestore'
    });

    const initialMessage = normalizeMessage(ticketId, messageId, {
      senderId: requesterId,
      senderType: 'user',
      message: description,
      messageType: 'text',
      isInternal: false,
      attachments: [],
      createdAt: now,
      readBy: {
        [requesterId]: now
      }
    });

    const batch = this.getFirestore().batch();
    batch.set(this.ticketDoc(ticketId), ticket, { merge: true });
    batch.set(this.ticketMessagesCollection(ticketId).doc(messageId), initialMessage, { merge: true });
    await batch.commit();

    await Promise.all([
      this.mirrorLegacyTicket(ticket),
      this.mirrorLegacyMessage(ticketId, initialMessage)
    ]);

    return { ticket, initialMessage };
  }

  async addMessage(ticketId, {
    senderId,
    senderType,
    message,
    messageType = 'text',
    attachments = [],
    isInternal = false
  }) {
    let ticket = await this.getTicket(ticketId);
    if (!ticket) {
      throw new Error('Ticket não encontrado');
    }

    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date().toISOString();
    const newMessage = normalizeMessage(ticketId, messageId, {
      senderId,
      senderType,
      message,
      messageType,
      isInternal,
      attachments,
      createdAt: now,
      readBy: {
        [senderId]: now
      }
    });

    const ticketUpdates = { updatedAt: now };
    if (senderType === 'agent') {
      const currentQueue = ticket.metadata?.queue || {};
      const nextQueue = {
        ...currentQueue,
        ackedAt: currentQueue.ackedAt || now
      };
      if (isInternal !== true && !currentQueue.firstResponseAt) {
        nextQueue.firstResponseAt = now;
      }
      ticketUpdates.metadata = {
        ...(ticket.metadata || {}),
        queue: nextQueue
      };
    }

    const batch = this.getFirestore().batch();
    batch.set(this.ticketMessagesCollection(ticketId).doc(messageId), newMessage, { merge: true });
    batch.set(this.ticketDoc(ticketId), ticketUpdates, { merge: true });
    await batch.commit();

    ticket = {
      ...ticket,
      updatedAt: now
    };

    await Promise.all([
      this.mirrorLegacyMessage(ticketId, newMessage),
      this.mirrorLegacyTicket(ticket)
    ]);

    return newMessage;
  }

  async assignTicket(ticketId, { agentId, agentName, actorId }) {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new Error('Ticket não encontrado');

    const now = new Date().toISOString();
    const updates = {
      assignedAgent: agentId,
      assignedTo: agentId,
      assignedAgentName: agentName,
      assignedAt: now,
      status: 'assigned',
      updatedAt: now
    };

    await this.ticketDoc(ticketId).set(updates, { merge: true });
    await this.mirrorLegacyTicket({ ...ticket, ...updates });

    return this.addMessage(ticketId, {
      senderId: actorId,
      senderType: 'agent',
      message: `Ticket atribuído ao agente ${agentName}`,
      messageType: 'system',
      isInternal: true
    });
  }

  async escalateTicket(ticketId, { reason, actorId }) {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new Error('Ticket não encontrado');

    const newLevel = Math.min(Number(ticket.escalationLevel || 1) + 1, 3);
    const now = new Date().toISOString();
    const escalationEntry = {
      level: newLevel,
      reason: String(reason || '').trim(),
      escalatedBy: actorId,
      escalatedAt: now
    };

    const updates = {
      escalationLevel: newLevel,
      status: 'escalated',
      assignedAgent: null,
      assignedTo: null,
      assignedAgentName: null,
      assignedAt: null,
      updatedAt: now,
      escalationHistory: [...(Array.isArray(ticket.escalationHistory) ? ticket.escalationHistory : []), escalationEntry]
    };

    await this.ticketDoc(ticketId).set(updates, { merge: true });
    await this.mirrorLegacyTicket({ ...ticket, ...updates });

    await this.addMessage(ticketId, {
      senderId: actorId,
      senderType: 'agent',
      message: `Ticket escalado para nível ${newLevel}. Motivo: ${String(reason || '').trim()}`,
      messageType: 'system',
      isInternal: true
    });

    return {
      escalationLevel: newLevel
    };
  }

  async resolveTicket(ticketId, { resolution = '', actorId }) {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new Error('Ticket não encontrado');

    const now = new Date().toISOString();
    const updates = {
      status: 'resolved',
      resolvedAt: now,
      updatedAt: now
    };

    await this.ticketDoc(ticketId).set(updates, { merge: true });
    await this.mirrorLegacyTicket({ ...ticket, ...updates });

    await this.addMessage(ticketId, {
      senderId: actorId,
      senderType: 'agent',
      message: resolution ? `Ticket resolvido. ${resolution}` : 'Ticket resolvido.',
      messageType: 'system',
      isInternal: false
    });

    return {
      resolvedAt: now
    };
  }

  async getAdminStats({ startDate = null, endDate = null } = {}) {
    const { tickets } = await this.listTickets({ isAgent: true, limit: 10000, offset: 0 });
    let filtered = tickets;

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      filtered = filtered.filter((ticket) => {
        const createdAt = new Date(ticket.createdAt || 0);
        return createdAt >= start && createdAt <= end;
      });
    }

    const resolved = filtered.filter((ticket) => ticket.resolvedAt);
    const averageResolutionTime = resolved.length === 0
      ? 0
      : Math.round(
        resolved.reduce((sum, ticket) => {
          const created = new Date(ticket.createdAt || 0);
          const resolvedAt = new Date(ticket.resolvedAt || 0);
          return sum + Math.max(0, resolvedAt.getTime() - created.getTime());
        }, 0) / resolved.length / (1000 * 60 * 60)
      );

    return {
      total: filtered.length,
      open: filtered.filter((ticket) => ticket.status === 'open').length,
      assigned: filtered.filter((ticket) => ticket.status === 'assigned').length,
      inProgress: filtered.filter((ticket) => ticket.status === 'in_progress').length,
      resolved: filtered.filter((ticket) => ticket.status === 'resolved').length,
      closed: filtered.filter((ticket) => ticket.status === 'closed').length,
      escalated: filtered.filter((ticket) => ticket.status === 'escalated').length,
      byPriority: {
        N1: filtered.filter((ticket) => ticket.priority === 'N1').length,
        N2: filtered.filter((ticket) => ticket.priority === 'N2').length,
        N3: filtered.filter((ticket) => ticket.priority === 'N3').length
      },
      byCategory: {
        technical: filtered.filter((ticket) => ticket.category === 'technical').length,
        payment: filtered.filter((ticket) => ticket.category === 'payment').length,
        account: filtered.filter((ticket) => ticket.category === 'account').length,
        general: filtered.filter((ticket) => ticket.category === 'general').length
      },
      averageResolutionTime
    };
  }

  async findLatestOpenTicketForUser(userId) {
    const result = await this.listTickets({ userId, isAgent: false, limit: 200, offset: 0 });
    const openTicket = result.tickets.find((ticket) => OPEN_TICKET_STATUSES.has(String(ticket.status || '').toLowerCase()));
    return openTicket || null;
  }
}

module.exports = new SupportTicketService();
