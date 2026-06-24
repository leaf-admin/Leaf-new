const firebaseConfig = require('../firebase-config');
const supportTicketService = require('./support-ticket-service');
const { classifySupportTicketSeverity } = require('./support-severity-classifier');

const TICKETS_COLLECTION = 'support_tickets';
const DEFAULT_PRIORITY = 'N3';
const PRIORITY_SLA_MINUTES = {
  N1: { ack: 5, firstResponse: 10 },
  N2: { ack: 15, firstResponse: 30 },
  N3: { ack: 60, firstResponse: 240 }
};
const OPEN_STATUSES = new Set(['open', 'assigned', 'in_progress', 'escalated']);

function toIso(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const dt = value.toDate();
    return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
  }
  return fallback;
}

function resolveSla(priority = DEFAULT_PRIORITY) {
  return PRIORITY_SLA_MINUTES[String(priority || DEFAULT_PRIORITY).toUpperCase()] || PRIORITY_SLA_MINUTES[DEFAULT_PRIORITY];
}

function addMinutes(iso, minutes) {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) return null;
  return new Date(base + (minutes * 60 * 1000)).toISOString();
}

function priorityRank(priority) {
  if (priority === 'N1') return 3;
  if (priority === 'N2') return 2;
  return 1;
}

class SupportQueueService {
  constructor({ firebase = firebaseConfig, ticketService = supportTicketService } = {}) {
    this.firebase = firebase;
    this.ticketService = ticketService;
  }

  getFirestore() {
    return this.firebase?.getFirestore ? this.firebase.getFirestore() : null;
  }

  ticketDoc(ticketId) {
    const firestore = this.getFirestore();
    if (!firestore) return null;
    return firestore.collection(TICKETS_COLLECTION).doc(String(ticketId));
  }

  buildQueueMetadata(priority, createdAt) {
    const sla = resolveSla(priority);
    return {
      ackTargetAt: addMinutes(createdAt, sla.ack),
      firstResponseTargetAt: addMinutes(createdAt, sla.firstResponse),
      slaMinutes: sla
    };
  }

  async createSupportTicket({
    subject,
    description,
    category = 'general',
    priority = DEFAULT_PRIORITY,
    requesterId,
    userType = 'passenger',
    userInfo = {},
    metadata = {},
    requesterIsAgent = false,
    ipAddress = null,
    userAgent = null
  }) {
    const createdAt = new Date().toISOString();
    const classification = classifySupportTicketSeverity({
      subject,
      description,
      category,
      requestedPriority: priority,
      metadata,
      requesterIsAgent
    });
    const effectivePriority = classification.priority;
    const queue = this.buildQueueMetadata(effectivePriority, createdAt);
    const result = await this.ticketService.createTicket({
      subject,
      description,
      category,
      priority: effectivePriority,
      requesterId,
      userType,
      userInfo,
      metadata: {
        ...metadata,
        supportClassification: classification,
        queue
      },
      ipAddress,
      userAgent
    });

    return {
      ...result,
      queue
    };
  }

  async getTicketWithMessages(ticketId) {
    const ticket = await this.ticketService.getTicket(ticketId);
    if (!ticket) return null;
    const messages = await this.ticketService.listMessages(ticketId);
    return { ticket, messages };
  }

  deriveTicketState(ticket, messages = [], now = new Date()) {
    const createdAt = toIso(ticket.createdAt, new Date().toISOString());
    const queueMeta = ticket.metadata?.queue || {};
    const ackAt = toIso(ticket.assignedAt, null)
      || toIso(queueMeta.ackedAt, null)
      || toIso(
        messages.find((message) => message.senderType === 'agent')?.createdAt,
        null
      );
    const firstResponseMessage = messages.find((message) =>
      message.senderType === 'agent' && message.isInternal !== true
    );
    const firstResponseAt = toIso(queueMeta.firstResponseAt, null)
      || toIso(firstResponseMessage?.createdAt, null);
    const ackTargetAt = queueMeta.ackTargetAt || addMinutes(createdAt, resolveSla(ticket.priority).ack);
    const firstResponseTargetAt = queueMeta.firstResponseTargetAt || addMinutes(createdAt, resolveSla(ticket.priority).firstResponse);
    const nowMs = now.getTime();
    const ageMs = Math.max(0, nowMs - (Date.parse(createdAt) || nowMs));

    return {
      ...ticket,
      queue: {
        ackAt,
        ackTargetAt,
        firstResponseAt,
        firstResponseTargetAt,
        overdueAck: !ackAt && Boolean(ackTargetAt) && nowMs > Date.parse(ackTargetAt),
        overdueFirstResponse: !firstResponseAt && Boolean(firstResponseTargetAt) && nowMs > Date.parse(firstResponseTargetAt),
        ageMs,
        ageHours: Number((ageMs / 3600000).toFixed(2)),
        autoEscalationStage: ticket.metadata?.queue?.lastAutoEscalationStage || null
      }
    };
  }

  async decorateTicket(ticket, now = new Date(), { importLegacyMessages = false, loadMessages = false } = {}) {
    const messages = loadMessages
      ? await this.ticketService.listMessages(ticket.id, { importLegacy: importLegacyMessages })
      : [];
    return this.deriveTicketState(ticket, messages, now);
  }

  async markQueueMetadata(ticketId, patch = {}) {
    const docRef = this.ticketDoc(ticketId);
    if (!docRef) return null;

    const current = await this.ticketService.getTicket(ticketId);
    if (!current) return null;

    const nextMetadata = {
      ...(current.metadata || {}),
      queue: {
        ...(current.metadata?.queue || {}),
        ...patch
      }
    };

    await docRef.set({
      metadata: nextMetadata,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    return nextMetadata.queue;
  }

  async maybeAutoEscalateTicket(ticket) {
    if (!OPEN_STATUSES.has(String(ticket.status || '').toLowerCase())) {
      return ticket;
    }

    const stage = ticket.queue?.autoEscalationStage;
    if (ticket.queue?.overdueAck && stage !== 'ack') {
      await this.ticketService.escalateTicket(ticket.id, {
        reason: 'SLA de ack excedido',
        actorId: 'ops:auto_sla'
      });
      await this.markQueueMetadata(ticket.id, {
        lastAutoEscalationStage: 'ack',
        lastAutoEscalatedAt: new Date().toISOString()
      });
    } else if (ticket.queue?.overdueFirstResponse && stage !== 'first_response') {
      await this.ticketService.escalateTicket(ticket.id, {
        reason: 'SLA de primeira resposta excedido',
        actorId: 'ops:auto_sla'
      });
      await this.markQueueMetadata(ticket.id, {
        lastAutoEscalationStage: 'first_response',
        lastAutoEscalatedAt: new Date().toISOString()
      });
    } else if ((ticket.queue?.ageHours || 0) >= 12 && stage !== 'critical_backlog') {
      await this.ticketService.escalateTicket(ticket.id, {
        reason: 'Ticket entrou em backlog crítico (>12h)',
        actorId: 'ops:auto_sla'
      });
      await this.markQueueMetadata(ticket.id, {
        lastAutoEscalationStage: 'critical_backlog',
        lastAutoEscalatedAt: new Date().toISOString()
      });
    }

    return this.decorateTicket(await this.ticketService.getTicket(ticket.id));
  }

  async getBacklog({
    priority = null,
    status = null,
    autoEscalate = false,
    limit = 100,
    offset = 0
  } = {}) {
    const requestedStatus = status ? String(status) : null;
    const openStatuses = Array.from(OPEN_STATUSES);
    const shouldUseOpenQuery = !requestedStatus || OPEN_STATUSES.has(requestedStatus);
    const result = shouldUseOpenQuery && typeof this.ticketService.listTicketsByStatuses === 'function'
      ? await this.ticketService.listTicketsByStatuses(
        requestedStatus ? [requestedStatus] : openStatuses,
        {
          isAgent: true,
          limit: 1000,
          offset: 0,
          priority
        }
      )
      : await this.ticketService.listTickets({
        isAgent: true,
        limit: 1000,
        offset: 0,
        priority,
        status
      });

    let decorated = await Promise.all(result.tickets.map((ticket) => this.decorateTicket(ticket)));
    if (autoEscalate) {
      decorated = await Promise.all(decorated.map((ticket) => this.maybeAutoEscalateTicket(ticket)));
    }

    decorated.sort((left, right) => {
      const leftSeverity = Number(left.queue?.overdueFirstResponse || left.queue?.overdueAck);
      const rightSeverity = Number(right.queue?.overdueFirstResponse || right.queue?.overdueAck);
      if (leftSeverity !== rightSeverity) return rightSeverity - leftSeverity;
      const leftPriority = priorityRank(left.priority);
      const rightPriority = priorityRank(right.priority);
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
    });

    const numericOffset = Number.parseInt(offset, 10) || 0;
    const numericLimit = Number.parseInt(limit, 10) || 100;

    return {
      tickets: decorated.slice(numericOffset, numericOffset + numericLimit),
      total: decorated.length,
      hasMore: numericOffset + numericLimit < decorated.length
    };
  }

  async getQueueSummary({ autoEscalate = false } = {}) {
    const backlog = await this.getBacklog({ autoEscalate, limit: 500, offset: 0 });
    const tickets = backlog.tickets;
    const firstResponses = tickets
      .map((ticket) => {
        if (!ticket.queue?.firstResponseAt) return null;
        const created = Date.parse(ticket.createdAt || '');
        const firstResponse = Date.parse(ticket.queue.firstResponseAt || '');
        if (!Number.isFinite(created) || !Number.isFinite(firstResponse)) return null;
        return Math.max(0, firstResponse - created);
      })
      .filter((value) => Number.isFinite(value));

    const sortedResponseTimes = firstResponses.slice().sort((left, right) => left - right);
    const medianFirstResponseMs = sortedResponseTimes.length
      ? sortedResponseTimes[Math.floor(sortedResponseTimes.length / 2)]
      : null;

    return {
      totalOpenTickets: tickets.filter((ticket) => OPEN_STATUSES.has(String(ticket.status || '').toLowerCase())).length,
      backlogByPriority: {
        N1: tickets.filter((ticket) => ticket.priority === 'N1').length,
        N2: tickets.filter((ticket) => ticket.priority === 'N2').length,
        N3: tickets.filter((ticket) => ticket.priority === 'N3').length
      },
      overdueAckCount: tickets.filter((ticket) => ticket.queue?.overdueAck).length,
      overdueFirstResponseCount: tickets.filter((ticket) => ticket.queue?.overdueFirstResponse).length,
      ticketsWithoutOwner: tickets.filter((ticket) => !ticket.assignedAgent).length,
      criticalBacklogCount: tickets.filter((ticket) => (ticket.queue?.ageHours || 0) >= 12).length,
      medianFirstResponseMinutes: medianFirstResponseMs == null
        ? null
        : Number((medianFirstResponseMs / 60000).toFixed(2)),
      tickets
    };
  }

  async assignTicket(ticketId, { agentId, agentName, actorId }) {
    await this.ticketService.assignTicket(ticketId, { agentId, agentName, actorId });
    await this.markQueueMetadata(ticketId, {
      ackedAt: new Date().toISOString(),
      lastManualAction: 'assign'
    });
    return this.ticketService.getTicket(ticketId);
  }

  async escalateTicket(ticketId, { reason, actorId }) {
    const result = await this.ticketService.escalateTicket(ticketId, { reason, actorId });
    await this.markQueueMetadata(ticketId, {
      lastManualAction: 'escalate',
      lastEscalatedAt: new Date().toISOString()
    });
    return result;
  }

  async resolveTicket(ticketId, { resolution, actorId }) {
    const result = await this.ticketService.resolveTicket(ticketId, { resolution, actorId });
    await this.markQueueMetadata(ticketId, {
      resolvedAt: new Date().toISOString(),
      lastManualAction: 'resolve'
    });
    return result;
  }
}

const supportQueueService = new SupportQueueService();
module.exports = supportQueueService;
module.exports.SupportQueueService = SupportQueueService;
module.exports.resolveSla = resolveSla;
