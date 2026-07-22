import config from "@/src/config";
import { authService } from "@/src/services/auth-service";
import FinanceApiClient from "@/src/services/finance-api";
import GeofenceApiClient from "@/src/services/geofence-api";
import SupportApiClient from "@/src/services/support-api";

class LeafApiService {
  constructor() {
    this.baseURL = config.api.baseUrl;
    this.timeoutMs = config.api.timeoutMs;
    this.supportOrchestratorBaseURL = config.supportOrchestrator?.baseUrl || "";
    this.supportOrchestratorTimeoutMs = config.supportOrchestrator?.timeoutMs || this.timeoutMs;
    this.financeApi = new FinanceApiClient({ request: this.request.bind(this) });
    this.geofenceApi = new GeofenceApiClient({ request: this.request.bind(this) });
    this.supportApi = new SupportApiClient({ request: this.request.bind(this) });
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

  parseDownloadFilename(contentDisposition = "") {
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ""));
      } catch {
        return utf8Match[1].replace(/^"|"$/g, "");
      }
    }

    const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
    if (quotedMatch?.[1]) return quotedMatch[1];

    const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
    if (plainMatch?.[1]) return plainMatch[1].trim().replace(/^"|"$/g, "");

    return "";
  }

  async requestFile(endpoint, options = {}) {
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
      const headers = {
        Accept: "application/octet-stream",
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

      if (!response.ok) {
        const payload = contentType.includes("application/json")
          ? await response.json().catch(() => null)
          : await response.text().catch(() => "");
        const apiMessage =
          (payload && typeof payload === "object" && (payload.error || payload.message)) ||
          (typeof payload === "string" ? payload : "") ||
          `API Error ${response.status}`;
        const err = new Error(apiMessage);
        err.status = response.status;
        err.payload = payload;
        throw err;
      }

      return {
        blob: await response.blob(),
        contentType,
        filename: this.parseDownloadFilename(response.headers.get("content-disposition") || ""),
      };
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
      clearTimeout(timeout);
    }
  }

  buildReportFilename(reportId, format = "pdf") {
    const extension = format === "excel" ? "xlsx" : "pdf";
    const safeReportId = String(reportId || "report")
      .trim()
      .replace(/[^a-z0-9_.-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "report";
    return `${safeReportId}.${extension}`;
  }

  async downloadReport(reportId, format = "pdf", options = {}) {
    const normalizedFormat = String(format).toLowerCase() === "excel" ? "excel" : "pdf";
    const accept =
      normalizedFormat === "excel"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream"
        : "application/pdf,application/octet-stream";
    const file = await this.requestFile(
      `/reports/generate/${encodeURIComponent(reportId)}?format=${encodeURIComponent(normalizedFormat)}`,
      {
        ...options,
        headers: {
          Accept: accept,
          ...(options.headers || {}),
        },
      },
    );
    return {
      ...file,
      filename: file.filename || this.buildReportFilename(reportId, normalizedFormat),
    };
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

  async getH3VisualPolicy() {
    return this.request("/map/h3-visual-policy");
  }

  async updateH3VisualPolicy(policy = {}) {
    return this.request("/map/h3-visual-policy", {
      method: "PUT",
      body: JSON.stringify(policy),
    });
  }

  async getTollCatalog(options = {}) {
    const params = new URLSearchParams();
    if (options.refresh) params.set("refresh", "true");
    const suffix = params.toString();
    return this.request(`/pricing/toll-catalog${suffix ? `?${suffix}` : ""}`);
  }

  async updateTollCatalog(catalog = {}) {
    return this.request("/pricing/toll-catalog", {
      method: "PUT",
      body: JSON.stringify(catalog),
    });
  }

  async getAlerts(limit = 20) {
    return this.request(`/alerts?limit=${encodeURIComponent(limit)}`);
  }

  async getAlertStats() {
    return this.request("/alerts/stats");
  }

  async getDrivers(page = 1, limit = 20, status = "all", search = "", context = {}) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (status !== "all") params.append("status", status);
    if (search) params.append("search", search);
    return this.requestKyc(`/drivers/applications?${params.toString()}`, {}, context);
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

  async getDriverDocuments(driverId, context = {}) {
    return this.requestKyc(`/drivers/${driverId}/documents`, {}, context);
  }

  async getDriverDocumentFile(driverId, documentType, context = {}) {
    return this.requestKycFile(
      `/drivers/${encodeURIComponent(driverId)}/documents/${encodeURIComponent(documentType)}/content`,
      {
        headers: {
          Accept: "application/pdf,image/*,application/octet-stream",
        },
      },
      context,
    );
  }

  resolveKycScope(context = {}) {
    const rawScope = typeof context === "string" ? context : context?.scope;
    const normalized = String(rawScope || "operational").trim().toLowerCase();
    if (normalized === "operational" || normalized === "sandbox") return normalized;
    throw new Error(`Escopo KYC inválido: ${normalized}`);
  }

  buildScopedKycRequest(endpoint, options = {}, context = {}) {
    const scope = this.resolveKycScope(context);
    if (scope !== "sandbox") return { endpoint, options };
    const separator = endpoint.includes("?") ? "&" : "?";
    return {
      endpoint: `${endpoint}${separator}scope=sandbox`,
      options: {
        ...options,
        headers: {
          ...(options.headers || {}),
          "X-Leaf-KYC-Scope": "sandbox",
        },
      },
    };
  }

  async requestKyc(endpoint, options = {}, context = {}) {
    const request = this.buildScopedKycRequest(endpoint, options, context);
    return this.request(request.endpoint, request.options);
  }

  async requestKycFile(endpoint, options = {}, context = {}) {
    const request = this.buildScopedKycRequest(endpoint, options, context);
    return this.requestFile(request.endpoint, request.options);
  }

  async getDriverKycIdentityReviews(driverId, context = {}) {
    return this.requestKyc(
      `/drivers/${encodeURIComponent(driverId)}/kyc/identity-reviews`,
      {},
      context,
    );
  }

  async authorizeDriverKycOrphanHoldRecovery(driverId, payload = {}, context = {}) {
    return this.requestKyc(
      `/drivers/${encodeURIComponent(driverId)}/kyc/orphan-identity-hold/recovery`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      context,
    );
  }

  async reconcileDriverKycIdentityReview(driverId, payload = {}, context = {}) {
    return this.requestKyc(
      `/drivers/${encodeURIComponent(driverId)}/kyc/identity-reviews/reconcile`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      context,
    );
  }

  async getDriverKycIdentityEvidence(
    driverId,
    caseId,
    evidenceKind,
    { ticketId, justification, evidenceBindingHash, scope } = {},
  ) {
    return this.requestKycFile(
      `/drivers/${encodeURIComponent(driverId)}/kyc/identity-reviews/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceKind)}`,
      {
        method: "POST",
        headers: {
          Accept: "image/jpeg,image/png,application/octet-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticketId,
          reason: justification,
          evidenceBindingHash,
        }),
      },
      { scope },
    );
  }

  async startDriverKycIdentityReview(driverId, caseId, payload = {}, context = {}) {
    return this.requestKyc(
      `/drivers/${encodeURIComponent(driverId)}/kyc/identity-reviews/${encodeURIComponent(caseId)}/start`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      context,
    );
  }

  async decideDriverKycIdentityReview(driverId, caseId, payload = {}, context = {}) {
    return this.requestKyc(
      `/drivers/${encodeURIComponent(driverId)}/kyc/identity-reviews/${encodeURIComponent(caseId)}/decision`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      context,
    );
  }

  async getDriverDocumentReviewQueue(params = {}, context = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.requestKyc(
      `/drivers/documents/review-queue${suffix ? `?${suffix}` : ""}`,
      {},
      context,
    );
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

  async reviewDriverDocument(driverId, documentType, action, rejectionReason = "", context = {}) {
    return this.requestKyc(
      `/drivers/${driverId}/documents/${documentType}/review`,
      {
        method: "POST",
        body: JSON.stringify({
          action,
          rejectionReason,
          reviewedBy: "admin",
        }),
      },
      context,
    );
  }

  async uploadDriverDocument(driverId, documentType, file, context = {}) {
    const formData = new FormData();
    formData.append("file", file);
    return this.requestKyc(
      `/drivers/${driverId}/documents/${documentType}/upload`,
      {
        method: "POST",
        body: formData,
      },
      context,
    );
  }

  async requestDriverDocument(driverId, documentType, payload = {}, context = {}) {
    return this.requestKyc(`/drivers/${driverId}/documents/${documentType}/request`, {
      method: "POST",
      body: JSON.stringify(payload),
    }, context);
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
    return this.geofenceApi.getGeofenceAdminConfig();
  }

  async updateGeofenceConfig(payload = {}) {
    return this.geofenceApi.updateGeofenceConfig(payload);
  }

  async updateGeofenceState(stateCode, enabled) {
    return this.geofenceApi.updateGeofenceState(stateCode, enabled);
  }

  async updateGeofenceCity(stateCode, cityKey, payloadOrActive) {
    return this.geofenceApi.updateGeofenceCity(stateCode, cityKey, payloadOrActive);
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
    return this.geofenceApi.createGeofenceCity(payload);
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
    return this.financeApi.listFinancialReconciliationReports(params);
  }

  async getFinancialReconciliationRide(rideId) {
    return this.financeApi.getFinancialReconciliationRide(rideId);
  }

  async runFinancialReconciliation(payload = {}) {
    return this.financeApi.runFinancialReconciliation(payload);
  }

  async runFinancialReconciliationRide(rideId) {
    return this.financeApi.runFinancialReconciliationRide(rideId);
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

  async getSupportTickets(params = {}, context = {}) {
    const requestedScope = String(context?.scope || "operational").trim().toLowerCase();
    if (requestedScope !== "operational") {
      throw new Error("Chamados KYC só podem ser consultados no escopo operacional");
    }
    return this.supportApi.getSupportTickets(params);
  }

  async getSupportQueueSummary() {
    return this.supportApi.getSupportQueueSummary();
  }

  async getSupportQueueBacklog(params = {}) {
    return this.supportApi.getSupportQueueBacklog(params);
  }

  async assignSupportTicket(ticketId, agentId, agentName) {
    return this.supportApi.assignSupportTicket(ticketId, agentId, agentName);
  }

  async escalateSupportTicket(ticketId, reason) {
    return this.supportApi.escalateSupportTicket(ticketId, reason);
  }

  async resolveSupportTicket(ticketId, resolution = "") {
    return this.supportApi.resolveSupportTicket(ticketId, resolution);
  }

  async getSupportMessages(ticketId) {
    return this.supportApi.getSupportMessages(ticketId);
  }

  async sendSupportMessage(ticketId, message, messageType = "text", attachments = []) {
    return this.supportApi.sendSupportMessage(ticketId, message, messageType, attachments);
  }

  async createSupportTicket(
    subject,
    description,
    category = "general",
    priority = "N3",
    userInfo = {},
    metadata = {},
  ) {
    return this.supportApi.createSupportTicket(
      subject,
      description,
      category,
      priority,
      userInfo,
      metadata,
    );
  }

  async getChatHistory(userId, limit = 50, { includeArchived = true } = {}) {
    return this.supportApi.getChatHistory(userId, limit, { includeArchived });
  }

  async getSupportChatInbox({ limit = 50, includeClosed = false } = {}) {
    return this.supportApi.getSupportChatInbox({ limit, includeClosed });
  }

  async getChatStatus(userId) {
    return this.supportApi.getChatStatus(userId);
  }

  async markChatRead(userId, messageIds = []) {
    return this.supportApi.markChatRead(userId, messageIds);
  }

  async sendChatMessage(userId, message) {
    return this.supportApi.sendChatMessage(userId, message);
  }

  async convertChatToTicket(userId, payload = {}, options = {}) {
    return this.supportApi.convertChatToTicket(userId, payload, options);
  }

  async closeChat(userId, closedBy = "agent") {
    return this.supportApi.closeChat(userId, closedBy);
  }
}

export const leafAPI = new LeafApiService();
export default leafAPI;
