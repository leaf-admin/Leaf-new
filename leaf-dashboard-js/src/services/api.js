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
      const isFormData =
        typeof FormData !== "undefined" && options.body instanceof FormData;
      const headers = {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
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

      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => "");

      if (!response.ok) {
        const apiMessage =
          (payload && typeof payload === "object" && (payload.error || payload.message)) ||
          (typeof payload === "string" ? payload : "") ||
          `API Error ${response.status}`;
        const err = new Error(apiMessage);
        err.status = response.status;
        err.payload = payload;
        throw err;
      }

      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDashboardSnapshot() {
    const [drivers, users, rides] = await Promise.all([
      this.request("/drivers/applications?page=1&limit=5").catch(() => ({ drivers: [] })),
      this.request("/users?page=1&limit=5").catch(() => ({ users: [] })),
      this.request("/metrics/overview").catch(() => ({})),
    ]);

    return {
      drivers,
      users,
      rides,
    };
  }

  async getNewDrivers(period = "24h") {
    try {
      const data = await this.request(`/users?type=driver&page=1&limit=500`);
      const users = Array.isArray(data?.users) ? data.users : [];
      const now = Date.now();
      const periodMs =
        period === "24h" ? 24 * 60 * 60 * 1000 :
        period === "3d" ? 3 * 24 * 60 * 60 * 1000 :
        period === "week" ? 7 * 24 * 60 * 60 * 1000 :
        30 * 24 * 60 * 60 * 1000;

      const filtered = users.filter((u) => {
        if (!u?.registrationDate) return false;
        const ts = new Date(u.registrationDate).getTime();
        return Number.isFinite(ts) && now - ts <= periodMs;
      });

      return { users: filtered, count: filtered.length };
    } catch {
      return this.request("/users/stats").then((stats) => ({ users: [], count: Number(stats?.newToday || 0) }));
    }
  }

  async getNewCustomers(period = "24h") {
    try {
      const data = await this.request(`/users?type=customer&page=1&limit=500`);
      const users = Array.isArray(data?.users) ? data.users : [];
      const now = Date.now();
      const periodMs =
        period === "24h" ? 24 * 60 * 60 * 1000 :
        period === "3d" ? 3 * 24 * 60 * 60 * 1000 :
        period === "week" ? 7 * 24 * 60 * 60 * 1000 :
        30 * 24 * 60 * 60 * 1000;

      const filtered = users.filter((u) => {
        if (!u?.registrationDate) return false;
        const ts = new Date(u.registrationDate).getTime();
        return Number.isFinite(ts) && now - ts <= periodMs;
      });

      return { users: filtered, count: filtered.length };
    } catch {
      return this.request("/users/stats").then((stats) => ({ users: [], count: Number(stats?.newToday || 0) }));
    }
  }

  async getRidesStats(period = "today") {
    return this.request(`/rides/stats?period=${encodeURIComponent(period)}`);
  }

  async getOperationalFeeStats(period = "today") {
    return this.request(`/metrics/financial/operational-fee?period=${encodeURIComponent(period)}`);
  }

  async getSubscriptionRevenue(period = "30d") {
    const data = await this.request("/metrics/subscriptions/active");
    const multiplier = period === "7d" ? 1 : 4;
    const total = Number(data?.totalWeeklyRevenue || 0) * multiplier;
    return { revenue: { total }, raw: data };
  }

  async getRevenueEvolution(days = 30) {
    const end = new Date();
    const start = new Date(end.getTime() - Number(days) * 24 * 60 * 60 * 1000);
    const format = (d) => d.toISOString().split("T")[0];
    const response = await this.request(
      `/metrics/history?startDate=${encodeURIComponent(format(start))}&endDate=${encodeURIComponent(format(end))}&granularity=day`,
    );
    const rows = Array.isArray(response?.data) ? response.data : [];
    return rows.map((row) => ({
      date: row?.date,
      ridesRevenue: Number(row?.metrics?.revenue?.total || 0),
      operationalFee: 0,
      subscriptionRevenue: 0,
    }));
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

  async getMarketplaceMetrics(period = "month", startDate, endDate) {
    const params = new URLSearchParams({ period });
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    return this.request(`/metrics/marketplace?${params.toString()}`);
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

  async getDriverDocumentReviewQueue(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/drivers/documents/review-queue${suffix ? `?${suffix}` : ""}`);
  }

  async updateDriverVehicleConfig(driverId, payload = {}) {
    return this.request(`/drivers/${driverId}/vehicle/config`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
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

  async uploadDriverDocument(driverId, documentType, file) {
    const formData = new FormData();
    formData.append("file", file);
    return this.request(`/drivers/${driverId}/documents/${documentType}/upload`, {
      method: "POST",
      body: formData,
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

  async getGeofenceAdminConfig() {
    return this.request("/geofence/admin/config");
  }

  async updateGeofenceConfig(payload = {}) {
    return this.request("/geofence/admin/config", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async updateGeofenceState(stateCode, enabled) {
    return this.request(`/geofence/admin/states/${encodeURIComponent(stateCode)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: Boolean(enabled) }),
    });
  }

  async updateGeofenceCity(stateCode, cityKey, payloadOrActive) {
    const payload = (typeof payloadOrActive === "object" && payloadOrActive !== null)
      ? payloadOrActive
      : { active: Boolean(payloadOrActive) };
    return this.request(
      `/geofence/admin/cities/${encodeURIComponent(stateCode)}/${encodeURIComponent(cityKey)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  }

  async getReferralProgramsSummary() {
    return this.request("/programs/referrals/summary");
  }

  async getReferralProgramsConfig() {
    return this.request("/programs/referrals/config");
  }

  async updateReferralProgramsConfig(payload = {}) {
    return this.request("/programs/referrals/config", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async listReferralCampaigns() {
    return this.request("/programs/referrals/campaigns");
  }

  async createReferralCampaign(payload = {}) {
    return this.request("/programs/referrals/campaigns", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateReferralCampaign(campaignId, payload = {}) {
    return this.request(`/programs/referrals/campaigns/${encodeURIComponent(campaignId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async createGeofenceCity(payload = {}) {
    return this.request("/geofence/admin/cities", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getNotifications() {
    return this.request("/notifications");
  }

  async getNotificationStats() {
    const data = await this.request("/notifications");
    return data?.data?.stats || {};
  }

  async sendPushNotification(payload = {}) {
    return this.request("/notifications/send", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getSubscriptionsDrivers(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    return this.request(`/subscriptions/drivers?${query.toString()}`);
  }

  async updateDriverSubscription(driverId, payload = {}) {
    return this.request(`/drivers/${driverId}/subscription`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async extendDriverFreePeriod(driverId, payload = {}) {
    return this.request(`/drivers/${driverId}/extend-free`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async listPromotions(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    return this.request(`/promotions?${query.toString()}`);
  }

  async createPromotion(payload = {}) {
    return this.request("/promotions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updatePromotion(promotionId, payload = {}) {
    return this.request(`/promotions/${promotionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async getPromotionStats() {
    return this.request("/promotions/stats");
  }

  async applyPromotion(promotionId, driverId) {
    return this.request(`/promotions/${promotionId}/apply/${driverId}`, {
      method: "POST",
    });
  }

  async getWaitlist(page = 1, limit = 20, status = "pending", city = "") {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      status,
    });
    if (city) params.append("city", city);
    return this.request(`/waitlist/drivers?${params.toString()}`);
  }

  async getWaitlistStats() {
    return this.request("/waitlist/stats");
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
