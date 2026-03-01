/**
 * 🔐 Configuração do KYC (Know Your Customer)
 * 
 * Agora usando Feature Flag Service para gerenciamento centralizado
 * 
 * Para HABILITAR o KYC:
 *   - Use: featureFlagService.setFlag('KYC_ENABLED', true)
 *   - Ou altere o valor padrão em FeatureFlagService.js
 * 
 * Para DESABILITAR o KYC (bypass):
 *   - Use: featureFlagService.setFlag('KYC_ENABLED', false)
 *   - Ou altere o valor padrão em FeatureFlagService.js
 */

import featureFlagService from '../services/FeatureFlagService';

/**
 * Obtém o status atual do KYC
 * @returns {Promise<boolean>} true se KYC está habilitado
 */
export const isKYCEnabled = async () => {
  return await featureFlagService.getFlag('KYC_ENABLED', false);
};

/**
 * Habilita o KYC
 */
export const enableKYC = async () => {
  await featureFlagService.setFlag('KYC_ENABLED', true);
};

/**
 * Desabilita o KYC (bypass)
 */
export const disableKYC = async () => {
  await featureFlagService.setFlag('KYC_ENABLED', false);
};

/**
 * Exportar o serviço para uso direto se necessário
 */
export { featureFlagService };

export default {
  isEnabled: isKYCEnabled,
  enable: enableKYC,
  disable: disableKYC,
  service: featureFlagService,
};
