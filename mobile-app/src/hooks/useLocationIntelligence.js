import Logger from '../utils/Logger';
/**
 * useLocationIntelligence.js
 * Hook para gerenciar Location Intelligence Service
 */

import { useState, useCallback, useRef } from 'react';
import LocationIntelligenceService from '../services/LocationIntelligenceService';


export const useLocationIntelligence = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [connectivity, setConnectivity] = useState({
    vultr: false,
    hostinger: false,
    timestamp: null
  });

  const serviceRef = useRef(null);

  // Inicializar serviço
  const initializeService = useCallback(() => {
    if (!serviceRef.current) {
      serviceRef.current = new LocationIntelligenceService();
      Logger.log('🧠 Location Intelligence Service inicializado via hook');
    }
    return serviceRef.current;
  }, []);

  // Resolver localização
  const resolveLocation = useCallback(async (query, coordinates = null, context = 'passenger') => {
    try {
      setIsLoading(true);
      setError(null);

      const service = initializeService();
      const result = await service.resolveLocation(query, coordinates, context);

      if (result) {
        setLastResult(result);
        Logger.log('✅ Localização resolvida:', result);
        return result;
      } else {
        setError('Localização não encontrada');
        return null;
      }
    } catch (err) {
      const errorMessage = err.message || 'Erro ao resolver localização';
      setError(errorMessage);
      Logger.error('❌ Erro no resolveLocation:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [initializeService]);

  // Buscar sugestões
  const getSuggestions = useCallback(async (query, context = 'passenger') => {
    try {
      if (!query || query.length < 2) {
        return [];
      }

      setIsLoading(true);
      setError(null);

      const service = initializeService();
      const suggestions = await service.getSmartSuggestions(query, context);

      Logger.log('✅ Sugestões obtidas:', suggestions.length);
      return suggestions;
    } catch (err) {
      const errorMessage = err.message || 'Erro ao buscar sugestões';
      setError(errorMessage);
      Logger.error('❌ Erro no getSuggestions:', err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [initializeService]);

  // Testar conectividade
  const testConnectivity = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const service = initializeService();
      const results = await service.testConnectivity();

      setConnectivity(results);
      Logger.log('✅ Conectividade testada:', results);
      return results;
    } catch (err) {
      const errorMessage = err.message || 'Erro ao testar conectividade';
      setError(errorMessage);
      Logger.error('❌ Erro no testConnectivity:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [initializeService]);

  // Obter estatísticas
  const getStats = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const service = initializeService();
      const stats = await service.getStats();

      if (stats) {
        Logger.log('✅ Estatísticas obtidas:', stats);
        return stats;
      } else {
        setError('Não foi possível obter estatísticas');
        return null;
      }
    } catch (err) {
      const errorMessage = err.message || 'Erro ao obter estatísticas';
      setError(errorMessage);
      Logger.error('❌ Erro no getStats:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [initializeService]);

  // Limpar cache
  const clearCache = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const service = initializeService();
      const cleared = await service.clearCache();

      Logger.log('✅ Cache limpo:', cleared, 'chaves removidas');
      return cleared;
    } catch (err) {
      const errorMessage = err.message || 'Erro ao limpar cache';
      setError(errorMessage);
      Logger.error('❌ Erro no clearCache:', err);
      return 0;
    } finally {
      setIsLoading(false);
    }
  }, [initializeService]);

  // Limpar erro
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Limpar resultado
  const clearResult = useCallback(() => {
    setLastResult(null);
  }, []);

  // Reset completo
  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setLastResult(null);
    setConnectivity({
      vultr: false,
      hostinger: false,
      timestamp: null
    });
  }, []);

  return {
    // Estado
    isLoading,
    error,
    lastResult,
    connectivity,
    
    // Ações
    resolveLocation,
    getSuggestions,
    testConnectivity,
    getStats,
    clearCache,
    
    // Utilitários
    clearError,
    clearResult,
    reset,
    
    // Informações do serviço
    getConnectivityInfo: () => {
      const service = initializeService();
      return service.getConnectivityInfo();
    }
  };
}; 