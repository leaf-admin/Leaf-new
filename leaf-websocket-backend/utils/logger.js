const winston = require('winston');
const path = require('path');
const fs = require('fs');
const traceContext = require('./trace-context');
const {
  redactSensitiveText,
  redactSensitiveValue,
  redactLogInfoInPlace
} = require('./log-redaction');

// Configuração de cores para diferentes níveis
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  verbose: 'cyan'
};

winston.addColors(colors);

// Arquivos de log só quando a pasta aceita escrita. Nos containers o processo roda sem
// permissão em `logs/`; o transporte de arquivo então nunca abre, o buffer dele enche e o
// winston para de entregar para TODOS os transportes, inclusive o console: o serviço seguia
// funcionando sem gravar mais nenhum log. Lá a saída padrão já é coletada pelo Docker.
const LOG_DIRECTORY = path.join(__dirname, '../logs');
function canWriteLogFiles() {
  if (String(process.env.LOG_TO_FILES || '').toLowerCase() === 'false') {
    return false;
  }
  try {
    fs.accessSync(LOG_DIRECTORY, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}
const LOG_FILES_ENABLED = canWriteLogFiles();
function createFileTransport(options) {
  return LOG_FILES_ENABLED ? new winston.transports.File(options) : null;
}

// Formato personalizado para logs estruturados (padrão Uber/99)
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    redactLogInfoInPlace(info);

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
  createFileTransport({
    filename: path.join(__dirname, '../logs/error.log'),
    level: 'error',
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }),
  
  // Arquivo para todos os logs
  createFileTransport({
    filename: path.join(__dirname, '../logs/combined.log'),
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 10
  }),
  
  // Arquivo específico para WebSocket
  createFileTransport({
    filename: path.join(__dirname, '../logs/websocket.log'),
    level: 'info',
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }),
  
  // Arquivo específico para Redis
  createFileTransport({
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
  transports: transports.filter(Boolean),
  exitOnError: false
});

// Loggers específicos
const websocketLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    createFileTransport({
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
  ].filter(Boolean)
});

const redisLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    createFileTransport({
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
  ].filter(Boolean)
});

const securityLogger = winston.createLogger({
  level: 'warn',
  format: logFormat,
  transports: [
    createFileTransport({
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
  ].filter(Boolean)
});

// Funções de logging específicas
const logWebSocket = (level, message, meta = {}) => {
  websocketLogger.log(level, redactSensitiveText(message), redactSensitiveValue({
    service: 'websocket',
    ...meta
  }));
};

const logRedis = (level, message, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  redisLogger.log(level, redactSensitiveText(message), redactSensitiveValue({
    service: 'redis',
    traceId,
    ...meta
  }));
};

const logSecurity = (level, message, meta = {}) => {
  securityLogger.log(level, redactSensitiveText(message), redactSensitiveValue({
    service: 'security',
    ...meta
  }));
};

// Função para log de performance (com traceId e latency)
const logPerformance = (operation, duration, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.info(redactSensitiveText(`Performance: ${operation}`), redactSensitiveValue({
    duration: `${duration}ms`,
    latency_ms: duration,
    operation,
    traceId,
    ...meta
  }));
};

// Função para log de erro com contexto
const logError = (error, context = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.error(redactSensitiveText(error.message), redactSensitiveValue({
    stack: error.stack,
    context,
    traceId,
    timestamp: new Date().toISOString()
  }));
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
  
  logger.log(level, redactSensitiveText(message), redactSensitiveValue(structuredMeta));
};

// Função para log de command
const logCommand = (commandName, success, latency, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.info(redactSensitiveText(`Command: ${commandName}`), redactSensitiveValue({
    command: commandName,
    success: success,
    latency_ms: latency,
    traceId,
    ...meta
  }));
};

// Função para log de event
const logEvent = (eventType, action, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.info(redactSensitiveText(`Event: ${eventType} - ${action}`), redactSensitiveValue({
    eventType,
    action,
    traceId,
    ...meta
  }));
};

// Função para log de listener
const logListener = (listenerName, result, latency, meta = {}) => {
  const traceId = traceContext.getCurrentTraceId();
  logger.info(redactSensitiveText(`Listener: ${listenerName}`), redactSensitiveValue({
    listener: listenerName,
    success: result !== false,
    latency_ms: latency,
    traceId,
    ...meta
  }));
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
