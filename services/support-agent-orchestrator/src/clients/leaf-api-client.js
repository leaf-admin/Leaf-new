class LeafApiClient {
  constructor({ baseUrl, token, timeoutMs = 12000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async request(endpoint, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options.headers || {}),
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => "");

      if (!response.ok) {
        const message =
          (payload && typeof payload === "object" && (payload.error || payload.message)) ||
          (typeof payload === "string" ? payload : "") ||
          `Leaf API error ${response.status}`;
        const err = new Error(message);
        err.status = response.status;
        err.payload = payload;
        throw err;
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  getQueueSummary() {
    return this.request("/support/queue/summary");
  }

  getQueueBacklog(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/support/queue/backlog${suffix ? `?${suffix}` : ""}`);
  }

  getTicket(ticketId) {
    return this.request(`/support/tickets/${encodeURIComponent(ticketId)}`);
  }

  getTicketMessages(ticketId) {
    return this.request(`/support/tickets/${encodeURIComponent(ticketId)}/messages`);
  }

  getChatHistory(userId, limit = 50) {
    return this.request(`/support/chat/${encodeURIComponent(userId)}/history?limit=${Number(limit) || 50}`);
  }

  sendTicketMessage(ticketId, message, messageType = "internal_note") {
    return this.request(`/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ message, messageType }),
    });
  }

  escalateTicket(ticketId, reason) {
    return this.request(`/support/admin/tickets/${encodeURIComponent(ticketId)}/escalate`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }
}

module.exports = LeafApiClient;
