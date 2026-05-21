const logger = require("../utils/logger");

const CONTRACT_VERSION = "support-orchestrator.v1";

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
