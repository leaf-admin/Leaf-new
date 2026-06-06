import config from "@/src/config";
import { authService } from "@/src/services/auth-service";

class LeafApiService {
  constructor() {
    this.baseURL = config.api.baseUrl;
    this.timeoutMs = config.api.timeoutMs;
    this.supportOrchestratorBaseURL = config.supportOrchestrator?.baseUrl || "";
    this.supportOrchestratorTimeoutMs = config.supportOrchestrator?.timeoutMs || this.timeoutMs;
  }

  async request(endpoint, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const externalSignal = options.signal;
    const abortFromExternal = () => controller.abort();

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", abortFromExternal, { once: true });
      }
    }

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
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
      clearTimeout(timeout);
    }
  }

  isSupportOrchestratorEnabled() {
    return Boolean(this.supportOrchestratorBaseURL);
  }

  async requestSupportOrchestrator(endpoint, options = {}) {
    if (!this.supportOrchestratorBaseURL) {
      throw new Error("Orquestrador de suporte nao configurado");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.supportOrchestratorTimeoutMs);
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    const token = authService.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      let response = await fetch(`${this.supportOrchestratorBaseURL}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (response.status === 401 && token) {
        const renewed = await authService.refreshToken();
        if (renewed) {
          headers.Authorization = `Bearer ${renewed}`;
          response = await fetch(`${this.supportOrchestratorBaseURL}${endpoint}`, {
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
          `Support Orchestrator Error ${response.status}`;
        const err = new Error(apiMessage);
        err.status = response.status;
        err.payload = payload;
        throw err;
      }

      return payload;
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error("Copiloto de suporte indisponivel: tempo de conexao esgotado. O atendimento manual continua disponivel.");
      }
      if (err instanceof TypeError) {
        throw new Error("Copiloto de suporte indisponivel: falha de conexao. O atendimento manual continua disponivel.");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getSupportOrchestratorStatus() {
    return this.requestSupportOrchestrator("/v1/status");
  }

  async getSupportOrchestratorRuns(limit = 8) {
    return this.requestSupportOrchestrator(`/v1/runs?limit=${Number(limit) || 8}`);
  }

  async getSupportOrchestratorTicketAnalysis(ticketId, { force = false } = {}) {
    const encoded = encodeURIComponent(ticketId);
    if (force) {
      return this.requestSupportOrchestrator(`/v1/tickets/${encoded}/analyze`, { method: "POST" });
    }
    return this.requestSupportOrchestrator(`/v1/tickets/${encoded}/analysis`);
  }

  async applySupportOrchestratorAction(runId, payload = {}, options = {}) {
    const encoded = encodeURIComponent(runId);
    const idempotencyKey = options.idempotencyKey || payload.idempotencyKey;
    const headers = idempotencyKey
      ? {
          "Idempotency-Key": idempotencyKey,
          "X-Idempotency-Key": idempotencyKey,
        }
      : undefined;
    return this.requestSupportOrchestrator(`/v1/runs/${encoded}/actions`, {
      method: "POST",
      headers,
      body: JSON.stringify(idempotencyKey ? { ...payload, idempotencyKey } : payload),
    });
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

  async getUserStats(period = "24h") {
    return this.request(`/users/stats?period=${encodeURIComponent(period)}`);
  }

  async getNewDrivers(period = "24h") {
    const stats = await this.getUserStats(period);
    return { users: [], count: Number(stats?.period?.newDrivers ?? stats?.newDriversInPeriod ?? 0) };
  }

  async getNewCustomers(period = "24h") {
    const stats = await this.getUserStats(period);
    return { users: [], count: Number(stats?.period?.newCustomers ?? stats?.newCustomersInPeriod ?? 0) };
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

  async getSystemStatus() {
    return this.request("/system/status");
  }

  async getMonitoringHealth() {
    return this.request("/monitoring/health");
  }

  async getOpsOverview(hours = 1) {
    return this.request(`/ops/overview?hours=${encodeURIComponent(hours)}`);
  }

  async getOpsAlerts(hours = 1) {
    return this.request(`/ops/alerts?hours=${encodeURIComponent(hours)}`);
  }

  async getCommandCenterSnapshot({ hours = 1, period = "today", forceRefresh = false } = {}) {
    const params = new URLSearchParams({
      hours: String(hours),
      period: String(period),
    });
    if (forceRefresh) params.append("forceRefresh", "true");
    return this.request(`/ops/command-center?${params.toString()}`);
  }

  async getWorkerHealth() {
    return this.request("/workers/health");
  }

  async getWorkerLag() {
    return this.request("/workers/lag");
  }

  async getWorkerDLQ() {
    return this.request("/workers/dlq");
  }

  async getWorkerDLQEvents(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/workers/dlq/events${suffix ? `?${suffix}` : ""}`);
  }

  async getRuntimeFlags() {
    return this.request("/health/runtime-flags");
  }

  async getAlerts(limit = 20) {
    return this.request(`/alerts?limit=${encodeURIComponent(limit)}`);
  }

  async getAlertStats() {
    return this.request("/alerts/stats");
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

  async updateUserOperationalStatus(userId, payload = {}) {
    return this.request(`/users/${userId}/status`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
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

  async requestDriverDocument(driverId, documentType, payload = {}) {
    return this.request(`/drivers/${driverId}/documents/${documentType}/request`, {
      method: "POST",
      body: JSON.stringify(payload),
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

  async getMapH3Cells(params = {}, options = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    return this.request(`/map/h3-cells?${query.toString()}`, options);
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

  async listInAppCampaigns(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/campaign-center/campaigns${suffix ? `?${suffix}` : ""}`);
  }

  async createInAppCampaign(payload = {}) {
    return this.request("/campaign-center/campaigns", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async uploadInAppCampaignAsset(file) {
    const formData = new FormData();
    formData.append("file", file);
    return this.request("/campaign-center/assets", {
      method: "POST",
      body: formData,
    });
  }

  async updateInAppCampaign(campaignId, payload = {}) {
    return this.request(`/campaign-center/campaigns/${encodeURIComponent(campaignId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async previewInAppCampaign(campaignId, payload = {}) {
    return this.request(`/campaign-center/campaigns/${encodeURIComponent(campaignId)}/preview-eligibility`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getInAppCampaignStats(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/campaign-center/stats${suffix ? `?${suffix}` : ""}`);
  }

  async getInAppCampaignCommercialReport(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/campaign-center/commercial-report${suffix ? `?${suffix}` : ""}`);
  }

  async listInAppCampaignSlots() {
    return this.request("/campaign-center/slots");
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

  async approveWaitlistDriver(driverId, notes = "") {
    return this.request("/waitlist/approve", {
      method: "POST",
      body: JSON.stringify({ driverId, notes }),
    });
  }

  async rejectWaitlistDriver(driverId, reason = "") {
    return this.request("/waitlist/reject", {
      method: "POST",
      body: JSON.stringify({ driverId, reason }),
    });
  }

  async updateWaitlistPosition(driverId, newPosition) {
    return this.request("/waitlist/position", {
      method: "PUT",
      body: JSON.stringify({ driverId, newPosition }),
    });
  }

  async getLandingWaitlist(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/waitlist/landing/list${suffix ? `?${suffix}` : ""}`);
  }

  async updateLandingWaitlistStatus(leadId, status, notes = "") {
    return this.request(`/waitlist/landing/${encodeURIComponent(leadId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, notes }),
    });
  }

  async deleteLandingWaitlistLead(leadId) {
    return this.request(`/waitlist/landing/${encodeURIComponent(leadId)}`, {
      method: "DELETE",
    });
  }

  async runFinancialSimulation(drivers = 250, hours = 1) {
    const params = new URLSearchParams({
      drivers: String(drivers),
      hours: String(hours),
    });
    return this.request(`/metrics/simulation/run?${params.toString()}`);
  }

  async listFinancialReconciliationReports(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/financial/reconciliation/reports${suffix ? `?${suffix}` : ""}`);
  }

  async getFinancialReconciliationRide(rideId) {
    return this.request(`/financial/reconciliation/rides/${encodeURIComponent(rideId)}`);
  }

  async runFinancialReconciliation(payload = {}) {
    return this.request("/financial/reconciliation/run", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async runFinancialReconciliationRide(rideId) {
    return this.request(`/financial/reconciliation/rides/${encodeURIComponent(rideId)}/run`, {
      method: "POST",
    });
  }

  async listPaymentRuntimeProfiles({ includeInactive = true } = {}) {
    const params = new URLSearchParams();
    params.set("includeInactive", includeInactive ? "true" : "false");
    return this.request(`/payment/runtime-profiles?${params.toString()}`);
  }

  async savePaymentRuntimeProfile(profile = {}) {
    return this.request("/payment/runtime-profiles", {
      method: "POST",
      body: JSON.stringify(profile),
    });
  }

  async updatePaymentRuntimeProfileStatus(profileId, status) {
    return this.request(`/payment/runtime-profiles/${encodeURIComponent(profileId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  async resolvePaymentRuntimeProfile(payload = {}) {
    return this.request("/payment/runtime-profiles/resolve", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getRuntimeConfigAdmin({ includeInactive = true, forceRefresh = false } = {}) {
    const params = new URLSearchParams();
    params.set("includeInactive", includeInactive ? "true" : "false");
    if (forceRefresh) params.set("forceRefresh", "true");
    return this.request(`/admin/runtime-config?${params.toString()}`);
  }

  async publishRuntimeConfigOverride(payload = {}) {
    return this.request("/admin/runtime-config/overrides", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateRuntimeConfigOverrideStatus(overrideId, status) {
    return this.request(`/admin/runtime-config/overrides/${encodeURIComponent(overrideId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  async rollbackRuntimeConfigOverride(overrideId, reason = "") {
    return this.request(`/admin/runtime-config/overrides/${encodeURIComponent(overrideId)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async listAuditLogs(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/audit/logs${suffix ? `?${suffix}` : ""}`);
  }

  async getAuditStats(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.request(`/audit/stats${suffix ? `?${suffix}` : ""}`);
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

export const leafAPI = new LeafApiService();
export default leafAPI;
