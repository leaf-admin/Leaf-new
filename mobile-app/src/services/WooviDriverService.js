import Logger from '../utils/Logger';
import { WooviConfig } from '../../config/WooviConfig';
import { createAxiosInstance } from '../utils/axiosInterceptor';


class WooviDriverService {
  constructor() {
    // ✅ API Woovi com headers compatíveis com CORS
    this.api = createAxiosInstance({
      baseURL: WooviConfig.baseUrl,
      headers: {
        'Authorization': WooviConfig.apiKey,
        'X-App-ID': WooviConfig.appId
      },
      timeout: WooviConfig.timeout || 30000
    });
  }

  /**
   * Cria um cliente na Woovi para um motorista aprovado
   * @param {Object} driverData - Dados do motorista
   * @param {string} driverData.name - Nome completo do motorista
   * @param {string} driverData.email - Email do motorista
   * @param {string} driverData.phone - Telefone do motorista
   * @param {string} driverData.cpf - CPF do motorista
   * @param {string} driverData.driverId - ID do motorista no sistema
   * @returns {Promise<Object>} - Dados do cliente criado na Woovi
   */
  async createDriverClient(driverData) {
    try {
      Logger.log('🚗 Criando cliente Woovi para motorista:', driverData.name);
      
      const clientData = {
        name: driverData.name,
        email: driverData.email,
        phone: driverData.phone,
        document: driverData.cpf,
        additionalInfo: [
          {
            key: 'app',
            value: 'leaf'
          },
          {
            key: 'type',
            value: 'driver'
          },
          {
            key: 'driver_id',
            value: driverData.driverId
          },
          {
            key: 'created_at',
            value: new Date().toISOString()
          }
        ]
      };

      const response = await this.api.post('/customer', clientData);
      
      if (response.data && response.data.customer) {
        Logger.log('✅ Cliente Woovi criado com sucesso:', response.data.customer.id);
        return {
          success: true,
          wooviClientId: response.data.customer.id,
          customer: response.data.customer
        };
      } else {
        throw new Error('Resposta inválida da API Woovi');
      }
    } catch (error) {
      Logger.error('❌ Erro ao criar cliente Woovi:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Busca um cliente na Woovi pelo ID
   * @param {string} wooviClientId - ID do cliente na Woovi
   * @returns {Promise<Object>} - Dados do cliente
   */
  async getDriverClient(wooviClientId) {
    try {
      const response = await this.api.get(`/customer/${wooviClientId}`);
      return {
        success: true,
        customer: response.data.customer
      };
    } catch (error) {
      Logger.error('❌ Erro ao buscar cliente Woovi:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Atualiza dados de um cliente na Woovi
   * @param {string} wooviClientId - ID do cliente na Woovi
   * @param {Object} updateData - Dados para atualizar
   * @returns {Promise<Object>} - Resultado da atualização
   */
  async updateDriverClient(wooviClientId, updateData) {
    try {
      const response = await this.api.put(`/customer/${wooviClientId}`, updateData);
      return {
        success: true,
        customer: response.data.customer
      };
    } catch (error) {
      Logger.error('❌ Erro ao atualizar cliente Woovi:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Cria uma cobrança PIX para o motorista (exemplo: taxa de adesão)
   * @param {string} wooviClientId - ID do cliente na Woovi
   * @param {number} value - Valor em centavos
   * @param {string} description - Descrição da cobrança
   * @returns {Promise<Object>} - Dados da cobrança criada
   */
  async createDriverCharge(wooviClientId, value, description) {
    try {
      const chargeData = {
        value: value,
        correlationID: `driver_${wooviClientId}_${Date.now()}`,
        comment: description,
        expiresIn: 3600, // 1 hora
        customer: wooviClientId,
        additionalInfo: [
          {
            key: 'app',
            value: 'leaf'
          },
          {
            key: 'type',
            value: 'driver_charge'
          },
          {
            key: 'driver_id',
            value: wooviClientId
          }
        ]
      };

      const response = await this.api.post('/charge', chargeData);
      
      return {
        success: true,
        charge: response.data.charge
      };
    } catch (error) {
      Logger.error('❌ Erro ao criar cobrança para motorista:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Lista cobranças de um motorista específico
   * @param {string} wooviClientId - ID do cliente na Woovi
   * @returns {Promise<Object>} - Lista de cobranças
   */
  async getDriverCharges(wooviClientId) {
    try {
      const response = await this.api.get(`/charge?customer=${wooviClientId}`);
      return {
        success: true,
        charges: response.data.charges
      };
    } catch (error) {
      Logger.error('❌ Erro ao listar cobranças do motorista:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Verifica o saldo de um motorista na Woovi
   * @param {string} wooviClientId - ID do cliente na Woovi
   * @returns {Promise<Object>} - Saldo do motorista
   */
  async getDriverBalance(wooviClientId) {
    try {
      // Nota: A Woovi pode não ter um endpoint direto de saldo
      // Vamos usar as cobranças para calcular o saldo
      const chargesResponse = await this.getDriverCharges(wooviClientId);
      
      if (chargesResponse.success) {
        const completedCharges = chargesResponse.charges.filter(charge => 
          charge.status === 'COMPLETED'
        );
        
        const totalEarnings = completedCharges.reduce((total, charge) => {
          return total + (charge.value - (charge.fee || 0));
        }, 0);

        return {
          success: true,
          balance: totalEarnings,
          totalCharges: completedCharges.length,
          charges: completedCharges
        };
      } else {
        throw new Error('Erro ao buscar cobranças');
      }
    } catch (error) {
      Logger.error('❌ Erro ao verificar saldo do motorista:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }
}

export default new WooviDriverService();










