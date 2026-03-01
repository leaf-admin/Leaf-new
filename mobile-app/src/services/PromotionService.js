import Logger from '../utils/Logger';
/**
 * 🎁 SERVIÇO DE PROMOÇÕES (CLIENTE)
 * 
 * Verifica e aplica promoções elegíveis para motoristas
 */

import { getSelfHostedApiUrl } from '../config/ApiConfig';


class PromotionService {
  /**
   * Verificar promoções elegíveis para um motorista
   * @param {string} driverId - ID do motorista
   * @returns {Promise<Object>} Resultado da verificação
   */
  async checkEligiblePromotions(driverId) {
    try {
      const backendUrl = getSelfHostedApiUrl(`/api/promotions/check-driver/${driverId}`);
      
      // ✅ Adicionar timeout e AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 segundos
      
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // ✅ Se rota não existir (404), retornar sucesso vazio (não é erro crítico)
        if (response.status === 404) {
          Logger.log('ℹ️ [Promotions] Rota de promoções não implementada ainda');
          return {
            success: true,
            results: []
          };
        }
        throw new Error(`Erro ao verificar promoções: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      // ✅ Não mostrar erro crítico se for timeout ou network error
      if (error.name === 'AbortError' || error.message.includes('Network request failed')) {
        Logger.log('ℹ️ [Promotions] Rota de promoções não disponível (timeout ou network)');
        return {
          success: true,
          results: []
        };
      }
      Logger.log('ℹ️ [Promotions] Erro ao verificar promoções elegíveis (não crítico):', error.message);
      return {
        success: false,
        error: error.message,
        results: []
      };
    }
  }

  /**
   * Verificar elegibilidade para uma promoção específica
   * @param {string} driverId - ID do motorista
   * @param {string} promotionId - ID da promoção
   * @returns {Promise<Object>} Resultado da verificação
   */
  async checkEligibility(driverId, promotionId) {
    try {
      const backendUrl = getSelfHostedApiUrl(
        `/api/promotions/${promotionId}/check-eligibility/${driverId}`
      );
      
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Erro ao verificar elegibilidade: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      Logger.error('❌ Erro ao verificar elegibilidade:', error);
      return {
        eligible: false,
        reason: error.message
      };
    }
  }

  /**
   * Aplicar uma promoção manualmente (se elegível)
   * @param {string} driverId - ID do motorista
   * @param {string} promotionId - ID da promoção
   * @returns {Promise<Object>} Resultado da aplicação
   */
  async applyPromotion(driverId, promotionId) {
    try {
      const backendUrl = getSelfHostedApiUrl(
        `/api/promotions/${promotionId}/apply/${driverId}`
      );
      
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Erro ao aplicar promoção: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      Logger.error('❌ Erro ao aplicar promoção:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Listar promoções ativas
   * @returns {Promise<Object>} Lista de promoções
   */
  async listActivePromotions() {
    try {
      const backendUrl = getSelfHostedApiUrl('/api/promotions?status=active');
      
      // ✅ Adicionar timeout e AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 segundos
      
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // ✅ Se rota não existir (404), retornar sucesso vazio (não é erro crítico)
        if (response.status === 404) {
          Logger.log('ℹ️ [Promotions] Rota de listagem não implementada ainda');
          return {
            success: true,
            promotions: []
          };
        }
        throw new Error(`Erro ao listar promoções: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      // ✅ Não mostrar erro crítico se for timeout ou network error
      if (error.name === 'AbortError' || error.message.includes('Network request failed')) {
        Logger.log('ℹ️ [Promotions] Rota de listagem não disponível (timeout ou network)');
        return {
          success: true,
          promotions: []
        };
      }
      Logger.log('ℹ️ [Promotions] Erro ao listar promoções (não crítico):', error.message);
      return {
        success: false,
        promotions: [],
        error: error.message
      };
    }
  }
}

export default new PromotionService();

