const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Mesmo cuidado de utils/logger.js: sem permissão de escrita na pasta, o transporte de
// arquivo trava e o winston para de entregar também para o console.
const LEGACY_LOG_DIRECTORY = path.join(__dirname, '../logs');
let legacyLogFilesEnabled = String(process.env.LOG_TO_FILES || '').toLowerCase() !== 'false';
if (legacyLogFilesEnabled) {
  try {
    fs.accessSync(LEGACY_LOG_DIRECTORY, fs.constants.W_OK);
  } catch (error) {
    legacyLogFilesEnabled = false;
  }
}
function createFileTransport(options) {
  return legacyLogFilesEnabled ? new winston.transports.File(options) : null;
}

// Configuração de cores para diferentes níveis
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  verbose: 'cyan'
};

winston.addColors(colors);

// Formato personalizado para logs
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
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
  websocketLogger.log(level, message, {
    service: 'websocket',
    ...meta
  });
};

const logRedis = (level, message, meta = {}) => {
  redisLogger.log(level, message, {
    service: 'redis',
    ...meta
  });
};

const logSecurity = (level, message, meta = {}) => {
  securityLogger.log(level, message, {
    service: 'security',
    ...meta
  });
};

// Função para log de performance
const logPerformance = (operation, duration, meta = {}) => {
  logger.info(`Performance: ${operation}`, {
    duration: `${duration}ms`,
    operation,
    ...meta
  });
};

// Função para log de erro com contexto
const logError = (error, context = {}) => {
  logger.error(error.message, {
    stack: error.stack,
    context,
    timestamp: new Date().toISOString()
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
  logError
}; 