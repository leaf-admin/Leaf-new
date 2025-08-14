class LocationIntelligenceService {
    constructor() {
        this.vultrUrl = 'http://216.238.107.59:3001';
        this.hostingerUrl = 'https://leaf-app.web.app'; // Placeholder
        this.timeout = 1000; // 1 segundo
    }

    static getInstance() {
        if (!LocationIntelligenceService.instance) {
            LocationIntelligenceService.instance = new LocationIntelligenceService();
        }
        return LocationIntelligenceService.instance;
    }

    // Função para fazer requisições HTTP com timeout
    async makeRequest(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                throw new Error('Timeout: Requisição demorou muito para responder');
            }
            
            throw error;
        }
    }

    // Resolver localização
    async resolveLocation(query) {
        try {
            console.log('🧠 Resolvendo localização:', query);
            
            const response = await this.makeRequest(
                `${this.vultrUrl}/api/location/resolve`,
                {
                    method: 'POST',
                    body: JSON.stringify({ query })
                }
            );

            console.log('✅ Localização resolvida:', response);
            return response;
        } catch (error) {
            console.error('❌ Erro ao resolver localização:', error);
            
            // Fallback para Hostinger se Vultr falhar
            try {
                console.log('🔄 Tentando fallback para Hostinger...');
                const fallbackResponse = await this.makeRequest(
                    `${this.hostingerUrl}/api/location/resolve`,
                    {
                        method: 'POST',
                        body: JSON.stringify({ query })
                    }
                );
                
                console.log('✅ Fallback bem-sucedido:', fallbackResponse);
                return fallbackResponse;
            } catch (fallbackError) {
                console.error('❌ Fallback também falhou:', fallbackError);
                throw new Error('Não foi possível resolver a localização');
            }
        }
    }

    // Obter sugestões inteligentes
    async getSmartSuggestions(query) {
        try {
            console.log('🧠 Obtendo sugestões inteligentes:', query);
            
            const response = await this.makeRequest(
                `${this.vultrUrl}/api/location/suggestions`,
                {
                    method: 'POST',
                    body: JSON.stringify({ query })
                }
            );

            console.log('✅ Sugestões obtidas:', response);
            return response.suggestions || [];
        } catch (error) {
            console.error('❌ Erro ao obter sugestões:', error);
            
            // Fallback para Hostinger
            try {
                console.log('🔄 Tentando fallback para Hostinger...');
                const fallbackResponse = await this.makeRequest(
                    `${this.hostingerUrl}/api/location/suggestions`,
                    {
                        method: 'POST',
                        body: JSON.stringify({ query })
                    }
                );
                
                console.log('✅ Fallback bem-sucedido:', fallbackResponse);
                return fallbackResponse.suggestions || [];
            } catch (fallbackError) {
                console.error('❌ Fallback também falhou:', fallbackError);
                
                // Fallback local com sugestões básicas
                console.log('🔄 Usando fallback local...');
                return this.getLocalFallbackSuggestions(query);
            }
        }
    }

    // Obter sugestões do Redis
    async getSuggestionsFromRedis(query) {
        try {
            console.log('🔴 Buscando no Redis:', query);
            
            const response = await this.makeRequest(
                `${this.vultrUrl}/api/location/suggestions/redis`,
                {
                    method: 'POST',
                    body: JSON.stringify({ query })
                }
            );

            if (response.success && response.suggestions && response.suggestions.length > 0) {
                console.log('✅ Sugestões do Redis:', response.suggestions.length);
                return response.suggestions;
            }
            
            console.log('❌ Redis vazio ou falhou');
            return null;
        } catch (error) {
            console.error('❌ Erro ao buscar no Redis:', error);
            return null;
        }
    }

    // Obter sugestões do Firebase
    async getSuggestionsFromFirebase(query) {
        try {
            console.log('🔥 Buscando no Firebase:', query);
            
            const response = await this.makeRequest(
                `${this.vultrUrl}/api/location/suggestions/firebase`,
                {
                    method: 'POST',
                    body: JSON.stringify({ query })
                }
            );

            if (response.success && response.suggestions && response.suggestions.length > 0) {
                console.log('✅ Sugestões do Firebase:', response.suggestions.length);
                return response.suggestions;
            }
            
            console.log('❌ Firebase vazio ou falhou');
            return null;
        } catch (error) {
            console.error('❌ Erro ao buscar no Firebase:', error);
            return null;
        }
    }

    // Salvar sugestões no cache
    async cacheSuggestions(query, suggestions, source) {
        try {
            console.log('💾 Salvando no cache:', query, source, suggestions.length);
            
            const response = await this.makeRequest(
                `${this.vultrUrl}/api/location/cache`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        query,
                        suggestions,
                        source,
                        timestamp: Date.now()
                    })
                }
            );

            if (response.success) {
                console.log('✅ Sugestões salvas no cache');
                return true;
            } else {
                console.warn('⚠️ Falha ao salvar no cache:', response.message);
                return false;
            }
        } catch (error) {
            console.error('❌ Erro ao salvar no cache:', error);
            return false;
        }
    }

    // Testar conectividade
    async testConnectivity() {
        const results = {
            vultr: false,
            hostinger: false
        };

        try {
            // Testar Vultr
            const vultrResponse = await this.makeRequest(
                `${this.vultrUrl}/api/location/stats`,
                { method: 'GET' }
            );
            results.vultr = vultrResponse.success || false;
            console.log('✅ Vultr conectado:', results.vultr);
        } catch (error) {
            console.log('❌ Vultr não conectado:', error.message);
        }

        try {
            // Testar Hostinger
            const hostingerResponse = await this.makeRequest(
                `${this.hostingerUrl}/api/location/stats`,
                { method: 'GET' }
            );
            results.hostinger = hostingerResponse.success || false;
            console.log('✅ Hostinger conectado:', results.hostinger);
        } catch (error) {
            console.log('❌ Hostinger não conectado:', error.message);
        }

        return results;
    }

    // Obter estatísticas
    async getStats() {
        try {
            console.log('📊 Obtendo estatísticas...');
            
            const response = await this.makeRequest(
                `${this.vultrUrl}/api/location/stats`,
                { method: 'GET' }
            );

            console.log('✅ Estatísticas obtidas:', response);
            return response;
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas:', error);
            
            // Fallback para Hostinger
            try {
                const fallbackResponse = await this.makeRequest(
                    `${this.hostingerUrl}/api/location/stats`,
                    { method: 'GET' }
                );
                
                return fallbackResponse;
            } catch (fallbackError) {
                console.error('❌ Fallback também falhou:', fallbackError);
                return {
                    success: false,
                    message: 'Não foi possível obter estatísticas',
                    redisKeys: 0,
                    firebaseDocs: 0,
                    totalQueries: 0
                };
            }
        }
    }

    // Limpar cache
    async clearCache() {
        try {
            console.log('🗑️ Limpando cache...');
            
            const response = await this.makeRequest(
                `${this.vultrUrl}/api/location/cache/clear`,
                { method: 'POST' }
            );

            console.log('✅ Cache limpo:', response);
            return response;
        } catch (error) {
            console.error('❌ Erro ao limpar cache:', error);
            throw error;
        }
    }

    // Fallback local com sugestões básicas
    getLocalFallbackSuggestions(query) {
        console.log('🏠 Usando sugestões locais para:', query);
        
        // Sugestões básicas baseadas no query
        const suggestions = [
            {
                id: 'local_1',
                address: `${query}, Centro`,
                description: `${query}, Centro, Rio de Janeiro`,
                lat: -22.9068,
                lng: -43.1729,
                source: 'local_fallback'
            },
            {
                id: 'local_2',
                address: `${query}, Copacabana`,
                description: `${query}, Copacabana, Rio de Janeiro`,
                lat: -22.9707,
                lng: -43.1824,
                source: 'local_fallback'
            }
        ];

        return suggestions;
    }
}

export default LocationIntelligenceService; 