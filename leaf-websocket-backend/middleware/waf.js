const { logSecurity } = require('../utils/logger');

// Lista de padrões suspeitos
const suspiciousPatterns = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /vbscript:/gi,
  /onload\s*=/gi,
  /onerror\s*=/gi,
  /onclick\s*=/gi,
  /union\s+select/gi,
  /drop\s+table/gi,
  /insert\s+into/gi,
  /delete\s+from/gi,
  /update\s+set/gi,
  /exec\s*\(/gi,
  /eval\s*\(/gi,
  /document\.cookie/gi,
  /\.\.\/\.\./gi,
  /\.\.\/\.\.\/\.\./gi
];

// Lista de IPs bloqueados
const blockedIPs = new Set();

// Rate limiting por IP
const requestCounts = new Map();
const MAX_REQUESTS_PER_MINUTE = 100;
const BLOCK_DURATION = 5 * 60 * 1000; // 5 minutos

const wafMiddleware = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';
  const url = req.url;
  
  // Verificar se IP está bloqueado
  if (blockedIPs.has(clientIP)) {
    logSecurity('warn', `IP bloqueado tentou acessar: ${clientIP}`, {
      ip: clientIP,
      url,
      userAgent
    });
    return res.status(403).json({ error: 'Acesso bloqueado' });
  }
  
  // Rate limiting
  const now = Date.now();
  const requests = requestCounts.get(clientIP) || [];
  const validRequests = requests.filter(time => now - time < 60000);
  
  if (validRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    blockedIPs.add(clientIP);
    logSecurity('warn', `IP bloqueado por rate limiting: ${clientIP}`, {
      ip: clientIP,
      requests: validRequests.length,
      url
    });
    
    // Remover bloqueio após 5 minutos
    setTimeout(() => {
      blockedIPs.delete(clientIP);
    }, BLOCK_DURATION);
    
    return res.status(429).json({ error: 'Muitas requisições' });
  }
  
  validRequests.push(now);
  requestCounts.set(clientIP, validRequests);
  
  // Verificar padrões suspeitos na URL
  if (suspiciousPatterns.some(pattern => pattern.test(url))) {
    logSecurity('error', `Padrão suspeito detectado na URL: ${url}`, {
      ip: clientIP,
      url,
      userAgent
    });
    return res.status(400).json({ error: 'Requisição inválida' });
  }
  
  // Verificar User-Agent suspeito
  const suspiciousUserAgents = [
    /sqlmap/gi,
    /nmap/gi,
    /nikto/gi,
    /dirbuster/gi,
    /gobuster/gi,
    /burp/gi,
    /w3af/gi,
    /acunetix/gi,
    /nessus/gi,
    /openvas/gi
  ];
  
  if (suspiciousUserAgents.some(pattern => pattern.test(userAgent))) {
    logSecurity('warn', `User-Agent suspeito detectado: ${userAgent}`, {
      ip: clientIP,
      userAgent,
      url
    });
  }
  
  // Verificar payload suspeito no body
  if (req.body && typeof req.body === 'string') {
    if (suspiciousPatterns.some(pattern => pattern.test(req.body))) {
      logSecurity('error', `Payload suspeito detectado no body`, {
        ip: clientIP,
        url,
        userAgent,
        bodyLength: req.body.length
      });
      return res.status(400).json({ error: 'Payload inválido' });
    }
  }
  
  // Log de requisição normal
  logSecurity('info', `Requisição processada`, {
    ip: clientIP,
    method: req.method,
    url,
    userAgent: userAgent.substring(0, 100)
  });
  
  next();
};

// Middleware para limpeza periódica
setInterval(() => {
  const now = Date.now();
  for (const [ip, requests] of requestCounts.entries()) {
    const validRequests = requests.filter(time => now - time < 60000);
    if (validRequests.length === 0) {
      requestCounts.delete(ip);
    } else {
      requestCounts.set(ip, validRequests);
    }
  }
}, 60000); // Limpar a cada minuto

module.exports = wafMiddleware; 