export class FinanceApiClient {
  constructor({ request }) {
    this.request = request;
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
}

export default FinanceApiClient;
