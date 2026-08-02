import authService from './AuthService';

async function request(endpoint, options = {}) {
  const response = await authService.authenticatedRequest(endpoint, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || 'Não foi possível atualizar seus veículos.');
    error.status = response.status;
    error.code = payload?.code || null;
    error.payload = payload;
    throw error;
  }
  return payload;
}

class MobileVehicleService {
  async listVehicles() {
    const payload = await request('/account/vehicles', { method: 'GET' });
    return Array.isArray(payload?.vehicles) ? payload.vehicles : [];
  }

  async addVehicle(vehicle) {
    const payload = await request('/account/vehicles', {
      method: 'POST',
      body: JSON.stringify({ vehicle }),
    });
    return payload?.vehicle || null;
  }

  async updateVehicle(vehicleId, vehicle) {
    const payload = await request(`/account/vehicles/${encodeURIComponent(vehicleId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ vehicle }),
    });
    return payload?.vehicle || null;
  }

  async selectVehicle(vehicleId) {
    const payload = await request(`/account/vehicles/${encodeURIComponent(vehicleId)}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active: true }),
    });
    return payload?.activeVehicleId || vehicleId;
  }

  async removeVehicle(vehicleId) {
    await request(`/account/vehicles/${encodeURIComponent(vehicleId)}`, { method: 'DELETE' });
    return true;
  }
}

export default new MobileVehicleService();
