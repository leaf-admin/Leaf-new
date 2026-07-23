const firebaseConfig = require('../firebase-config');
const supportTicketService = require('./support-ticket-service');
const { classifySupportTicketSeverity } = require('./support-severity-classifier');
const { resolvePersistenceScope } = require('./sandbox-persistence-context');

const DEFAULT_PRIORITY = 'N3';
const PRIORITY_SLA_MINUTES = {
  N1: { ack: 5, firstResponse: 10 },
  N2: { ack: 15, firstResponse: 30 },
  N3: { ack: 60, firstResponse: 240 }
};
const OPEN_STATUSES = new Set(['open', 'assigned', 'in_progress', 'escalated']);
const AUTO_ESCALATION_STAGES = Object.freeze([
  {
    id: 'ack',
    reason: 'SLA de ack excedido',
    isBreached: (ticket) => ticket.queue?.overdueAck === true
  },
  {
    id: 'first_response',
    reason: 'SLA de primeira resposta excedido',
    isBreached: (ticket) => ticket.queue?.overdueFirstResponse === true
  },
  {
    id: 'critical_backlog',
    reason: 'Ticket entrou em backlog crítico (>12h)',
    isBreached: (ticket) => (ticket.queue?.ageHours || 0) >= 12
  }
]);

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

  ticketDoc(ticketId, persistenceContext = null) {
    const firestore = this.getFirestore();
    if (!firestore) return null;
    const scope = resolvePersistenceScope(persistenceContext || {}, {
      allowLegacyOperational: true,
      allowExplicitSandboxAccess: true
    });
    return firestore.collection(scope.collections.supportTickets).doc(String(ticketId));
  }

  autoEscalationStageDoc(ticketId, stage, persistenceContext = null) {
    const ticketRef = this.ticketDoc(ticketId, persistenceContext);
    if (!ticketRef || typeof ticketRef.collection !== 'function') return null;
    return ticketRef.collection('auto_escalations').doc(String(stage));
  }

  async claimAutoEscalationStage(ticketId, stage, persistenceContext = null) {
    const stageRef = this.autoEscalationStageDoc(ticketId, stage, persistenceContext);
    if (!stageRef || typeof stageRef.create !== 'function') {
      throw new Error('Store idempotente de autoescalação indisponível');
    }

    const claimedAt = new Date().toISOString();
    try {
      await stageRef.create({
        ticketId: String(ticketId),
        stage: String(stage),
        status: 'claimed',
        claimedAt,
        actorId: 'ops:auto_sla'
      });
      return { claimed: true, stageRef, claimedAt };
    } catch (error) {
      const code = String(error?.code || '').trim().toLowerCase();
      if (error?.code === 6 || code === 'already-exists' || code === '6') {
        return { claimed: false, stageRef, claimedAt: null };
      }
      throw error;
    }
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
    userAgent = null,
    persistenceContext = null
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
      userAgent,
      persistenceContext
    });

    return {
      ...result,
      queue
    };
  }

  async getTicketWithMessages(ticketId, persistenceContext = null) {
    const ticket = await this.ticketService.getTicket(ticketId, persistenceContext);
    if (!ticket) return null;
    const messages = await this.ticketService.listMessages(ticketId, { persistenceContext });
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

  async decorateTicket(ticket, now = new Date(), {
    importLegacyMessages = false,
    loadMessages = false,
    persistenceContext = null
  } = {}) {
    const messages = loadMessages
      ? await this.ticketService.listMessages(ticket.id, {
        importLegacy: importLegacyMessages,
        persistenceContext
      })
      : [];
    return this.deriveTicketState(ticket, messages, now);
  }

  async markQueueMetadata(ticketId, patch = {}, persistenceContext = null) {
    const current = await this.ticketService.getTicket(ticketId, persistenceContext);
    if (!current) return null;

    const nextMetadata = {
      ...(current.metadata || {}),
      queue: {
        ...(current.metadata?.queue || {}),
        ...patch
      }
    };

    if (typeof this.ticketService.updateTicketMetadata === 'function') {
      await this.ticketService.updateTicketMetadata(
        ticketId,
        { queue: nextMetadata.queue },
        persistenceContext
      );
    } else {
      const docRef = this.ticketDoc(ticketId, persistenceContext);
      if (!docRef || typeof docRef.set !== 'function') {
        throw new Error('Store de metadados da fila de suporte indisponível');
      }
      await docRef.set({ metadata: nextMetadata }, { merge: true });
    }

    return nextMetadata.queue;
  }

  async maybeAutoEscalateTicket(ticket, persistenceContext = null) {
    if (!OPEN_STATUSES.has(String(ticket.status || '').toLowerCase())) {
      return ticket;
    }

    const lastStageIndex = AUTO_ESCALATION_STAGES.findIndex(
      (candidate) => candidate.id === ticket.queue?.autoEscalationStage
    );
    const breachedStages = AUTO_ESCALATION_STAGES.filter(
      (candidate, index) => index > lastStageIndex && candidate.isBreached(ticket)
    );

    for (const candidate of breachedStages) {
      const claim = await this.claimAutoEscalationStage(ticket.id, candidate.id, persistenceContext);
      if (!claim.claimed) break;

      const escalationPayload = {
        reason: candidate.reason,
        actorId: 'ops:auto_sla'
      };
      if (persistenceContext) {
        await this.ticketService.escalateTicket(ticket.id, escalationPayload, persistenceContext);
      } else {
        await this.ticketService.escalateTicket(ticket.id, escalationPayload);
      }
      await this.markQueueMetadata(ticket.id, {
        lastAutoEscalationStage: candidate.id,
        lastAutoEscalatedAt: new Date().toISOString()
      }, persistenceContext);
      break;
    }

    const refreshed = persistenceContext
      ? await this.ticketService.getTicket(ticket.id, persistenceContext)
      : await this.ticketService.getTicket(ticket.id);
    return this.decorateTicket(refreshed, new Date(), { persistenceContext });
  }

  async getBacklog({
    priority = null,
    status = null,
    autoEscalate = false,
    limit = 100,
    offset = 0,
    persistenceContext = null
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
          priority,
          persistenceContext
        }
      )
      : await this.ticketService.listTickets({
        isAgent: true,
        limit: 1000,
        offset: 0,
        priority,
        status,
        persistenceContext
      });

    let decorated = await Promise.all(result.tickets.map((ticket) => this.decorateTicket(
      ticket,
      new Date(),
      { persistenceContext }
    )));
    if (autoEscalate) {
      decorated = await Promise.all(decorated.map((ticket) => (
        this.maybeAutoEscalateTicket(ticket, persistenceContext)
      )));
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

  async getQueueSummary({ autoEscalate = false, persistenceContext = null } = {}) {
    const backlog = await this.getBacklog({
      autoEscalate,
      limit: 500,
      offset: 0,
      persistenceContext
    });
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

  async assignTicket(ticketId, { agentId, agentName, actorId }, persistenceContext = null) {
    await this.ticketService.assignTicket(
      ticketId,
      { agentId, agentName, actorId },
      persistenceContext
    );
    await this.markQueueMetadata(ticketId, {
      ackedAt: new Date().toISOString(),
      lastManualAction: 'assign'
    }, persistenceContext);
    return this.ticketService.getTicket(ticketId, persistenceContext);
  }

  async escalateTicket(ticketId, { reason, actorId }, persistenceContext = null) {
    const result = await this.ticketService.escalateTicket(
      ticketId,
      { reason, actorId },
      persistenceContext
    );
    await this.markQueueMetadata(ticketId, {
      lastManualAction: 'escalate',
      lastEscalatedAt: new Date().toISOString()
    }, persistenceContext);
    return result;
  }

  async resolveTicket(ticketId, { resolution, actorId }, persistenceContext = null) {
    const result = await this.ticketService.resolveTicket(
      ticketId,
      { resolution, actorId },
      persistenceContext
    );
    await this.markQueueMetadata(ticketId, {
      resolvedAt: new Date().toISOString(),
      lastManualAction: 'resolve'
    }, persistenceContext);
    return result;
  }
}

const supportQueueService = new SupportQueueService();
module.exports = supportQueueService;
module.exports.SupportQueueService = SupportQueueService;
module.exports.resolveSla = resolveSla;
