import Logger from '../utils/Logger';
/**
 * LocationIntelligenceService.js
 * Serviço de Location Intelligence para o mobile app
 */

import { Alert } from 'react-native';
import BACKEND_BASE_URL from '../config/backendBaseUrl';


class LocationIntelligenceService {
  constructor() {
    this.backendUrl = BACKEND_BASE_URL;
    
    // Timeout mais agressivo para não atrasar o Google Places
    this.timeout = 2000; // 2 segundos máximo
    
    Logger.log('🧠 Location Intelligence Service (Mobile) inicializado');
  }

  /**
   * Resolve localização usando estratégia híbrida
   */
  async resolveLocation(query, coordinates = null, context = 'passenger') {
    try {
      Logger.log(`🔍 Resolvendo localização: "${query}" (${context})`);

      // 1. Tentar backend principal (mais rápido)
      try {
        const backendResult = await this.resolveFromBackend(query, coordinates, context);
        if (backendResult) {
          Logger.log('✅ Resolvido via backend principal');
          return backendResult;
        }
      } catch (error) {
        Logger.warn('⚠️ Backend principal falhou:', error.message);
      }

      Logger.log('❌ Localização não encontrada em nenhuma fonte');
      return null;

    } catch (error) {
      Logger.error('❌ Erro ao resolver localização:', error);
      throw error;
    }
  }

  /**
   * Resolve localização via backend principal
   */
  async resolveFromBackend(query, coordinates, context) {
    try {
      const params = new URLSearchParams();
      
      if (query) params.append('query', query);
      if (coordinates?.lat) params.append('lat', coordinates.lat);
      if (coordinates?.lng) params.append('lng', coordinates.lng);
      if (context) params.append('context', context);

      const response = await fetch(`${this.backendUrl}/api/location/resolve?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success && data.data) {
        return data.data;
      }
      
      return null;
    } catch (error) {
      Logger.error('❌ Erro ao resolver via backend principal:', error);
      throw error;
    }
  }

  /**
   * Busca sugestões inteligentes
   */
  async getSmartSuggestions(query, context = 'passenger') {
    try {
      if (!query || query.length < 2) {
        return [];
      }

      Logger.log(`🔍 Buscando sugestões para: "${query}"`);

      // 1. Tentar backend principal primeiro (com timeout agressivo de 2s)
      try {
        Logger.log('🚀 Tentando backend principal (timeout: 2s)...');
        const backendSuggestions = await this.getSuggestionsFromBackend(query, context);
        if (backendSuggestions && backendSuggestions.length > 0) {
          Logger.log('✅ Sugestões obtidas via backend principal:', backendSuggestions.length);
          return backendSuggestions;
        }
        Logger.log('⚠️ Backend principal retornou vazio');
      } catch (error) {
        Logger.warn('⚠️ Backend principal falhou para sugestões:', error.message);
      }

      // 2. Fallback imediato para Google Places
      Logger.log('🔄 Backend principal falhou, retornando vazio para forçar Google Places');
      return [];

    } catch (error) {
      Logger.error('❌ Erro ao buscar sugestões:', error);
      return [];
    }
  }

  /**
   * Busca sugestões via backend principal
   */
  async getSuggestionsFromBackend(query, context) {
    try {
      const params = new URLSearchParams({
        query: query,
        context: context || 'passenger'
      });

      const url = `${this.backendUrl}/api/location/suggestions?${params}`;
      Logger.log('🌐 Chamando API de localização:', url);

      // Criar AbortController para timeout mais agressivo
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      Logger.log('📡 Response status:', response.status);
      Logger.log('📡 Response ok:', response.ok);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      Logger.log('📡 Response data:', data);
      
      if (data.success && data.data) {
        Logger.log('✅ Dados retornados com sucesso:', data.data.length, 'itens');
        return data.data;
      }
      
      Logger.log('⚠️ Resposta sem dados válidos:', data);
      return [];
    } catch (error) {
      if (error.name === 'AbortError') {
        Logger.warn('⏰ Timeout ao buscar sugestões via backend principal (2s)');
      } else {
        Logger.error('❌ Erro ao buscar sugestões via backend principal:', error);
      }
      throw error;
    }
  }

  /**
   * Obtém estatísticas do serviço
   */
  async getStats() {
    try {
      const response = await fetch(`${this.backendUrl}/api/location/stats`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success && data.data) {
        return data.data;
      }
      
      return null;
    } catch (error) {
      Logger.error('❌ Erro ao obter estatísticas:', error);
      return null;
    }
  }

  /**
   * Limpa cache do serviço
   */
  async clearCache() {
    try {
      const response = await fetch(`${this.backendUrl}/api/location/cache/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        Logger.log('🗑️ Cache limpo com sucesso');
        return data.data.cleared;
      }
      
      return 0;
    } catch (error) {
      Logger.error('❌ Erro ao limpar cache:', error);
      return 0;
    }
  }

  /**
   * Testa conectividade com os serviços
   */
  async testConnectivity() {
    const results = {
      backend: false,
      timestamp: new Date().toISOString()
    };

    // Testar backend principal
    try {
      const response = await fetch(`${this.backendUrl}/health`, {
        method: 'GET',
        timeout: 5000,
      });
      results.backend = response.ok;
      Logger.log('✅ Backend principal conectado:', response.ok);
    } catch (error) {
      Logger.log('❌ Backend principal não conectado:', error.message);
    }

    return results;
  }

  /**
   * Obtém informações de conectividade
   */
  getConnectivityInfo() {
    return {
      backend: {
        url: this.backendUrl,
        status: 'active',
        description: 'Servidor principal'
      }
    };
  }

  /**
   * Obtém sugestões do cache Redis
   */
  async getSuggestionsFromRedis(query) {
    try {
      Logger.log('🔍 Buscando sugestões no Redis:', query);
      
      const response = await fetch(`${this.backendUrl}/api/location/suggestions/redis?query=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success && data.data) {
        Logger.log('✅ Sugestões do Redis:', data.data.length);
        return data.data;
      }
      
      return [];
    } catch (error) {
      Logger.warn('⚠️ Redis não disponível:', error.message);
      return [];
    }
  }

  /**
   * Obtém sugestões do cache Firebase
   */
  async getSuggestionsFromFirebase(query) {
    try {
      Logger.log('🔍 Buscando sugestões no Firebase:', query);
      
      const response = await fetch(`${this.backendUrl}/api/location/suggestions/firebase?query=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success && data.data) {
        Logger.log('✅ Sugestões do Firebase:', data.data.length);
        return data.data;
      }
      
      return [];
    } catch (error) {
      Logger.warn('⚠️ Firebase não disponível:', error.message);
      return [];
    }
  }

  /**
   * Salva sugestões no cache
   */
  async cacheSuggestions(query, suggestions, source = 'google_places') {
    try {
      Logger.log('💾 Salvando sugestões no cache:', query, suggestions.length);
      
      const response = await fetch(`${this.backendUrl}/api/location/cache/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          suggestions,
          source,
          timestamp: new Date().toISOString()
        }),
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        Logger.log('✅ Sugestões salvas no cache');
        return true;
      }
      
      return false;
    } catch (error) {
      Logger.warn('⚠️ Falha ao salvar no cache:', error.message);
      return false;
    }
  }
}

export default LocationIntelligenceService; 
