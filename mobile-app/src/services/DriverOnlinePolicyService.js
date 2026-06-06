import auth from '@react-native-firebase/auth';
import Logger from '../utils/Logger';
import { getSelfHostedApiUrl } from '../config/ApiConfig';

function normalizePolicyPayload(payload = {}) {
  const data = payload?.policy && typeof payload.policy === 'object'
    ? payload.policy
    : payload;
  const blockers = Array.isArray(data?.blockers) ? data.blockers : [];
  const primaryBlocker = blockers[0] || null;
  const code = String(
    data?.code ||
      primaryBlocker?.code ||
      ''
  ).trim();
  const message = String(
    data?.message ||
      primaryBlocker?.message ||
      'Não foi possível validar seu status online agora.'
  ).trim();
  const requiresLiveness =
    data?.requiresLiveness === true ||
    code === 'IDENTITY_VERIFICATION_REQUIRED' ||
    blockers.some((item) => item?.code === 'IDENTITY_VERIFICATION_REQUIRED');

  return {
    ...data,
    success: data?.success !== false,
    code,
    message,
    reason: message,
    error: data?.success === false ? message : null,
    blockers,
    kycRequired: requiresLiveness,
    requiresLiveness,
  };
}

class DriverOnlinePolicyService {
  async getAuthHeaders(forceRefresh = false) {
    const user = auth().currentUser;
    if (!user) {
      throw new Error('Usuário não autenticado');
    }

    const token = await user.getIdToken(Boolean(forceRefresh));
    if (!token) {
      throw new Error('Token de autenticação indisponível');
    }

    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  async requestPolicy(path, { method = 'GET', body = null, forceRefresh = false } = {}) {
    const headers = await this.getAuthHeaders(forceRefresh);
    const response = await fetch(getSelfHostedApiUrl(path), {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => null);
    const policy = normalizePolicyPayload(payload);

    if (!response.ok || payload?.success === false || policy.success === false) {
      return {
        ...policy,
        success: false,
        canGoOnline: false,
        httpStatus: response.status,
      };
    }

    return policy;
  }

  async getPolicy() {
    try {
      return await this.requestPolicy('/api/drivers/me/online-policy');
    } catch (error) {
      Logger.warn('⚠️ [DriverOnlinePolicy] Falha ao obter política:', error?.message || error);
      return {
        success: false,
        canGoOnline: false,
        code: 'ONLINE_POLICY_UNAVAILABLE',
        message: 'Não foi possível validar seu status online agora.',
        reason: 'Não foi possível validar seu status online agora.',
        blockers: [{
          code: 'ONLINE_POLICY_UNAVAILABLE',
          message: 'Não foi possível validar seu status online agora.',
        }],
      };
    }
  }

  async evaluateOnlineIntent({ requestedStatus = 'online', metadata = {} } = {}) {
    try {
      return await this.requestPolicy('/api/drivers/me/online-intent', {
        method: 'POST',
        body: {
          requestedStatus,
          metadata,
        },
      });
    } catch (error) {
      Logger.warn('⚠️ [DriverOnlinePolicy] Falha ao avaliar intent:', error?.message || error);
      return {
        success: false,
        canGoOnline: false,
        code: 'ONLINE_POLICY_UNAVAILABLE',
        message: 'Não foi possível validar seu status online agora.',
        reason: 'Não foi possível validar seu status online agora.',
        blockers: [{
          code: 'ONLINE_POLICY_UNAVAILABLE',
          message: 'Não foi possível validar seu status online agora.',
        }],
      };
    }
  }
}

const driverOnlinePolicyService = new DriverOnlinePolicyService();

export default driverOnlinePolicyService;
export { DriverOnlinePolicyService, normalizePolicyPayload };
