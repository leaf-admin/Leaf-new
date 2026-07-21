export class SupportApiClient {
  constructor({ request }) {
    this.request = request;
  }

  async getSupportTickets(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.append("status", params.status);
    if (params.userId) query.append("userId", params.userId);
    if (params.page) {
      const limit = Number(params.limit || 100);
      const offset = (Number(params.page) - 1) * limit;
      query.append("offset", String(offset));
    }
    if (params.limit) query.append("limit", String(params.limit));
    if (params.priority) query.append("priority", params.priority);
    if (params.category) query.append("category", params.category);

    try {
      const response = await this.request(`/support/admin/tickets?${query.toString()}`);
      if (response && (response.tickets || response.success !== false)) return response;
      throw new Error("Resposta inválida da API");
    } catch {
      return this.request(`/support/tickets?${query.toString()}`);
    }
  }

  async getSupportQueueSummary() {
    return this.request("/support/queue/summary");
  }

  async getSupportQueueBacklog(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/support/queue/backlog${suffix ? `?${suffix}` : ""}`);
  }

  async assignSupportTicket(ticketId, agentId, agentName) {
    return this.request(`/support/admin/tickets/${ticketId}/assign`, {
      method: "POST",
      body: JSON.stringify({ agentId, agentName }),
    });
  }

  async escalateSupportTicket(ticketId, reason) {
    return this.request(`/support/admin/tickets/${ticketId}/escalate`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async resolveSupportTicket(ticketId, resolution = "") {
    return this.request(`/support/admin/tickets/${ticketId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution }),
    });
  }

  async getSupportMessages(ticketId) {
    return this.request(`/support/tickets/${ticketId}/messages`);
  }

  async sendSupportMessage(ticketId, message, messageType = "text", attachments = []) {
    return this.request(`/support/tickets/${ticketId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message, messageType, attachments }),
    });
  }

  async createSupportTicket(
    subject,
    description,
    category = "general",
    priority = "N3",
    userInfo = {},
    metadata = {},
  ) {
    return this.request("/support/tickets", {
      method: "POST",
      body: JSON.stringify({ subject, description, category, priority, userInfo, metadata }),
    });
  }

  async getChatHistory(userId, limit = 50, { includeArchived = true } = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (!includeArchived) params.set("includeArchived", "false");
    return this.request(`/support/chat/${userId}/history?${params.toString()}`);
  }

  async getSupportChatInbox({ limit = 50, includeClosed = false } = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (includeClosed) params.set("includeClosed", "true");
    return this.request(`/support/chat/inbox?${params.toString()}`);
  }

  async getChatStatus(userId) {
    return this.request(`/support/chat/${userId}/status`);
  }

  async markChatRead(userId, messageIds = []) {
    return this.request(`/support/chat/${userId}/mark-read`, {
      method: "POST",
      body: JSON.stringify({ messageIds }),
    });
  }

  async sendChatMessage(userId, message) {
    return this.request(`/support/chat/${userId}/message`, {
      method: "POST",
      body: JSON.stringify({ message, senderType: "agent" }),
    });
  }

  async convertChatToTicket(userId, payload = {}, options = {}) {
    const idempotencyKey = options.idempotencyKey || payload.idempotencyKey;
    const headers = idempotencyKey
      ? {
          "Idempotency-Key": idempotencyKey,
          "X-Idempotency-Key": idempotencyKey,
        }
      : undefined;
    return this.request(`/support/chat/${userId}/convert-ticket`, {
      method: "POST",
      headers,
      body: JSON.stringify(idempotencyKey ? { ...payload, idempotencyKey } : payload),
    });
  }

  async closeChat(userId, closedBy = "agent") {
    return this.request(`/support/chat/${userId}/close`, {
      method: "POST",
      body: JSON.stringify({ closedBy }),
    });
  }
}

export default SupportApiClient;
