import Logger from '../utils/Logger';
/**
 * 🔐 SERVIÇO DE AUTENTICAÇÃO DE USUÁRIOS
 * 
 * Gerencia verificação de usuários existentes, login com senha e reset de senha
 */

import database from '@react-native-firebase/database';
import auth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';


class UserAuthService {
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
      Logger.log('🔍 Verificando se usuário existe:', phoneNumber);

      // Normalizar número de telefone (remover espaços, caracteres especiais)
      const normalizedPhone = phoneNumber.replace(/\D/g, '');

      // Buscar no Realtime Database
      // Estrutura: users/{uid}/mobile
      const usersRef = database().ref('users');
      const snapshot = await usersRef.once('value');

      if (!snapshot.exists()) {
        Logger.log('ℹ️ Nenhum usuário encontrado no banco');
        return null;
      }

      // Iterar sobre todos os usuários para encontrar pelo telefone
      let foundUser = null;
      snapshot.forEach((childSnapshot) => {
        const userData = childSnapshot.val();
        const userPhone = userData?.mobile || userData?.phoneNumber || '';
        const userPhoneNormalized = userPhone.replace(/\D/g, '');

        // Comparar números normalizados
        if (userPhoneNormalized === normalizedPhone ||
          userPhoneNormalized === normalizedPhone.replace(/^55/, '') ||
          userPhoneNormalized.replace(/^55/, '') === normalizedPhone) {
          foundUser = {
            uid: childSnapshot.key,
            ...userData
          };
          return true; // Parar iteração
        }
      });

      if (foundUser) {
        Logger.log('✅ Usuário encontrado:', foundUser.uid);
        return foundUser;
      }

      Logger.log('ℹ️ Usuário não encontrado para o telefone:', phoneNumber);
      return null;
    } catch (error) {
      Logger.error('❌ Erro ao verificar usuário:', error);
      return null;
    }
  }

  /**
   * Verifica se o usuário tem senha cadastrada
   * @param {string} uid - UID do usuário
   * @returns {Promise<boolean>} - Se tem senha cadastrada
   */
  static async hasPassword(uid) {
    try {
      const userRef = database().ref(`users/${uid}`);
      const snapshot = await userRef.once('value');

      if (!snapshot.exists()) {
        return false;
      }

      const userData = snapshot.val();
      // Verificar se tem senha hash ou se está usando Firebase Auth com email/senha
      return !!(userData.hasPassword || userData.passwordHash);
    } catch (error) {
      Logger.error('❌ Erro ao verificar senha:', error);
      return false;
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

      // Buscar usuário pelo telefone
      const user = await this.checkUserExistsByPhone(phoneNumber);

      if (!user) {
        await this.recordAttempt(phoneNumber, false);
        throw new Error('Usuário não encontrado');
      }

      // Verificar se tem senha cadastrada
      const hasPassword = await this.hasPassword(user.uid);

      if (!hasPassword) {
        // Se não tem senha, tentar autenticar via Firebase Auth
        // Usar email baseado no telefone: phone@leaf.com
        const email = `${phoneNumber.replace(/\D/g, '')}@leaf.com`;

        try {
          await auth().signInWithEmailAndPassword(email, password);
          await this.recordAttempt(phoneNumber, true);

          // Obter dados atualizados do usuário
          const currentUser = auth().currentUser;
          return {
            uid: currentUser.uid,
            ...user,
            phoneNumber: currentUser.phoneNumber || phoneNumber
          };
        } catch (authError) {
          await this.recordAttempt(phoneNumber, false);
          throw new Error('Senha incorreta');
        }
      } else {
        // Se tem senha no banco, verificar hash (implementar se necessário)
        // Por enquanto, usar Firebase Auth como fallback
        const email = `${phoneNumber.replace(/\D/g, '')}@leaf.com`;

        try {
          await auth().signInWithEmailAndPassword(email, password);
          await this.recordAttempt(phoneNumber, true);

          const currentUser = auth().currentUser;
          return {
            uid: currentUser.uid,
            ...user,
            phoneNumber: currentUser.phoneNumber || phoneNumber
          };
        } catch (authError) {
          await this.recordAttempt(phoneNumber, false);
          throw new Error('Senha incorreta');
        }
      }
    } catch (error) {
      Logger.error('❌ Erro no login com senha:', error);
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

      // Enviar OTP via API Customizada
      const { api } = require('../common-local/api');
      const response = await api.post('/custom-otp/request-otp', {
        phone: phoneNumber
      });

      if (!response.data || !response.data.success) {
        throw new Error('Falha ao enviar código OTP');
      }

      const confirmation = {
        verificationId: response.data.verificationId,
        isCustomOtp: true
      };

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
      // Verificar OTP via API Customizada
      const { api } = require('../common-local/api');
      const response = await api.post('/custom-otp/verify-otp', {
        phone: phoneNumber,
        verificationId: verificationId,
        otp: otp
      });

      if (!response.data || !response.data.success || !response.data.customToken) {
        throw new Error('Código inválido ou expirado');
      }

      // Autenticar temporariamente via Custom Token
      await auth().signInWithCustomToken(response.data.customToken);

      // Atualizar senha
      const currentUser = auth().currentUser;
      if (currentUser) {
        // Atualizar senha no Firebase Auth
        await currentUser.updatePassword(newPassword);

        // Marcar que tem senha no banco
        await database().ref(`users/${currentUser.uid}`).update({
          hasPassword: true,
          passwordUpdatedAt: new Date().toISOString()
        });

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

