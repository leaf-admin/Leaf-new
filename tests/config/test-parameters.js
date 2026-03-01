/**
 * CONFIGURAÇÃO DE PARÂMETROS PARA TESTES AUTOMATIZADOS
 * Baseado em PARAMETROS_DEFINIDOS.md
 */

module.exports = {
    // ⏱️ TIMEOUTS
    TIMEOUTS: {
        RIDE_REQUEST_TIMEOUT: 15, // segundos
        RIDE_REQUEST_EXPAND_TIMEOUT: 60, // segundos
        NO_SHOW_TIMEOUT_DRIVER: 2 * 60, // minutos -> segundos
        NO_SHOW_TIMEOUT_CUSTOMER: 2 * 60, // minutos -> segundos
        PAYMENT_PIX_TIMEOUT: 5 * 60, // minutos -> segundos
        WEBSOCKET_RECONNECT_TIMEOUT: 5, // segundos
        GPS_UPDATE_INTERVAL: 2, // segundos
        HEARTBEAT_INTERVAL: 30, // segundos
        HEARTBEAT_TIMEOUT_AVAILABLE: 5 * 60, // minutos -> segundos
        HEARTBEAT_TIMEOUT_IN_TRIP: null, // NUNCA (durante corrida, não muda status)
        REASSIGN_DELAY: 5, // segundos
        ALERT_BEFORE_TIMEOUT: 5, // segundos (feedback visual)
    },

    // 📏 RAIOS E DISTÂNCIAS
    RADIUS: {
        DRIVER_SEARCH_RADIUS_INITIAL: 3, // km
        DRIVER_SEARCH_RADIUS_EXPAND: 5, // km
        PICKUP_PROXIMITY_RADIUS: 50, // metros
        LOCATION_ACCURACY_THRESHOLD: 50, // metros
    },

    // 💰 VALORES E LIMITES
    FARES: {
        MINIMUM_FARE: 8.50, // R$
        MAXIMUM_FARE: null, // Não existe
        FARE_DIVERGENCE_THRESHOLD: 0, // ZERO TOLERÂNCIA (estimativa = final exato)
        CANCEL_FEE_DRIVER: 4.90, // R$
        NO_SHOW_FEE: 2.90, // R$
        CANCEL_FEE_CUSTOMER_WINDOW: 2 * 60, // segundos (até 2 min após aceitar = sem taxa)
        CANCEL_FEE_CUSTOMER_AFTER: 0.80, // R$ (taxa adicional após 2 min)
    },

    // 🎯 REGRAS DE NEGÓCIO
    BUSINESS_RULES: {
        MAX_RECUSAS_DRIVER: 10, // recusas consecutivas
        MAX_CANCELAMENTOS_DRIVER: 5, // cancelamentos (apenas alerta, sem bloqueio)
        MAX_CANCELAMENTOS_CUSTOMER: null, // Indefinido (sem limite)
        REASSIGN_MAX_ATTEMPTS: Infinity, // Infinito (até customer cancelar)
        RATING_MIN_STARS: 4, // estrelas (notificação para suporte)
    },

    // 🔔 NOTIFICAÇÕES
    NOTIFICATIONS: {
        SOUND_ENABLED: true,
        VIBRATION_ENABLED: true,
        ALERT_BEFORE_TIMEOUT: 5, // segundos
    },

    // 💰 TARIFAS POR TIPO DE VEÍCULO
    VEHICLE_TYPES: {
        'Leaf Plus': {
            min_fare: 8.50,
            base_fare: 3.13,
            rate_per_km: 1.42,
            rate_per_hour: 16.20,
            rate_per_minute: 0.27, // calculado: 16.20/60
        },
        'Leaf Elite': {
            min_fare: 11.50,
            base_fare: 5.59,
            rate_per_km: 2.29,
            rate_per_hour: 18.00,
            rate_per_minute: 0.30, // calculado: 18.00/60
        },
    },

    // 📋 POLÍTICAS
    POLICIES: {
        STATUS_INITIAL: 'offline', // Motorista começa offline
        STATUS_AUTO_AFTER_TRIP: true, // Volta para available após completar corrida
        SESSION_SIMULTANEA_BLOCKED: true, // Bloqueado para driver e customer
        BALANCE_RETENTION_DEFAULT: 30 * 60, // segundos (30 minutos)
        BALANCE_RETENTION_LOW_RATING: 2 * 60 * 60, // segundos (2 horas se avaliação 1 estrela)
        DISPUTE_ANALYSIS_TIMEOUT: 24 * 60 * 60, // segundos (24 horas)
    },

    // 🌐 CONFIGURAÇÕES DE SERVIDOR E WEBSOCKET
    SERVER: {
        // Substituir pelos valores reais
        WS_URL: process.env.WS_URL || 'ws://localhost:3001',
        API_URL: process.env.API_URL || 'http://localhost:3001',
        TEST_DRIVER_ID: process.env.TEST_DRIVER_ID || 'test-driver-001',
        TEST_CUSTOMER_ID: process.env.TEST_CUSTOMER_ID || 'test-customer-001',
    },

    // 📍 COORDENADAS DE TESTE (Niterói, RJ)
    TEST_LOCATIONS: {
        PICKUP_ICARAI: {
            lat: -22.9068,
            lng: -43.1234,
            address: 'Praia de Icaraí, Niterói, RJ',
        },
        DESTINATION_CENTRO: {
            lat: -22.9,
            lng: -43.13,
            address: 'Centro, Niterói, RJ',
        },
        PICKUP_SAO_FRANCISCO: {
            lat: -22.9150,
            lng: -43.1080,
            address: 'São Francisco, Niterói, RJ',
        },
        DESTINATION_JURUJUBA: {
            lat: -22.9500,
            lng: -43.1100,
            address: 'Jurujuba, Niterói, RJ',
        },
    },
};



