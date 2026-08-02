import Logger from '../utils/Logger';
/**
 * 🔐 SERVIÇO DE AUTENTICAÇÃO DE USUÁRIOS
 * 
 * Gerencia verificação de usuários existentes, login com senha e reset de senha
 */

import auth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from './httpClient';


class UserAuthService {
  static resolveNextActionFromPayload(data = {}) {
    const rawNextAction = String(data?.nextAction || '').trim().toUpperCase();
    const hasPasswordConfigured =
      data?.hasPassword === true ||
      String(data?.hasPassword || '').trim().toLowerCase() === 'true' ||
      data?.passwordFallbackAvailable === true;

    if (rawNextAction === 'PASSWORD_LOGIN') {
      return hasPasswordConfigured ? 'PASSWORD_LOGIN' : 'OTP_REQUIRED';
    }
    if (rawNextAction === 'OTP_REQUIRED') {
      return 'OTP_REQUIRED';
    }

    // Servidores legados podem responder `requiresPassword=true` sem senha configurada.
    // Nessa situação forçamos OTP para evitar bloqueio indevido no login.
    if (!hasPasswordConfigured) {
      return 'OTP_REQUIRED';
    }

    // Compatibilidade com payload legado
    if (Boolean(data?.requiresPassword)) {
      return 'PASSWORD_LOGIN';
    }
    return 'OTP_REQUIRED';
  }

  static normalizePhone(phoneNumber) {
    const digits = String(phoneNumber || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
  }

  static async setupPassword(phoneNumber, password) {
    const normalizedPhone = this.normalizePhone(phoneNumber);
    const response = await apiClient.post('/api/auth/password/setup', {
      phone: normalizedPhone,
      password,
      confirmPassword: password
    });
    return response?.data || { success: false };
  }

  static async postCustomOtpWithFallback(pathSuffix, payload) {
    const endpoints = [
      `/api/custom-otp/${pathSuffix}`,
      `/custom-otp/${pathSuffix}`
    ];

    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        return await apiClient.post(endpoint, payload);
      } catch (error) {
        lastError = error;
        if (error?.response?.status !== 404) {
          throw error;
        }
      }
    }

    throw lastError || new Error(`Falha em ${pathSuffix}`);
  }

  static async resolvePhoneAuthFlow(phoneNumber) {
    const normalizedPhone = this.normalizePhone(phoneNumber);
    if (!normalizedPhone) {
      throw new Error('Telefone inválido');
    }

    const response = await apiClient.post('/api/auth/password/resolve-phone', {
      phone: normalizedPhone
    });
    const data = response?.data || {};
    if (!data.success) {
      throw new Error(data.error || 'Não foi possível validar o telefone');
    }

    const nextAction = this.resolveNextActionFromPayload(data);
    const requiresPassword = nextAction === 'PASSWORD_LOGIN';
    const passwordFallbackAvailable =
      data.passwordFallbackAvailable === undefined
        ? Boolean(data.hasPassword)
        : Boolean(data.passwordFallbackAvailable);

    return {
      phoneNumber: normalizedPhone,
      exists: Boolean(data.exists),
      hasPassword: Boolean(data.hasPassword),
      nextAction,
      passwordFallbackAvailable,
      requiresPassword,
      requiresOtp: !requiresPassword,
      uid: data.uid || null,
      userType: data.userType || null,
      source: data.source || null
    };
  }

  // ✅ Rate limiting: armazenar tentativas por telefone
  static async checkRateLimit(phoneNumber) {
    try {
      const key = `@rate_limit_${phoneNumber}`;
      const data = await AsyncStorage.getItem(key);

      if (data) {
        const { attempts, lastAttempt, blockedUntil } = JSON.parse(data);
        const now = Date.now();

        // Verificar se está bloqueado
        if (blockedUntil && now < blockedUntil) {
          const minutesLeft = Math.ceil((blockedUntil - now) / 60000);
          throw new Error(`Muitas tentativas. Tente novamente em ${minutesLeft} minuto(s).`);
        }

        // Resetar contador se passou 1 hora
        if (now - lastAttempt > 3600000) {
          await AsyncStorage.removeItem(key);
          return { allowed: true, attempts: 0 };
        }

        // Limite: 5 tentativas por hora
        if (attempts >= 5) {
          const blockUntil = now + 3600000; // Bloquear por 1 hora
          await AsyncStorage.setItem(key, JSON.stringify({
            attempts: attempts + 1,
            lastAttempt: now,
            blockedUntil: blockUntil
          }));
          throw new Error('Muitas tentativas. Aguarde 1 hora antes de tentar novamente.');
        }

        return { allowed: true, attempts };
      }

      return { allowed: true, attempts: 0 };
    } catch (error) {
      if (error.message.includes('Muitas tentativas')) {
        throw error;
      }
      return { allowed: true, attempts: 0 };
    }
  }

  // ✅ Registrar tentativa (sucesso ou falha)
  static async recordAttempt(phoneNumber, success = false) {
    try {
      const key = `@rate_limit_${phoneNumber}`;
      const data = await AsyncStorage.getItem(key);
      const now = Date.now();

      if (success) {
        // Sucesso: limpar contador
        await AsyncStorage.removeItem(key);
      } else {
        // Falha: incrementar contador
        const attempts = data ? JSON.parse(data).attempts + 1 : 1;
        await AsyncStorage.setItem(key, JSON.stringify({
          attempts,
          lastAttempt: now,
          blockedUntil: null
        }));
      }
    } catch (error) {
      Logger.warn('⚠️ Erro ao registrar tentativa:', error);
    }
  }

  /**
   * Verifica se um usuário existe no banco por número de telefone
   * @param {string} phoneNumber - Número de telefone (formato: +5511999999999)
   * @returns {Promise<Object|null>} - Dados do usuário se existir, null caso contrário
   */
  static async checkUserExistsByPhone(phoneNumber) {
    try {
      Logger.log('🔍 Resolvendo existência de usuário via backend:', phoneNumber);
      const resolution = await this.resolvePhoneAuthFlow(phoneNumber);
      if (!resolution.exists) {
        Logger.log('ℹ️ Usuário não encontrado para o telefone informado');
        return null;
      }

      return {
        uid: resolution.uid,
        userType: resolution.userType,
        hasPassword: resolution.hasPassword
      };
    } catch (error) {
      Logger.error('❌ Erro ao verificar usuário:', error);
      return null;
    }
  }

  /**
   * Autentica usuário com senha
   * @param {string} phoneNumber - Número de telefone
   * @param {string} password - Senha do usuário
   * @returns {Promise<Object>} - Dados do usuário autenticado
   */
  static async loginWithPassword(phoneNumber, password) {
    try {
      // Verificar rate limit
      await this.checkRateLimit(phoneNumber);

      const response = await apiClient.post('/api/auth/password/login', {
        phone: this.normalizePhone(phoneNumber),
        password
      });
      const data = response?.data || {};
      if (!data.success || !data.customToken) {
        await this.recordAttempt(phoneNumber, false);
        throw new Error(data.error || 'Senha incorreta');
      }

      await auth().signInWithCustomToken(data.customToken);
      await this.recordAttempt(phoneNumber, true);

      const currentUser = auth().currentUser;
      return {
        uid: currentUser?.uid || data.uid,
        phoneNumber: currentUser?.phoneNumber || this.normalizePhone(phoneNumber),
        usertype: data.userType || 'customer',
        userType: data.userType || 'customer'
      };
    } catch (error) {
      Logger.error('❌ Erro no login com senha:', error);
      await this.recordAttempt(phoneNumber, false);
      throw error;
    }
  }

  /**
   * Inicia processo de reset de senha via OTP
   * @param {string} phoneNumber - Número de telefone
   * @returns {Promise<Object>} - Confirmação do Firebase Phone Auth
   */
  static async requestPasswordReset(phoneNumber) {
    try {
      // Verificar rate limit
      await this.checkRateLimit(phoneNumber);

      // Verificar se usuário existe
      const user = await this.checkUserExistsByPhone(phoneNumber);

      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // Fluxo principal via Firebase Phone Auth.
      const confirmation = await auth().signInWithPhoneNumber(phoneNumber);

      // Registrar tentativa
      await this.recordAttempt(phoneNumber, false); // false porque ainda não resetou

      return {
        confirmation,
        userId: user.uid
      };
    } catch (error) {
      Logger.error('❌ Erro ao solicitar reset de senha:', error);
      throw error;
    }
  }

  /**
   * Reseta senha após verificação do OTP
   * @param {string} phoneNumber - Número de telefone
   * @param {string} verificationId - ID de verificação do Firebase
   * @param {string} otp - Código OTP
   * @param {string} newPassword - Nova senha
   * @returns {Promise<boolean>} - Sucesso da operação
   */
  static async resetPassword(phoneNumber, verificationId, otp, newPassword) {
    try {
      // Verificar OTP via Firebase e autenticar temporariamente.
      const credential = auth.PhoneAuthProvider.credential(verificationId, otp);
      await auth().signInWithCredential(credential);

      // Atualizar senha
      const currentUser = auth().currentUser;
      if (currentUser) {
        await this.setupPassword(phoneNumber, newPassword);

        // Registrar sucesso
        await this.recordAttempt(phoneNumber, true);

        return true;
      }

      throw new Error('Erro ao resetar senha');
    } catch (error) {
      Logger.error('❌ Erro ao resetar senha:', error);
      await this.recordAttempt(phoneNumber, false);
      throw error;
    }
  }
}

export default UserAuthService;
