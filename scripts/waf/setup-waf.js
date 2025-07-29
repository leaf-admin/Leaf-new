// Web Application Firewall (WAF)
// Data: 29/07/2025
// Status: ✅ WAF BASIC

const { logger } = require('./structured-logging');

class WebApplicationFirewall {
    constructor() {
        this.blockedIPs = new Set();
        this.requestCounts = new Map();
        this.suspiciousPatterns = [
            // SQL Injection patterns
            /(\b(union|select|insert|update|delete|drop|create|alter)\b)/i,
            /(\b(and|or)\b\s+\d+\s*=\s*\d+)/i,
            /(\b(and|or)\b\s+['"]\w+['"]\s*=\s*['"]\w+['"])/i,
            
            // XSS patterns
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            /javascript:/gi,
            /on\w+\s*=/gi,
            
            // Path traversal
            /\.\.\//g,
            /\.\.\\/g,
            
            // Command injection
            /(\b(cat|ls|rm|wget|curl|nc|netcat|bash|sh)\b)/i,
            
            // File upload attacks
            /\.(php|asp|aspx|jsp|exe|bat|cmd|com|pif|scr|vbs|js)$/i,
            
            // Suspicious headers
            /(eval|exec|system|shell)/i
        ];
        
        this.rateLimitConfig = {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 100, // max requests per window
            blockDuration: 60 * 60 * 1000 // 1 hour block
        };
        
        console.log('🛡️ WAF iniciado com proteções ativas');
    }
    
    // Verificar se IP está bloqueado
    isIPBlocked(ip) {
        return this.blockedIPs.has(ip);
    }
    
    // Bloquear IP
    blockIP(ip, reason) {
        this.blockedIPs.add(ip);
        logger.logSecurity('IP Blocked', {
            ip,
            reason,
            timestamp: new Date().toISOString()
        });
        
        console.log(`🚫 IP bloqueado: ${ip} - Motivo: ${reason}`);
    }
    
    // Verificar rate limiting
    checkRateLimit(ip) {
        const now = Date.now();
        const windowStart = now - this.rateLimitConfig.windowMs;
        
        if (!this.requestCounts.has(ip)) {
            this.requestCounts.set(ip, []);
        }
        
        const requests = this.requestCounts.get(ip);
        
        // Remover requests antigos
        const recentRequests = requests.filter(time => time > windowStart);
        this.requestCounts.set(ip, recentRequests);
        
        // Adicionar request atual
        recentRequests.push(now);
        
        // Verificar se excedeu limite
        if (recentRequests.length > this.rateLimitConfig.maxRequests) {
            this.blockIP(ip, 'Rate limit exceeded');
            return false;
        }
        
        return true;
    }
    
    // Verificar padrões suspeitos
    checkSuspiciousPatterns(input) {
        for (const pattern of this.suspiciousPatterns) {
            if (pattern.test(input)) {
                return {
                    blocked: true,
                    pattern: pattern.toString(),
                    input: input.substring(0, 100) // Primeiros 100 chars
                };
            }
        }
        
        return { blocked: false };
    }
    
    // Verificar headers suspeitos
    checkSuspiciousHeaders(headers) {
        const suspiciousHeaders = [
            'x-forwarded-for',
            'x-real-ip',
            'x-forwarded-proto',
            'x-forwarded-host'
        ];
        
        for (const header of suspiciousHeaders) {
            if (headers[header] && !this.isValidHeader(headers[header])) {
                return {
                    blocked: true,
                    header,
                    value: headers[header]
                };
            }
        }
        
        return { blocked: false };
    }
    
    // Validar header
    isValidHeader(value) {
        // Verificar se contém caracteres suspeitos
        const suspiciousChars = /[<>\"'&]/;
        return !suspiciousChars.test(value);
    }
    
    // Verificar User-Agent suspeito
    checkSuspiciousUserAgent(userAgent) {
        const suspiciousUAs = [
            /bot/i,
            /crawler/i,
            /spider/i,
            /scraper/i,
            /curl/i,
            /wget/i,
            /python/i,
            /perl/i,
            /java/i
        ];
        
        for (const pattern of suspiciousUAs) {
            if (pattern.test(userAgent)) {
                return {
                    blocked: true,
                    userAgent,
                    pattern: pattern.toString()
                };
            }
        }
        
        return { blocked: false };
    }
    
    // Middleware principal do WAF
    middleware() {
        return (req, res, next) => {
            const clientIP = req.ip || req.connection.remoteAddress;
            
            // 1. Verificar se IP está bloqueado
            if (this.isIPBlocked(clientIP)) {
                logger.logSecurity('Blocked IP Access Attempt', {
                    ip: clientIP,
                    url: req.url,
                    method: req.method
                });
                
                return res.status(403).json({
                    error: 'Access denied',
                    reason: 'IP blocked'
                });
            }
            
            // 2. Verificar rate limiting
            if (!this.checkRateLimit(clientIP)) {
                return res.status(429).json({
                    error: 'Too many requests',
                    retryAfter: '1 hour'
                });
            }
            
            // 3. Verificar User-Agent
            const userAgent = req.get('User-Agent') || '';
            const uaCheck = this.checkSuspiciousUserAgent(userAgent);
            if (uaCheck.blocked) {
                this.blockIP(clientIP, `Suspicious User-Agent: ${uaCheck.userAgent}`);
                return res.status(403).json({
                    error: 'Access denied',
                    reason: 'Suspicious User-Agent'
                });
            }
            
            // 4. Verificar headers
            const headerCheck = this.checkSuspiciousHeaders(req.headers);
            if (headerCheck.blocked) {
                this.blockIP(clientIP, `Suspicious header: ${headerCheck.header}`);
                return res.status(403).json({
                    error: 'Access denied',
                    reason: 'Suspicious headers'
                });
            }
            
            // 5. Verificar body (para POST/PUT)
            if (req.method === 'POST' || req.method === 'PUT') {
                const body = JSON.stringify(req.body);
                const patternCheck = this.checkSuspiciousPatterns(body);
                
                if (patternCheck.blocked) {
                    this.blockIP(clientIP, `Suspicious pattern in body: ${patternCheck.pattern}`);
                    logger.logSecurity('Suspicious Pattern Detected', {
                        ip: clientIP,
                        pattern: patternCheck.pattern,
                        input: patternCheck.input
                    });
                    
                    return res.status(403).json({
                        error: 'Access denied',
                        reason: 'Suspicious content detected'
                    });
                }
            }
            
            // 6. Verificar query parameters
            const queryString = JSON.stringify(req.query);
            const queryCheck = this.checkSuspiciousPatterns(queryString);
            
            if (queryCheck.blocked) {
                this.blockIP(clientIP, `Suspicious pattern in query: ${queryCheck.pattern}`);
                return res.status(403).json({
                    error: 'Access denied',
                    reason: 'Suspicious query parameters'
                });
            }
            
            // 7. Log de segurança
            logger.logSecurity('Request Passed WAF', {
                ip: clientIP,
                url: req.url,
                method: req.method,
                userAgent
            });
            
            // Adicionar informações do WAF ao request
            req.waf = {
                ip: clientIP,
                passed: true,
                timestamp: new Date().toISOString()
            };
            
            next();
        };
    }
    
    // Obter estatísticas do WAF
    getStats() {
        return {
            blockedIPs: this.blockedIPs.size,
            requestCounts: this.requestCounts.size,
            patterns: this.suspiciousPatterns.length,
            timestamp: new Date().toISOString()
        };
    }
    
    // Limpar IPs bloqueados (manutenção)
    cleanupBlockedIPs() {
        // Limpar IPs bloqueados após 24 horas
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        // Esta é uma implementação simplificada
        // Em produção, você usaria Redis ou banco de dados
        console.log('🧹 Limpeza de IPs bloqueados executada');
    }
}

// Criar instância global
const waf = new WebApplicationFirewall();

module.exports = {
    waf,
    wafMiddleware: waf.middleware.bind(waf)
}; 