export class GeofenceApiClient {
  constructor({ request }) {
    this.request = request;
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

  async createGeofenceCity(payload = {}) {
    return this.request("/geofence/admin/cities", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

export default GeofenceApiClient;
