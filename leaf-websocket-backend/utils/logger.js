const winston = require('winston');
const path = require('path');
const traceContext = require('./trace-context');

// Configuração de cores para diferentes níveis
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  verbose: 'cyan'
};

winston.addColors(colors);

// Formato personalizado para logs estruturados (padrão Uber/99)
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    // Adicionar traceId automaticamente se não estiver presente
    if (!info.traceId) {
      const currentTraceId = traceContext.getCurrentTraceId();
      if (currentTraceId) {
        info.traceId = currentTraceId;
      }
    }
    
    // Estruturar log no formato JSON (para parsing)
    info.service = info.service || 'leaf-websocket-backend';
    info.timestamp = info.timestamp || Date.now();
    
    return info;
  })(),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, traceId, service, latency_ms, ...meta }) => {
    // Formato legível para console
    const traceStr = traceId ? `[traceId:${traceId}]` : '';
    const latencyStr = latency_ms ? `[${latency_ms}ms]` : '';
    let log = `${timestamp} [${level.toUpperCase()}] ${traceStr} ${latencyStr} ${message}`;
    
    // Adicionar metadados relevantes (sem payload completo)
    const relevantMeta = {};
    if (meta.rideId) relevantMeta.rideId = meta.rideId;
    if (meta.bookingId) relevantMeta.bookingId = meta.bookingId;
    if (meta.driverId) relevantMeta.driverId = meta.driverId;
    if (meta.customerId) relevantMeta.customerId = meta.customerId;
    if (meta.eventType) relevantMeta.eventType = meta.eventType;
    if (meta.command) relevantMeta.command = meta.command;
    if (meta.listener) relevantMeta.listener = meta.listener;
    
    if (Object.keys(relevantMeta).length > 0) {
      log += ` ${JSON.stringify(relevantMeta)}`;
    }
    
    return log;
  })
);

// Configuração dos transportes
const transports = [
  // Console para desenvolvimento
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat
    ),
    level: process.env.LOG_LEVEL || 'info'
  }),
  
  // Arquivo para logs de erro
  new winston.transports.File({
    filename: path.join(__dirname, '../logs/error.log'),
    level: 'error',
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }),
  
  // Arquivo para todos os logs
  new winston.transports.File({
    filename: path.join(__dirname, '../logs/combined.log'),
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 10
  }),
  
  // Arquivo específico para WebSocket
  new winston.transports.File({
    filename: path.join(__dirname, '../logs/websocket.log'),
    level: 'info',
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }),
  
  // Arquivo específico para Redis
  new winston.transports.File({
    filename: path.join(__dirname, '../logs/redis.log'),
    level: 'info',
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  })
];

// Criar logger principal
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports,
  exitOnError: false
});

// Loggers específicos
const websocketLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/websocket.log'),
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [WEBSOCKET-${level.toUpperCase()}]: ${message}`;
        })
      )
    })
  ]
});

const redisLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/redis.log'),
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [REDIS-${level.toUpperCase()}]: ${message}`;
        })
      )
    })
  ]
});

const securityLogger = winston.createLogger({
  level: 'warn',
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/security.log'),
      maxsize: 5242880,
      maxFiles: 10
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [SECURITY-${level.toUpperCase()}]: ${message}`;
        })
      )
    })
  ]
});

// Funções de logging específicas
const logWebSocket = (level, message, meta = {}) => {
  websocketLogger.log(level, message, {
    service: 'websocket',
    ...meta
  });
};

const logRedis = (level, message, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  redisLogger.log(level, message, {
    service: 'redis',
    traceId,
    ...meta
  });
};

const logSecurity = (level, message, meta = {}) => {
  securityLogger.log(level, message, {
    service: 'security',
    ...meta
  });
};

// Função para log de performance (com traceId e latency)
const logPerformance = (operation, duration, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.info(`Performance: ${operation}`, {
    duration: `${duration}ms`,
    latency_ms: duration,
    operation,
    traceId,
    ...meta
  });
};

// Função para log de erro com contexto
const logError = (error, context = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.error(error.message, {
    stack: error.stack,
    context,
    traceId,
    timestamp: new Date().toISOString()
  });
};

// Função para log estruturado (padrão Uber/99)
const logStructured = (level, message, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  const structuredMeta = {
    traceId,
    service: 'leaf-websocket-backend',
    timestamp: Date.now(),
    ...meta
  };
  
  logger.log(level, message, structuredMeta);
};

// Função para log de command
const logCommand = (commandName, success, latency, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.info(`Command: ${commandName}`, {
    command: commandName,
    success: success,
    latency_ms: latency,
    traceId,
    ...meta
  });
};

// Função para log de event
const logEvent = (eventType, action, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.info(`Event: ${eventType} - ${action}`, {
    eventType,
    action,
    traceId,
    ...meta
  });
};

// Função para log de listener
const logListener = (listenerName, result, latency, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.info(`Listener: ${listenerName}`, {
    listener: listenerName,
    success: result !== false,
    latency_ms: latency,
    traceId,
    ...meta
  });
};

module.exports = {
  logger,
  websocketLogger,
  redisLogger,
  securityLogger,
  logWebSocket,
  logRedis,
  logSecurity,
  logPerformance,
  logError,
  logStructured,
  logCommand,
  logEvent,
  logListener
}; 