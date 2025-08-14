import { useState, useCallback } from 'react';
import LocationIntelligenceService from '../services/LocationIntelligenceService';

export default function useLocationIntelligence() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastResult, setLastResult] = useState(null);
    const [connectivity, setConnectivity] = useState({
        vultr: false,
        hostinger: false
    });

    // Instância do serviço
    const service = LocationIntelligenceService.getInstance();

    // Função para resolver localização
    const resolveLocation = useCallback(async (query) => {
        try {
            setIsLoading(true);
            setError(null);
            
            const result = await service.resolveLocation(query);
            setLastResult(result);
            return result;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [service]);

    // Função para obter sugestões inteligentes
    const getSuggestions = useCallback(async (query) => {
        try {
            setIsLoading(true);
            setError(null);
            
            const result = await service.getSmartSuggestions(query);
            setLastResult(result);
            return result;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [service]);

    // Função para obter sugestões do Redis
    const getSuggestionsFromRedis = useCallback(async (query) => {
        try {
            setError(null);
            
            const result = await service.getSuggestionsFromRedis(query);
            return result;
        } catch (err) {
            setError(err.message);
            return null;
        }
    }, [service]);

    // Função para obter sugestões do Firebase
    const getSuggestionsFromFirebase = useCallback(async (query) => {
        try {
            setError(null);
            
            const result = await service.getSuggestionsFromFirebase(query);
            return result;
        } catch (err) {
            setError(err.message);
            return null;
        }
    }, [service]);

    // Função para salvar sugestões no cache
    const cacheSuggestions = useCallback(async (query, suggestions, source) => {
        try {
            setError(null);
            
            const result = await service.cacheSuggestions(query, suggestions, source);
            return result;
        } catch (err) {
            setError(err.message);
            return null;
        }
    }, [service]);

    // Função para testar conectividade
    const testConnectivity = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);
            
            const result = await service.testConnectivity();
            setConnectivity(result);
            return result;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [service]);

    // Função para obter estatísticas
    const getStats = useCallback(async () => {
        try {
            setError(null);
            
            const result = await service.getStats();
            return result;
        } catch (err) {
            setError(err.message);
            return null;
        }
    }, [service]);

    // Função para limpar cache
    const clearCache = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);
            
            const result = await service.clearCache();
            setLastResult(result);
            return result;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [service]);

    // Função para limpar erro
    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return {
        // Estado
        isLoading,
        error,
        lastResult,
        connectivity,
        
        // Funções
        resolveLocation,
        getSuggestions,
        getSuggestionsFromRedis,
        getSuggestionsFromFirebase,
        cacheSuggestions,
        testConnectivity,
        getStats,
        clearCache,
        clearError
    };
} 