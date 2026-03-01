const winston = require('winston');
const path = require('path');

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