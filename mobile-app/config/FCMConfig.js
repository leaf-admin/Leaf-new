// Configurações FCM para o projeto Leaf
export const FCMConfig = {
    // Caminho para o arquivo de service account existente
    SERVICE_ACCOUNT_PATH: './config/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json',
    
    // ID do projeto Firebase
    PROJECT_ID: 'leaf-reactnative',
    
    // Configurações de notificação padrão
    DEFAULT_NOTIFICATION: {
        sound: 'default',
        priority: 'high',
        channelId: 'default',
        icon: 'ic_launcher',
        color: '#4CAF50'
    },
    
    // Canais de notificação para Android
    NOTIFICATION_CHANNELS: {
        default: {
            id: 'default',
            name: 'Notificações Gerais',
            description: 'Canal para notificações gerais do app',
            importance: 'high',
            sound: 'default',
            vibration: true,
            light: true
        },
        trip_updates: {
            id: 'trip_updates',
            name: 'Atualizações de Viagem',
            description: 'Notificações sobre o status da sua viagem',
            importance: 'high',
            sound: 'default',
            vibration: true,
            light: true
        },
        payments: {
            id: 'payments',
            name: 'Pagamentos',
            description: 'Notificações sobre pagamentos e transações',
            importance: 'high',
            sound: 'default',
            vibration: true,
            light: true
        },
        ratings: {
            id: 'ratings',
            name: 'Avaliações',
            description: 'Notificações sobre avaliações recebidas',
            importance: 'normal',
            sound: 'default',
            vibration: false,
            light: false
        },
        promos: {
            id: 'promos',
            name: 'Promoções',
            description: 'Ofertas especiais e promoções',
            importance: 'normal',
            sound: 'default',
            vibration: false,
            light: false
        }
    },
    
    // Configurações de retry para envio de notificações
    RETRY_CONFIG: {
        maxRetries: 3,
        retryDelay: 1000, // 1 segundo
        backoffMultiplier: 2
    },
    
    // Configurações de rate limiting
    RATE_LIMIT: {
        maxNotificationsPerMinute: 60,
        maxNotificationsPerHour: 1000,
        maxNotificationsPerDay: 10000
    },
    
    // Configurações de tópicos
    TOPICS: {
        ALL_USERS: 'all_users',
        DRIVERS: 'drivers',
        PASSENGERS: 'passengers',
        PREMIUM_USERS: 'premium_users',
        BETA_TESTERS: 'beta_testers'
    },
    
    // Configurações de payload máximo
    MAX_PAYLOAD_SIZE: 4096, // 4KB
    
    // Configurações de tempo de vida das notificações
    TTL: {
        default: 2419200, // 28 dias em segundos
        urgent: 86400,    // 1 dia em segundos
        immediate: 3600   // 1 hora em segundos
    },
    
    // Configurações de prioridade
    PRIORITIES: {
        URGENT: 'urgent',
        HIGH: 'high',
        NORMAL: 'normal',
        LOW: 'low'
    },
    
    // Configurações de som
    SOUNDS: {
        DEFAULT: 'default',
        NOTIFICATION: 'notification',
        ALARM: 'alarm',
        RINGTONE: 'ringtone'
    },
    
    // Configurações de badge
    BADGE: {
        ENABLED: true,
        MAX_COUNT: 99,
        CLEAR_ON_OPEN: true
    }
};

// Função para validar configuração FCM
export const validateFCMConfig = () => {
    const errors = [];
    
    if (!FCMConfig.SERVICE_ACCOUNT_PATH) {
        errors.push('SERVICE_ACCOUNT_PATH não configurado');
    }
    
    if (!FCMConfig.PROJECT_ID) {
        errors.push('PROJECT_ID não configurado');
    }
    
    if (errors.length > 0) {
        console.error('❌ Erros na configuração FCM:', errors);
        return false;
    }
    
    console.log('✅ Configuração FCM válida');
    return true;
};

// Função para obter configuração baseada no ambiente
export const getFCMConfigForEnvironment = (environment = 'development') => {
    switch (environment) {
        case 'production':
            return {
                ...FCMConfig,
                RETRY_CONFIG: {
                    ...FCMConfig.RETRY_CONFIG,
                    maxRetries: 5,
                    retryDelay: 2000
                },
                RATE_LIMIT: {
                    ...FCMConfig.RATE_LIMIT,
                    maxNotificationsPerMinute: 120,
                    maxNotificationsPerHour: 2000,
                    maxNotificationsPerDay: 20000
                }
            };
            
        case 'staging':
            return {
                ...FCMConfig,
                RETRY_CONFIG: {
                    ...FCMConfig.RETRY_CONFIG,
                    maxRetries: 3,
                    retryDelay: 1500
                }
            };
            
        default: // development
            return {
                ...FCMConfig,
                RETRY_CONFIG: {
                    ...FCMConfig.RETRY_CONFIG,
                    maxRetries: 1,
                    retryDelay: 500
                },
                RATE_LIMIT: {
                    ...FCMConfig.RATE_LIMIT,
                    maxNotificationsPerMinute: 30,
                    maxNotificationsPerHour: 500,
                    maxNotificationsPerDay: 5000
                }
            };
    }
};

export default FCMConfig;
