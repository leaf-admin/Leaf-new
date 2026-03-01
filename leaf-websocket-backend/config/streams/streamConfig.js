/**
 * StreamConfig - Configurações para Redis Streams
 * 
 * Este arquivo contém todas as configurações necessárias para o sistema
 * de Redis Streams, incluindo definições de streams, consumers, e políticas.
 */

module.exports = {
  // Configurações gerais
  general: {
    enabled: true,
    debug: process.env.NODE_ENV === 'development',
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 30000
  },

  // Configurações do Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: process.env.REDIS_DB || 0,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    lazyConnect: true
  },

  // Definições de streams
  streams: {
    // Stream para matching de motoristas
    'driver:matching': {
      name: 'driver:matching',
      description: 'Stream para processamento de matching de motoristas',
      maxLength: 10000,
      retention: 3600000, // 1 hora
      priority: 'high',
      fields: ['customerId', 'location', 'timestamp', 'priority'],
      consumers: {
        'matching-consumer-1': {
          group: 'matching-group',
          batchSize: 10,
          blockTime: 1000,
          autoAck: false
        }
      }
    },

    // Stream para atualizações de status de corridas
    'ride:status': {
      name: 'ride:status',
      description: 'Stream para atualizações de status de corridas',
      maxLength: 5000,
      retention: 7200000, // 2 horas
      priority: 'high',
      fields: ['rideId', 'status', 'driverId', 'customerId', 'timestamp'],
      consumers: {
        'status-consumer-1': {
          group: 'status-group',
          batchSize: 5,
          blockTime: 500,
          autoAck: false
        }
      }
    },

    // Stream para notificações push
    'notifications:push': {
      name: 'notifications:push',
      description: 'Stream para notificações push',
      maxLength: 20000,
      retention: 1800000, // 30 minutos
      priority: 'medium',
      fields: ['userId', 'type', 'message', 'data', 'timestamp'],
      consumers: {
        'push-consumer-1': {
          group: 'push-group',
          batchSize: 20,
          blockTime: 2000,
          autoAck: true
        }
      }
    },

    // Stream para analytics e eventos
    'analytics:events': {
      name: 'analytics:events',
      description: 'Stream para eventos de analytics',
      maxLength: 50000,
      retention: 86400000, // 24 horas
      priority: 'low',
      fields: ['event', 'userId', 'data', 'timestamp'],
      consumers: {
        'analytics-consumer-1': {
          group: 'analytics-group',
          batchSize: 50,
          blockTime: 5000,
          autoAck: true
        }
      }
    },

    // Stream para atualizações de localização
    'driver:location': {
      name: 'driver:location',
      description: 'Stream para atualizações de localização de motoristas',
      maxLength: 1000,
      retention: 300000, // 5 minutos
      priority: 'medium',
      fields: ['driverId', 'location', 'status', 'timestamp'],
      consumers: {
        'location-consumer-1': {
          group: 'location-group',
          batchSize: 100,
          blockTime: 1000,
          autoAck: true
        }
      }
    }
  },

  // Configurações de consumers
  consumers: {
    default: {
      group: 'default-group',
      batchSize: 10,
      blockTime: 1000,
      autoAck: false,
      maxRetries: 3,
      retryDelay: 1000
    },
    
    highPriority: {
      group: 'high-priority-group',
      batchSize: 5,
      blockTime: 500,
      autoAck: false,
      maxRetries: 5,
      retryDelay: 500
    },
    
    lowPriority: {
      group: 'low-priority-group',
      batchSize: 50,
      blockTime: 5000,
      autoAck: true,
      maxRetries: 1,
      retryDelay: 2000
    }
  },

  // Configurações de fallback
  fallback: {
    enabled: true,
    timeout: 5000,
    maxRetries: 3,
    retryDelay: 1000,
    services: {
      matching: {
        enabled: true,
        timeout: 30000,
        maxRetries: 2
      },
      status: {
        enabled: true,
        timeout: 10000,
        maxRetries: 3
      },
      notifications: {
        enabled: true,
        timeout: 5000,
        maxRetries: 1
      }
    }
  },

  // Configurações de monitoramento
  monitoring: {
    enabled: true,
    healthCheckInterval: 5000,
    metricsInterval: 30000,
    alertThresholds: {
      failureRate: 10, // 10% de falha
      latency: 5000,   // 5 segundos
      queueSize: 1000  // 1000 mensagens na fila
    }
  },

  // Configurações de sincronização
  synchronization: {
    enabled: true,
    syncInterval: 30000,
    maxAge: 300000,
    staleThreshold: 60000,
    conflictResolution: 'database_wins', // database_wins, redis_wins, latest_wins
    entities: [
      {
        name: 'rides',
        primaryKey: 'id',
        syncFields: ['status', 'driverId', 'customerId', 'location', 'timestamp'],
        conflictFields: ['status', 'location'],
        ttl: 3600000
      },
      {
        name: 'matching_requests',
        primaryKey: 'id',
        syncFields: ['status', 'driverId', 'customerId', 'location', 'timestamp'],
        conflictFields: ['status'],
        ttl: 1800000
      },
      {
        name: 'driver_locations',
        primaryKey: 'driverId',
        syncFields: ['location', 'status', 'timestamp'],
        conflictFields: ['location'],
        ttl: 300000
      }
    ]
  },

  // Configurações de circuit breaker
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    timeout: 60000,
    resetTimeout: 30000,
    successThreshold: 3,
    services: {
      redis: {
        failureThreshold: 3,
        timeout: 30000,
        resetTimeout: 15000
      },
      database: {
        failureThreshold: 5,
        timeout: 60000,
        resetTimeout: 30000
      }
    }
  },

  // Configurações de logging
  logging: {
    enabled: true,
    level: process.env.LOG_LEVEL || 'info',
    format: 'json',
    fields: ['timestamp', 'level', 'service', 'message', 'data'],
    streams: {
      console: {
        enabled: true,
        level: 'info'
      },
      file: {
        enabled: false,
        level: 'debug',
        filename: 'streams.log',
        maxSize: '10MB',
        maxFiles: 5
      }
    }
  },

  // Configurações de desenvolvimento
  development: {
    mockRedis: false,
    mockDatabase: false,
    simulateLatency: true,
    simulateFailures: false,
    debugMode: true
  },

  // Configurações de produção
  production: {
    mockRedis: false,
    mockDatabase: false,
    simulateLatency: false,
    simulateFailures: false,
    debugMode: false,
    monitoring: {
      enabled: true,
      metrics: true,
      alerts: true
    }
  }
};
