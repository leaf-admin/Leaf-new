import Logger from '../utils/Logger';
import authService from './AuthService';

class MobileProfileService {
  async requestProfile(endpoint = '/account/profile', options = {}) {
    const response = await authService.authenticatedRequest(endpoint, options);
    const rawBody = await response.text();

    let payload = {};
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch (parseError) {
        Logger.warn('⚠️ MobileProfileService - resposta não JSON:', parseError?.message || parseError);
      }
    }

    if (!response.ok) {
      const error = new Error(
        payload?.message || payload?.error || `Erro ${response.status} ao consultar perfil`
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async getCurrentProfile(options = {}) {
    const { suppressErrors = false, timeoutMs = 5000 } = options;

    try {
      const payload = await this.requestProfile('/account/profile', {
        method: 'GET',
        timeoutMs,
      });
      return payload?.profile || null;
    } catch (error) {
      if (error?.status === 404) {
        return null;
      }

      if (!suppressErrors) {
        Logger.error('❌ MobileProfileService - erro ao obter perfil atual:', error);
      }
      return null;
    }
  }

  async getCurrentProfileOrThrow(options = {}) {
    const payload = await this.requestProfile('/account/profile', {
      method: 'GET',
      timeoutMs: options.timeoutMs || 8000,
    });
    return payload?.profile || null;
  }

  async upsertCurrentProfile(profile) {
    try {
      const payload = await this.requestProfile('/account/profile', {
        method: 'PUT',
        body: JSON.stringify({ profile })
      });
      return payload?.profile || null;
    } catch (error) {
      Logger.error('❌ MobileProfileService - erro ao atualizar perfil atual:', error);
      return null;
    }
  }


  async upsertCurrentProfileOrThrow(profile) {
    const payload = await this.requestProfile('/account/profile', {
      method: 'PUT',
      body: JSON.stringify({ profile }),
    });
    return payload?.profile || null;
  }
}

export default new MobileProfileService();
