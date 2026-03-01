// Structured Logging Setup
// Data: 29/07/2025
// Status: ✅ STRUCTURED LOGGING

const winston = require('winston');
const { format } = winston;

class StructuredLogger {
    constructor() {
        this.logger = this.createLogger();
    }
    
    // Criar logger estruturado
    createLogger() {
        // Formato JSON estruturado
        const jsonFormat = format.combine(
            format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }),
            format.errors({ stack: true }),
            format.json()
        );
        
        // Formato para console (desenvolvimento)
        const consoleFormat = format.combine(
            format.colorize(),
            format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }),
            format.printf(({ timestamp, level, message, ...meta }) => {
                let log = `${timestamp} [${level}]: ${message}`;
                if (Object.keys(meta).length > 0) {
                    log += ` ${JSON.stringify(meta)}`;
                }
                return log;
            })
        );
        
        // Configurar transportes
        const transports = [
            // Console (desenvolvimento)
            new winston.transports.Console({
                format: consoleFormat,
                level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
            }),
            
            // Arquivo de logs gerais
            new winston.transports.File({
                filename: '/var/log/leaf-app/app.log',
                format: jsonFormat,
                maxsize: 5242880, // 5MB
                maxFiles: 5
            }),
            
            // Arquivo de logs de erro
            new winston.transports.File({
                filename: '/var/log/leaf-app/error.log',
                format: jsonFormat,
                level: 'error',
                maxsize: 5242880, // 5MB
                maxFiles: 5
            }),
            
            // Arquivo de logs de API
            new winston.transports.File({
                filename: '/var/log/leaf-app/api.log',
                format: jsonFormat,
                maxsize: 5242880, // 5MB
                maxFiles: 5
            }),
            
            // Arquivo de logs de WebSocket
            new winston.transports.File({
                filename: '/var/log/leaf-app/websocket.log',
                format: jsonFormat,
                maxsize: 5242880, // 5MB
                maxFiles: 5
            })
        ];
        
        return winston.createLogger({
            level: 'info',
            format: jsonFormat,
            transports,
            // Não sair em caso de erro
            exitOnError: false
        });
    }
    
    // Log de API
    logApi(level, message, meta = {}) {
        this.logger.log(level, message, {
            service: 'api',
            ...meta
        });
    }
    
    // Log de WebSocket
    logWebSocket(level, message, meta = {}) {
        this.logger.log(level, message, {
            service: 'websocket',
            ...meta
        });
    }
    
    // Log de autenticação
    logAuth(level, message, meta = {}) {
        this.logger.log(level, message, {
            service: 'auth',
            ...meta
        });
    }
    
    // Log de pagamento
    logPayment(level, message, meta = {}) {
        this.logger.log(level, message, {
            service: 'payment',
            ...meta
        });
    }
    
    // Log de erro
    logError(error, meta = {}) {
        this.logger.error('Error occurred', {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            ...meta
        });
    }
    
    // Log de performance
    logPerformance(operation, duration, meta = {}) {
        this.logger.info('Performance metric', {
            operation,
            duration,
            ...meta
        });
    }
    
    // Log de segurança
    logSecurity(event, meta = {}) {
        this.logger.warn('Security event', {
            event,
            ...meta
        });
    }
    
    // Log de negócio
    logBusiness(event, data = {}) {
        this.logger.info('Business event', {
            event,
            data,
            timestamp: new Date().toISOString()
        });
    }
}

// Middleware para logging de requests
const requestLogger = (req, res, next) => {
    const start = Date.now();
    
    // Log do request
    logger.logApi('info', 'HTTP Request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id || 'anonymous'
    });
    
    // Interceptar response
    res.on('finish', () => {
        const duration = Date.now() - start;
        
        // Log do response
        logger.logApi('info', 'HTTP Response', {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration,
            ip: req.ip,
            userId: req.user?.id || 'anonymous'
        });
    });
    
    next();
};

// Middleware para logging de WebSocket
const websocketLogger = (ws, req) => {
    logger.logWebSocket('info', 'WebSocket Connection', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id || 'anonymous'
    });
    
    ws.on('message', (message) => {
        logger.logWebSocket('debug', 'WebSocket Message', {
            message: message.toString(),
            userId: req.user?.id || 'anonymous'
        });
    });
    
    ws.on('close', () => {
        logger.logWebSocket('info', 'WebSocket Disconnection', {
            userId: req.user?.id || 'anonymous'
        });
    });
};

// Criar instância global
const logger = new StructuredLogger();

module.exports = {
    logger,
    requestLogger,
    websocketLogger
}; 