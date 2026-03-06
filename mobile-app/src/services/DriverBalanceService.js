import Logger from '../utils/Logger';
import { getSelfHostedApiUrl } from '../config/ApiConfig';


/**
 * Serviço para gerenciar saldo e histórico do motorista
 */
class DriverBalanceService {
  constructor() {
    this.baseUrl = getSelfHostedApiUrl('/api/payment');
    Logger.log('🔗 DriverBalanceService baseUrl:', this.baseUrl);
    this.WITHDRAW_FEE_THRESHOLD = 500;
    this.WITHDRAW_FEE_BELOW_THRESHOLD = 1;
  }

  /**
   * Obtém saldo atual do motorista
   * @param {string} driverId - ID do motorista
   * @returns {Promise<Object>} - Dados do saldo
   */
  async getDriverBalance(driverId) {
    // ✅ CORREÇÃO: Criar AbortController para timeout (AbortSignal.timeout pode não estar disponível)
    const controller = new AbortController();
    let timeoutId;
    
    try {
      const url = `${this.baseUrl}/driver-balance/${driverId}`;
      Logger.log('💰 DriverBalanceService - Buscando saldo:', url);
      
      timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      if (timeoutId) clearTimeout(timeoutId);

      // Verificar se a resposta é JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        Logger.error('❌ Resposta não é JSON:', text.substring(0, 200));
        return {
          success: false,
          error: `Erro no servidor (${response.status}): ${response.statusText}`
        };
      }

      const data = await response.json();
      
      if (data.success) {
        return {
          success: true,
          balance: data.balance || 0,
          totalEarnings: data.totalEarnings || 0,
          lastUpdated: data.lastUpdated,
          lastRideId: data.lastRideId
        };
      } else {
        return {
          success: false,
          error: data.error || 'Erro ao buscar saldo'
        };
      }
    } catch (error) {
      Logger.error('❌ Erro ao buscar saldo do motorista:', error);
      // Se for erro de parse JSON, retornar erro específico
      if (error.message && error.message.includes('JSON')) {
        return {
          success: false,
          error: 'Erro ao processar resposta do servidor'
        };
      }
      return {
        success: false,
        error: error.message || 'Erro ao buscar saldo'
      };
    } finally {
      // ✅ Garantir que timeout seja limpo mesmo em caso de erro
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Obtém histórico de transações do motorista
   * @param {string} driverId - ID do motorista
   * @param {number} limit - Limite de transações (padrão: 50)
   * @returns {Promise<Object>} - Histórico de transações
   */
  async getTransactionHistory(driverId, limit = 50) {
    // ✅ CORREÇÃO: Criar AbortController para timeout (AbortSignal.timeout pode não estar disponível)
    const controller = new AbortController();
    let timeoutId;
    
    try {
      const url = `${this.baseUrl}/driver-balance/${driverId}/transactions?limit=${limit}`;
      Logger.log('💰 DriverBalanceService - Buscando histórico:', url);
      
      timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      if (timeoutId) clearTimeout(timeoutId);

      // Verificar se a resposta é JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        Logger.error('❌ Resposta não é JSON:', text.substring(0, 200));
        return {
          success: false,
          error: `Erro no servidor (${response.status}): ${response.statusText}`
        };
      }

      const data = await response.json();
      
      if (data.success) {
        return {
          success: true,
          transactions: data.transactions || [],
          total: data.total || 0
        };
      } else {
        return {
          success: false,
          error: data.error || 'Erro ao buscar histórico'
        };
      }
    } catch (error) {
      Logger.error('❌ Erro ao buscar histórico de transações:', error);
      // Se for erro de parse JSON, retornar erro específico
      if (error.message && error.message.includes('JSON')) {
        return {
          success: false,
          error: 'Erro ao processar resposta do servidor'
        };
      }
      return {
        success: false,
        error: error.message || 'Erro ao buscar histórico'
      };
    } finally {
      // ✅ Garantir que timeout seja limpo mesmo em caso de erro
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Calcula taxa de saque no app (mesma regra do backend).
   * @param {number} amount
   */
  calculateWithdrawFee(amount) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric < this.WITHDRAW_FEE_THRESHOLD ? this.WITHDRAW_FEE_BELOW_THRESHOLD : 0;
  }

  /**
   * Solicita saque do motorista.
   * @param {string} driverId
   * @param {number} amount
   * @param {string} pixKey
   */
  async requestWithdrawal(driverId, amount, pixKey) {
    const controller = new AbortController();
    let timeoutId;

    try {
      const url = `${this.baseUrl}/driver-balance/${driverId}/withdraw`;
      timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          amount,
          pixKey
        })
      });

      if (timeoutId) clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return {
          success: false,
          error: `Erro no servidor (${response.status})`
        };
      }

      const data = await response.json();
      if (response.ok && data.success) {
        return data;
      }

      return {
        success: false,
        error: data.error || 'Falha ao solicitar saque'
      };
    } catch (error) {
      Logger.error('❌ Erro ao solicitar saque:', error);
      return {
        success: false,
        error: error.message || 'Erro de conexão ao solicitar saque'
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

export default new DriverBalanceService();
