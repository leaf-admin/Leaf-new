import config from "@/src/config";
import { authService } from "@/src/services/auth-service";

class LeafApiService {
  constructor() {
    this.baseURL = config.api.baseUrl;
    this.timeoutMs = config.api.timeoutMs;
  }

  async request(endpoint, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      };
      const token = authService.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      let response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (response.status === 401 && token) {
        const renewed = await authService.refreshToken();
        if (renewed) {
          headers.Authorization = `Bearer ${renewed}`;
          response = await fetch(`${this.baseURL}${endpoint}`, {
            ...options,
            headers,
            signal: controller.signal,
          });
        }
      }

      if (!response.ok) {
        const err = new Error(`API Error ${response.status}`);
        err.status = response.status;
        throw err;
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDashboardSnapshot() {
    const [drivers, users, rides] = await Promise.all([
      this.request("/drivers/applications?page=1&limit=5").catch(() => ({ drivers: [] })),
      this.request("/users?page=1&limit=5").catch(() => ({ users: [] })),
      this.request("/metrics").catch(() => ({})),
    ]);

    return {
      drivers,
      users,
      rides,
    };
  }

  async getNewDrivers(period = "24h") {
    return this.request(`/users/new/drivers?period=${encodeURIComponent(period)}`);
  }

  async getNewCustomers(period = "24h") {
    return this.request(`/users/new/customers?period=${encodeURIComponent(period)}`);
  }

  async getRidesStats(period = "today") {
    return this.request(`/rides/stats?period=${encodeURIComponent(period)}`);
  }

  async getOperationalFeeStats(period = "today") {
    return this.request(`/metrics/operational-fee?period=${encodeURIComponent(period)}`);
  }

  async getSubscriptionRevenue(period = "30d") {
    return this.request(`/metrics/subscription-revenue?period=${encodeURIComponent(period)}`);
  }

  async getRevenueEvolution(days = 30) {
    return this.request(`/metrics/revenue-evolution?days=${encodeURIComponent(String(days))}`);
  }

  async getRecentActivity() {
    return this.request("/activity/recent");
  }

  async getMetricsOverview() {
    return this.request("/metrics/overview");
  }

  async getMetricsRidesDaily() {
    return this.request("/metrics/rides/daily");
  }

  async getMetricsFinancial() {
    return this.request("/metrics/financial/rides");
  }

  async getObservabilityMetrics() {
    return this.request("/metrics/observability");
  }

  async getDrivers(page = 1, limit = 20, status = "all", search = "") {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (status !== "all") params.append("status", status);
    if (search) params.append("search", search);
    return this.request(`/drivers/applications?${params.toString()}`);
  }

  async getUsers(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    return this.request(`/users?${query.toString()}`);
  }

  async getUserDetails(userId) {
    return this.request(`/users/${userId}`);
  }

  async getDriverComplete(driverId) {
    return this.request(`/drivers/${driverId}/complete`);
  }

  async getDriverDocuments(driverId) {
    return this.request(`/drivers/${driverId}/documents`);
  }

  async approveDriverApplication(driverId, notes = "") {
    return this.request(`/drivers/applications/${driverId}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes, adminNotes: notes }),
    });
  }

  async rejectDriverApplication(driverId, rejectionReasons = [], notes = "") {
    return this.request(`/drivers/applications/${driverId}/reject`, {
      method: "POST",
      body: JSON.stringify({ rejectionReasons, notes, adminNotes: notes }),
    });
  }

  async reviewDriverDocument(driverId, documentType, action, rejectionReason = "") {
    return this.request(`/drivers/${driverId}/documents/${documentType}/review`, {
      method: "POST",
      body: JSON.stringify({
        action,
        rejectionReason,
        reviewedBy: "admin",
      }),
    });
  }

  async getMetricsHistory(startDate, endDate, granularity = "hour") {
    const params = new URLSearchParams({
      startDate,
      endDate,
      granularity,
    });
    return this.request(`/metrics/history?${params.toString()}`);
  }

  async getMetricsHistoryCompare(period1Start, period1End, period2Start, period2End) {
    const params = new URLSearchParams({
      period1Start,
      period1End,
      period2Start,
      period2End,
    });
    return this.request(`/metrics/history/compare?${params.toString()}`);
  }

  async getReports() {
    return this.request("/reports/predefined");
  }

  async getMapLocations(type = "all", status, bounds) {
    const params = new URLSearchParams({ type });
    if (status) params.append("status", status);
    if (bounds) params.append("bounds", bounds);
    return this.request(`/map/locations?${params.toString()}`);
  }

  async getMapHeatmap(startDate, endDate) {
    const params = new URLSearchParams();
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    return this.request(`/map/heatmap?${params.toString()}`);
  }

  async getNotifications() {
    return this.request("/notifications");
  }

  async getNotificationStats() {
    const data = await this.request("/notifications");
    return data?.data?.stats || {};
  }

  async getWaitlist(page = 1, limit = 20, status = "pending") {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      status,
    });
    return this.request(`/waitlist/drivers?${params.toString()}`);
  }

  async getWaitlistStats() {
    return this.request("/metrics/waitlist/landing");
  }

  async runFinancialSimulation(drivers = 250, hours = 1) {
    const params = new URLSearchParams({
      drivers: String(drivers),
      hours: String(hours),
    });
    return this.request(`/metrics/simulation/run?${params.toString()}`);
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

  async getChatHistory(userId, limit = 50) {
    return this.request(`/support/chat/${userId}/history?limit=${limit}`);
  }

  async getChatStatus(userId) {
    return this.request(`/support/chat/${userId}/status`);
  }

  async sendChatMessage(userId, message) {
    return this.request(`/support/chat/${userId}/message`, {
      method: "POST",
      body: JSON.stringify({ message, senderType: "agent" }),
    });
  }

  async closeChat(userId, closedBy = "agent") {
    return this.request(`/support/chat/${userId}/close`, {
      method: "POST",
      body: JSON.stringify({ closedBy }),
    });
  }
}

export const leafAPI = new LeafApiService();
export default leafAPI;
