import Logger from '../utils/Logger';
/**
 * LocationIntelligenceService.js
 * Serviço de Location Intelligence para o mobile app
 */

import { Alert } from 'react-native';


class LocationIntelligenceService {
  constructor() {
    // URLs dos serviços
    this.vultrUrl = 'http://147.182.204.181:3001';
    this.hostingerUrl = 'https://seu-dominio-hostinger.com'; // TODO: Configurar
    
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

      // 1. Tentar Vultr primeiro (mais rápido)
      try {
        const vultrResult = await this.resolveFromVultr(query, coordinates, context);
        if (vultrResult) {
          Logger.log('✅ Resolvido via Vultr');
          return vultrResult;
        }
      } catch (error) {
        Logger.warn('⚠️ Vultr falhou, tentando Hostinger:', error.message);
      }

      // 2. Tentar Hostinger como fallback
      try {
        const hostingerResult = await this.resolveFromHostinger(query, coordinates, context);
        if (hostingerResult) {
          Logger.log('✅ Resolvido via Hostinger');
          return hostingerResult;
        }
      } catch (error) {
        Logger.warn('⚠️ Hostinger falhou:', error.message);
      }

      Logger.log('❌ Localização não encontrada em nenhuma fonte');
      return null;

    } catch (error) {
      Logger.error('❌ Erro ao resolver localização:', error);
      throw error;
    }
  }

  /**
   * Resolve localização via Vultr
   */
  async resolveFromVultr(query, coordinates, context) {
    try {
      const params = new URLSearchParams();
      
      if (query) params.append('query', query);
      if (coordinates?.lat) params.append('lat', coordinates.lat);
      if (coordinates?.lng) params.append('lng', coordinates.lng);
      if (context) params.append('context', context);

      const response = await fetch(`${this.vultrUrl}/api/location/resolve?${params}`, {
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
      Logger.error('❌ Erro ao resolver via Vultr:', error);
      throw error;
    }
  }

  /**
   * Resolve localização via Hostinger (fallback)
   */
  async resolveFromHostinger(query, coordinates, context) {
    try {
      // TODO: Implementar integração com Hostinger
      // Por enquanto, retorna null para forçar Google Places
      Logger.log('🔄 Hostinger não implementado ainda');
      return null;
    } catch (error) {
      Logger.error('❌ Erro ao resolver via Hostinger:', error);
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

      // 1. Tentar Vultr primeiro (com timeout agressivo de 2s)
      try {
        Logger.log('🚀 Tentando Vultr (timeout: 2s)...');
        const vultrSuggestions = await this.getSuggestionsFromVultr(query, context);
        if (vultrSuggestions && vultrSuggestions.length > 0) {
          Logger.log('✅ Sugestões obtidas via Vultr:', vultrSuggestions.length);
          return vultrSuggestions;
        }
        Logger.log('⚠️ Vultr retornou vazio');
      } catch (error) {
        Logger.warn('⚠️ Vultr falhou para sugestões:', error.message);
      }

      // 2. Fallback imediato para Google Places (sem esperar Hostinger)
      Logger.log('🔄 Vultr falhou, retornando vazio para forçar Google Places');
      return [];

    } catch (error) {
      Logger.error('❌ Erro ao buscar sugestões:', error);
      return [];
    }
  }

  /**
   * Busca sugestões via Vultr
   */
  async getSuggestionsFromVultr(query, context) {
    try {
      const params = new URLSearchParams({
        query: query,
        context: context || 'passenger'
      });

      const url = `${this.vultrUrl}/api/location/suggestions?${params}`;
      Logger.log('🌐 Chamando API Vultr:', url);

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
        Logger.warn('⏰ Timeout ao buscar sugestões via Vultr (2s)');
      } else {
        Logger.error('❌ Erro ao buscar sugestões via Vultr:', error);
      }
      throw error;
    }
  }

  /**
   * Busca sugestões via Hostinger
   */
  async getSuggestionsFromHostinger(query, context) {
    try {
      // TODO: Implementar integração com Hostinger
      Logger.log('🔄 Hostinger não implementado ainda');
      return [];
    } catch (error) {
      Logger.error('❌ Erro ao buscar sugestões via Hostinger:', error);
      throw error;
    }
  }

  /**
   * Obtém estatísticas do serviço
   */
  async getStats() {
    try {
      const response = await fetch(`${this.vultrUrl}/api/location/stats`, {
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
      const response = await fetch(`${this.vultrUrl}/api/location/cache/clear`, {
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
      vultr: false,
      hostinger: false,
      timestamp: new Date().toISOString()
    };

    // Testar Vultr
    try {
      const response = await fetch(`${this.vultrUrl}/health`, {
        method: 'GET',
        timeout: 5000,
      });
      results.vultr = response.ok;
      Logger.log('✅ Vultr conectado:', response.ok);
    } catch (error) {
      Logger.log('❌ Vultr não conectado:', error.message);
    }

    // Testar Hostinger
    try {
      // TODO: Implementar teste de conectividade com Hostinger
      results.hostinger = false;
      Logger.log('⚠️ Hostinger não testado ainda');
    } catch (error) {
      Logger.log('❌ Hostinger não conectado:', error.message);
    }

    return results;
  }

  /**
   * Obtém informações de conectividade
   */
  getConnectivityInfo() {
    return {
      vultr: {
        url: this.vultrUrl,
        status: 'active',
        description: 'Servidor principal (Vultr)'
      },
      hostinger: {
        url: this.hostingerUrl,
        status: 'pending',
        description: 'Servidor de fallback (Hostinger)'
      }
    };
  }

  /**
   * Obtém sugestões do cache Redis
   */
  async getSuggestionsFromRedis(query) {
    try {
      Logger.log('🔍 Buscando sugestões no Redis:', query);
      
      const response = await fetch(`${this.vultrUrl}/api/location/suggestions/redis?query=${encodeURIComponent(query)}`, {
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
      
      const response = await fetch(`${this.vultrUrl}/api/location/suggestions/firebase?query=${encodeURIComponent(query)}`, {
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
      
      const response = await fetch(`${this.vultrUrl}/api/location/cache/save`, {
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