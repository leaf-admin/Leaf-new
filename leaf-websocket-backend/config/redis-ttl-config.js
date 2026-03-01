/**
 * Configuração de TTLs para Redis
 * 
 * Arquitetura:
 * - Redis: dados voláteis com TTL curto (minutos)
 *   - Geolocalização (GEOADD, GEORADIUS)
 *   - Estado da corrida (corrida ativa, motorista disponível/ocupado)
 *   - Tempo real (WebSocket, presença, heartbeat)
 * - Firestore: dados finais e persistentes apenas
 *   - Início/fim da corrida
 *   - Valor final
 *   - Motorista/passageiro
 *   - Logs básicos
 * 
 * TTLs baseados em frequência de atualização:
 * - Dados que mudam rápido (a cada 5s): TTL curto (60-120s)
 * - Dados que mudam raramente: TTL médio (300-600s)
 * - Dados temporários: TTL muito curto (20-60s)
 */

const TTL_CONFIG = {
    // ============================================
    // DADOS DE GEOLOCALIZAÇÃO (atualiza a cada 5s)
    // ============================================
    DRIVER_LOCATION: {
        ONLINE: 120,        // 2 minutos (atualiza a cada 5s, margem de 24x)
        IN_TRIP: 60,        // 1 minuto (atualiza a cada 5s, margem de 12x)
        OFFLINE: 86400,     // 24 horas (para notificações futuras)
        description: 'Localização do motorista - TTL curto pois atualiza frequentemente'
    },
    
    // ============================================
    // ESTADO DA CORRIDA (muda durante a corrida)
    // ============================================
    RIDE_STATE: {
        SEARCHING: 300,     // 5 minutos (corrida em busca)
        MATCHED: 600,       // 10 minutos (corrida aceita, aguardando início)
        IN_PROGRESS: 3600,  // 1 hora (corrida em andamento)
        description: 'Estado da corrida - TTL baseado no tempo médio de cada estado'
    },
    
    RIDE_REQUEST: {
        ACTIVE: 300,        // 5 minutos (corrida ativa)
        EXPIRED: 0,         // Expira imediatamente quando expirada
        description: 'Requisição de corrida - TTL curto pois é temporário'
    },
    
    // ============================================
    // LOCKS E LOCKS DISTRIBUÍDOS (muito curto)
    // ============================================
    DRIVER_LOCK: {
        DEFAULT: 20,        // 20 segundos (lock de corrida)
        EXTENDED: 60,       // 1 minuto (lock estendido)
        description: 'Lock de motorista - TTL muito curto para evitar deadlocks'
    },
    
    BOOKING_LOCK: {
        DEFAULT: 30,        // 30 segundos (lock de booking)
        description: 'Lock de booking - TTL curto para evitar conflitos'
    },
    
    // ============================================
    // PRESENÇA E HEARTBEAT (atualiza a cada 30s)
    // ============================================
    PRESENCE: {
        ONLINE: 90,         // 1.5 minutos (heartbeat a cada 30s, margem de 3x)
        OFFLINE: 0,         // Remove imediatamente quando offline
        description: 'Presença do usuário - TTL curto baseado em heartbeat'
    },
    
    HEARTBEAT: {
        DRIVER: 90,         // 1.5 minutos (heartbeat a cada 30s)
        CUSTOMER: 90,      // 1.5 minutos (heartbeat a cada 30s)
        description: 'Heartbeat - TTL curto para detectar desconexões rapidamente'
    },
    
    // ============================================
    // CACHE DE DADOS (TTL médio)
    // ============================================
    CACHE: {
        USER_PROFILE: 600,      // 10 minutos (dados raramente mudam)
        VEHICLE_INFO: 1800,     // 30 minutos (dados raramente mudam)
        NEARBY_DRIVERS: 30,     // 30 segundos (dados mudam frequentemente)
        ROUTE_CACHE: 300,       // 5 minutos (rotas mudam com trânsito)
        description: 'Cache de dados - TTL baseado em frequência de mudança'
    },
    
    // ============================================
    // NOTIFICAÇÕES E FILAS (temporário)
    // ============================================
    NOTIFICATION: {
        SENT: 300,          // 5 minutos (notificação enviada)
        PENDING: 60,        // 1 minuto (notificação pendente)
        description: 'Notificações - TTL curto pois são temporárias'
    },
    
    QUEUE: {
        PENDING: 600,       // 10 minutos (fila pendente)
        ACTIVE: 3600,       // 1 hora (fila ativa)
        description: 'Filas - TTL baseado no tempo médio de processamento'
    },
    
    // ============================================
    // MÉTRICAS E ESTATÍSTICAS (TTL longo)
    // ============================================
    METRICS: {
        REAL_TIME: 60,      // 1 minuto (métricas em tempo real)
        HOURLY: 3600,       // 1 hora (métricas por hora)
        DAILY: 86400,       // 24 horas (métricas diárias)
        description: 'Métricas - TTL baseado no período de agregação'
    },
    
    // ============================================
    // DADOS TEMPORÁRIOS (TTL muito curto)
    // ============================================
    TEMP: {
        SESSION: 300,       // 5 minutos (sessão temporária)
        TOKEN: 600,          // 10 minutos (token temporário)
        RATE_LIMIT: 60,      // 1 minuto (rate limit)
        description: 'Dados temporários - TTL muito curto pois são efêmeros'
    }
};

/**
 * Obter TTL baseado no tipo e estado
 * @param {string} type - Tipo de dado (ex: 'DRIVER_LOCATION', 'RIDE_STATE')
 * @param {string} state - Estado (ex: 'ONLINE', 'IN_TRIP', 'SEARCHING')
 * @returns {number} TTL em segundos
 */
function getTTL(type, state = 'DEFAULT') {
    const config = TTL_CONFIG[type];
    if (!config) {
        console.warn(`⚠️ [TTL] Tipo não encontrado: ${type}, usando TTL padrão de 300s`);
        return 300; // TTL padrão de 5 minutos
    }
    
    if (typeof config === 'object' && config[state] !== undefined) {
        return config[state];
    }
    
    // Se for objeto mas não tiver o estado, retornar o primeiro valor numérico
    if (typeof config === 'object') {
        const values = Object.values(config).filter(v => typeof v === 'number');
        if (values.length > 0) {
            return values[0];
        }
    }
    
    // Se for número direto, retornar
    if (typeof config === 'number') {
        return config;
    }
    
    console.warn(`⚠️ [TTL] Estado não encontrado: ${type}.${state}, usando TTL padrão de 300s`);
    return 300; // TTL padrão de 5 minutos
}

/**
 * Obter descrição do TTL
 * @param {string} type - Tipo de dado
 * @returns {string} Descrição
 */
function getTTLDescription(type) {
    const config = TTL_CONFIG[type];
    if (!config) {
        return 'TTL padrão não configurado';
    }
    
    if (typeof config === 'object' && config.description) {
        return config.description;
    }
    
    return `TTL para ${type}`;
}

module.exports = {
    TTL_CONFIG,
    getTTL,
    getTTLDescription
};

