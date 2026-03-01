import Logger from '../utils/Logger';
/**
 * 🚩 Hook React para usar Feature Flags
 * 
 * Exemplo de uso:
 * ```javascript
 * const kycEnabled = useFeatureFlag('KYC_ENABLED', false);
 * 
 * if (kycEnabled) {
 *   // KYC está habilitado
 * }
 * ```
 */

import { useState, useEffect } from 'react';
import featureFlagService from '../services/FeatureFlagService';

/**
 * Hook para usar uma feature flag
 * @param {string} flagName - Nome da feature flag
 * @param {boolean} defaultValue - Valor padrão se a flag não existir
 * @returns {boolean} Valor atual da flag
 */
export const useFeatureFlag = (flagName, defaultValue = false) => {
  const [flagValue, setFlagValue] = useState(defaultValue);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadFlag = async () => {
      try {
        // Inicializar serviço se necessário
        if (!featureFlagService.initialized) {
          await featureFlagService.initialize();
        }

        // Obter valor da flag
        const value = await featureFlagService.getFlag(flagName, defaultValue);
        
        if (isMounted) {
          setFlagValue(value);
          setIsLoading(false);
        }
      } catch (error) {
        Logger.error(`❌ [useFeatureFlag] Erro ao carregar flag "${flagName}":`, error);
        if (isMounted) {
          setFlagValue(defaultValue);
          setIsLoading(false);
        }
      }
    };

    loadFlag();

    // Adicionar listener para mudanças na flag
    const removeListener = featureFlagService.addListener(flagName, (newValue) => {
      if (isMounted) {
        setFlagValue(newValue);
      }
    });

    return () => {
      isMounted = false;
      removeListener();
    };
  }, [flagName, defaultValue]);

  return flagValue;
};

export default useFeatureFlag;


