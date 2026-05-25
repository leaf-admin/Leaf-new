const logger = require("../utils/logger");

const CONTRACT_VERSION = "support-orchestrator.v1";
const ALLOWED_APPROVED_ACTIONS = new Set(["internal_note", "escalate_ticket"]);

function normalizeApprovedAction(action) {
  const normalized = String(action || "").trim().toLowerCase();
  if (["note", "internal-note", "internal_note", "add_internal_note"].includes(normalized)) {
    return "internal_note";
  }
  if (["escalate", "escalate-ticket", "escalate_ticket", "route_to_specialist"].includes(normalized)) {
    return "escalate_ticket";
  }
  return normalized;
}

function requireText(value, field) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error(`${field}_required`);
    error.status = 400;
    throw error;
  }
  return text;
}

class SupportOrchestrator {
  constructor({
    config,
    leafApiClient,
    playbookStore,
    classifier,
    n1Agent,
    n2Router,
    n3Diagnostics,
    store,
  }) {
    this.config = config;
    this.leafApiClient = leafApiClient;
    this.playbookStore = playbookStore;
    this.classifier = classifier;
    this.n1Agent = n1Agent;
    this.n2Router = n2Router;
    this.n3Diagnostics = n3Diagnostics;
    this.store = store;
    this.pollTimer = null;
    this.lastPollAt = null;
    this.lastPollError = null;
  }

  status() {
    return {
      service: this.config.serviceName,
      env: this.config.env,
      mode: this.config.automation.autonomousMode ? "autonomous_guarded" : "copilot",
      playbook: this.playbookStore.metadata(),
      polling: {
        enabled: this.config.polling.enabled,
        intervalMs: this.config.polling.intervalMs,
        lastPollAt: this.lastPollAt,
        lastPollError: this.lastPollError,
      },
      integrations: {
        leafApiBaseUrl: this.config.leaf.apiBaseUrl,
        redisSubscriber: this.config.redis.enabled,
        socketListener: this.config.socket.enabled,
      },
      storage: {
        durable: Boolean(this.config.storage?.path),
        pathConfigured: Boolean(this.config.storage?.path),
      },
      execution: {
        allowedApprovedActions: [...ALLOWED_APPROVED_ACTIONS],
        autoSend: false,
        autoResolve: false,
        requiresHumanApproval: true,
      },
    };
  }

  async analyzeTicket(ticketId, { force = false } = {}) {
    if (!force) {
      const cached = this.store.getLatestForTicket(ticketId);
      if (cached) return cached;
    }

    const ticketResponse = await this.leafApiClient.getTicket(ticketId);
    const ticket = ticketResponse?.ticket || ticketResponse?.data || ticketResponse || {};
    const messagesResponse = await this.leafApiClient.getTicketMessages(ticketId).catch(() => ({ messages: [] }));
    const messages = messagesResponse?.messages || [];
    const userId = ticket.userId || ticket.user?.id || null;
    const chatResponse = userId
      ? await this.leafApiClient.getChatHistory(userId, 25).catch(() => ({ messages: [] }))
      : { messages: [] };

    return this.buildRun({
      source: "ticket",
      ticket,
      messages,
      chatMessages: chatResponse?.messages || [],
    });
  }

  analyzeChat({ userId, messages = [], ticket = {} }) {
    return this.buildRun({
      source: "chat",
      ticket: {
        ...ticket,
        userId: ticket.userId || userId,
      },
      messages: [],
      chatMessages: messages,
    });
  }

  buildRun({ source, ticket, messages, chatMessages }) {
    const classification = this.classifier.classify({ ticket, messages, chatMessages });
    const n1 = this.n1Agent.buildRecommendation({ classification, ticket, messages, chatMessages });
    const n2 = this.n2Router.recommend({ classification, ticket, messages, chatMessages });
    const n3 = this.n3Diagnostics.recommend({ classification, ticket, messages, chatMessages });
    const execution = this.buildExecutionPolicy({ classification, n1, n2, n3 });
    const run = this.store.saveRun({
      source,
      ticketId: ticket.id || ticket.ticketId || null,
      userId: ticket.userId || ticket.user?.id || null,
      classification,
      recommendation: {
        n1,
        n2,
        n3,
        nextAction: n3?.action || n2?.action || n1?.action || "review",
        execution,
      },
      audit: {
        contractVersion: CONTRACT_VERSION,
        playbookVersion: classification.playbookVersion,
        autonomousMode: this.config.automation.autonomousMode,
        mode: execution.mode,
        minConfidence: this.config.automation.minConfidence,
        internetSearchUsed: false,
        autoSend: false,
        autoResolve: false,
        requiresHumanApproval: true,
      },
    });
    logger.info("Support analysis completed", {
      runId: run.id,
      ticketId: run.ticketId,
      tier: classification.supportTier,
      category: classification.category,
      confidence: classification.confidence,
    });
    return run;
  }

  buildExecutionPolicy({ classification, n1, n2, n3 }) {
    const activeActions = [n1?.action, n2?.action, n3?.action].filter(Boolean);
    return {
      mode: this.config.automation.autonomousMode ? "guarded_copilot" : "copilot",
      canAutoReply: classification.canAutoReply === true,
      autoSend: false,
      autoResolve: false,
      requiresHumanApproval: true,
      activeActions,
      blockedActions: [
        "auto_send",
        "auto_resolve",
        "close_ticket",
        "external_mutation",
      ],
    };
  }

  async applyApprovedAction({
    runId,
    ticketId,
    action,
    approvedBy,
    message,
    reason,
    idempotencyKey,
  } = {}) {
    const approvedByText = requireText(approvedBy, "approvedBy");
    const normalizedAction = normalizeApprovedAction(action);
    if (!ALLOWED_APPROVED_ACTIONS.has(normalizedAction)) {
      const error = new Error("approved_action_not_allowed");
      error.status = 400;
      error.details = {
        allowedActions: [...ALLOWED_APPROVED_ACTIONS],
      };
      throw error;
    }

    const run =
      (runId ? this.store.getRun(runId) : null) ||
      (ticketId ? this.store.getLatestForTicket(ticketId) : null);
    if (!run) {
      const error = new Error("orchestrator_run_not_found");
      error.status = 404;
      throw error;
    }

    const resolvedTicketId = run.ticketId || ticketId;
    if (!resolvedTicketId) {
      const error = new Error("ticketId_required");
      error.status = 400;
      throw error;
    }

    const key = idempotencyKey || `${run.id}:${normalizedAction}:${approvedByText}`;
    const existing = this.store.getActionByIdempotencyKey(key);
    if (existing && ["executing", "succeeded"].includes(existing.status)) {
      return { action: existing, idempotent: true };
    }

    const actionRecord = this.store.saveAction({
      runId: run.id,
      ticketId: resolvedTicketId,
      type: normalizedAction,
      status: "executing",
      approvedBy: approvedByText,
      idempotencyKey: key,
      contractVersion: CONTRACT_VERSION,
      playbookVersion: run.classification?.playbookVersion || run.audit?.playbookVersion || null,
      input: {
        message: message ? String(message).trim() : "",
        reason: reason ? String(reason).trim() : "",
      },
      guardrails: {
        humanApproved: true,
        autoSend: false,
        autoResolve: false,
        externalCustomerMessage: false,
      },
    });

    try {
      let result;
      if (normalizedAction === "internal_note") {
        const note = requireText(message, "message");
        result = await this.leafApiClient.sendTicketMessage(resolvedTicketId, note, "internal_note");
      } else if (normalizedAction === "escalate_ticket") {
        const escalationReason = requireText(reason || message, "reason");
        result = await this.leafApiClient.escalateTicket(resolvedTicketId, escalationReason);
      }

      const updated = this.store.updateAction(actionRecord.id, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        result,
      });
      logger.info("Approved support action executed", {
        runId: run.id,
        ticketId: resolvedTicketId,
        action: normalizedAction,
        approvedBy: approvedByText,
      });
      return { action: updated, idempotent: false };
    } catch (error) {
      this.store.updateAction(actionRecord.id, {
        status: "failed",
        failedAt: new Date().toISOString(),
        error: error.message,
      });
      throw error;
    }
  }

  async pollBacklogOnce() {
    this.lastPollAt = new Date().toISOString();
    this.lastPollError = null;
    try {
      const response = await this.leafApiClient.getQueueBacklog({ limit: 10, offset: 0 });
      const tickets = response?.tickets || [];
      tickets.forEach((ticket) => {
        if (!ticket?.id || this.store.getLatestForTicket(ticket.id)) return;
        this.buildRun({ source: "polling", ticket, messages: [], chatMessages: [] });
      });
      return { analyzed: tickets.length };
    } catch (error) {
      this.lastPollError = error.message;
      logger.warn("Support backlog polling failed", { error: error.message });
      return { analyzed: 0, error: error.message };
    }
  }

  startPolling() {
    if (!this.config.polling.enabled || this.pollTimer) return;
    this.pollBacklogOnce();
    this.pollTimer = setInterval(() => this.pollBacklogOnce(), this.config.polling.intervalMs);
  }

  stopPolling() {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async handleRealtimeChat(payload) {
    try {
      const userId = payload.userId || payload.senderId || payload.user?.id;
      if (!userId) return null;
      const history = await this.leafApiClient.getChatHistory(userId, 25).catch(() => ({ messages: [payload] }));
      return this.analyzeChat({ userId, messages: history?.messages || [payload] });
    } catch (error) {
      logger.warn("Realtime chat analysis failed", { error: error.message });
      return null;
    }
  }
}

module.exports = SupportOrchestrator;
