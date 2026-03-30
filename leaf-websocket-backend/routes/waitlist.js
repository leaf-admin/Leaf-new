const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { logger } = require('../utils/logger');
const rateLimit = require('express-rate-limit');
const cityActivationStateService = require('../services/city-activation-state-service');

let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (_e) {}

const WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS = Number.parseInt(
  process.env.WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS || '300',
  10
);

const getLandingMetricsRef = () => {
  if (admin.apps.length === 0 && firebaseConfig && firebaseConfig.initializeFirebase) {
    firebaseConfig.initializeFirebase();
  }
  if (admin.apps.length === 0) {
    return null;
  }
  return admin.firestore().collection('metrics').doc('landing');
};

const incrementLandingMetric = async (field) => {
  try {
    const landingMetricsRef = getLandingMetricsRef();
    if (!landingMetricsRef) return;

    await landingMetricsRef.set({
      [field]: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    logger.error('Erro ao atualizar métricas da landing page:', error);
  }
};

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeStateCode(value) {
  return String(value || '').trim().toUpperCase();
}

async function loadCityActivationConfig() {
  return cityActivationStateService.getConfig();
}

function resolveCityConfigFromActivation(config, cityValue, fallbackStateCode) {
  const citySlug = slugify(cityValue);
  const safeStateCode = normalizeStateCode(fallbackStateCode) || 'RJ';

  if (!citySlug) {
    return {
      cityKey: '',
      stateCode: safeStateCode,
      cityLabel: '',
      cityActive: true,
      stateEnabled: true,
      waitlistEnabled: true,
      maxActiveDrivers: WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS
    };
  }

  const states = (config && config.states && typeof config.states === 'object')
    ? config.states
    : {};

  // Tentativa 1: procurar no estado informado
  if (states[safeStateCode] && states[safeStateCode].cities?.[citySlug]) {
    const city = states[safeStateCode].cities[citySlug];
    return {
      cityKey: city.key || citySlug,
      stateCode: safeStateCode,
      cityLabel: city.label || city.name || citySlug,
      cityActive: city.active !== false,
      stateEnabled: states[safeStateCode].enabled !== false,
      waitlistEnabled: city.waitlistEnabled !== false,
      maxActiveDrivers: Number(city.maxActiveDrivers || WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS)
    };
  }

  // Tentativa 2: procurar em todos os estados
  for (const [stateCode, stateData] of Object.entries(states)) {
    const city = stateData?.cities?.[citySlug];
    if (!city) continue;
    return {
      cityKey: city.key || citySlug,
      stateCode: normalizeStateCode(stateCode),
      cityLabel: city.label || city.name || citySlug,
      cityActive: city.active !== false,
      stateEnabled: stateData.enabled !== false,
      waitlistEnabled: city.waitlistEnabled !== false,
      maxActiveDrivers: Number(city.maxActiveDrivers || WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS)
    };
  }

  // Fallback para cidade ainda nao cadastrada na matriz de ativacao
  return {
    cityKey: citySlug,
    stateCode: safeStateCode,
    cityLabel: cityValue || citySlug,
    cityActive: true,
    stateEnabled: true,
    waitlistEnabled: true,
    maxActiveDrivers: WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS
  };
}

async function getCityWaitlistCounts(cityKey) {
  if (!cityKey) {
    return { pending: 0, approved: 0 };
  }

  const [pendingSnapshot, approvedSnapshot] = await Promise.all([
    admin.firestore()
      .collection('waitList')
      .where('status', '==', 'pending')
      .where('cityKey', '==', cityKey)
      .get(),
    admin.firestore()
      .collection('waitList')
      .where('status', '==', 'approved')
      .where('cityKey', '==', cityKey)
      .get()
  ]);

  return {
    pending: pendingSnapshot.size,
    approved: approvedSnapshot.size
  };
}

// Rate Limiter específico para waitlist - MUITO RESTRITIVO
// Apenas 3 cadastros por IP por hora (proteção contra spam/DDoS)
const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // Máximo 3 requisições por IP por hora
  message: {
    error: 'Muitas tentativas de cadastro. Tente novamente em 1 hora.',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit excedido - Waitlist', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      origin: req.headers.origin
    });
    res.status(429).json({
      error: 'Muitas tentativas de cadastro. Tente novamente em 1 hora.',
      retryAfter: 3600
    });
  }
  // Não usar keyGenerator customizado - usar IP padrão do express-rate-limit
  // O express-rate-limit já lida corretamente com IPv6 e proxies
});

// Middleware de validação de origem e CORS (apenas da landing page)
const validateOrigin = (req, res, next) => {
  try {
    const origin = req.headers.origin;
    const allowedOrigins = [
      'https://leaf.app.br',
      'https://www.leaf.app.br',
      'https://dashboard.147.182.204.181.sslip.io',
      'https://api.147.182.204.181.sslip.io',
      'https://socket.147.182.204.181.sslip.io',
      'http://localhost:3000', // Para desenvolvimento
      'http://localhost:8080'  // Para desenvolvimento
    ];
    
    // Configurar headers CORS ANTES de validar
    // Se a origem estiver na lista permitida, definir o header CORS
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '86400'); // 24 horas
    }
    
    // Para requisições OPTIONS (preflight), responder imediatamente
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    
    // Verificar se a origem é permitida
    const isAllowed = !origin || allowedOrigins.some(allowed => 
      origin && origin.startsWith(allowed)
    );
    
    // Apenas validar em produção (se NODE_ENV estiver definido)
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (!isAllowed && isProduction && origin) {
      logger.warn('Tentativa de acesso de origem não permitida', {
        origin,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      return res.status(403).json({ error: 'Origem não permitida' });
    }
    
    next();
  } catch (error) {
    logger.error('Erro na validação de origem:', error);
    // Em caso de erro, permitir (não bloquear por falha técnica)
    next();
  }
};

// Middleware de sanitização e validação de dados
const validateWaitlistData = (req, res, next) => {
  const { nome, celular, cidade } = req.body;
  
  // Validação básica
  if (!nome || !celular || !cidade) {
    return res.status(400).json({ error: 'Campos obrigatórios: nome, celular e cidade' });
  }
  
  // Sanitização e validação
  const nomeSanitizado = nome.trim().substring(0, 100); // Máximo 100 caracteres
  const celularSanitizado = celular.trim().replace(/\D/g, ''); // Apenas números
  const cidadeSanitizada = cidade.trim().substring(0, 100); // Máximo 100 caracteres
  
  // Validação de formato
  if (nomeSanitizado.length < 3 || nomeSanitizado.length > 100) {
    return res.status(400).json({ error: 'Nome deve ter entre 3 e 100 caracteres' });
  }
  
  if (celularSanitizado.length < 10 || celularSanitizado.length > 15) {
    return res.status(400).json({ error: 'Celular inválido' });
  }
  
  // Validar se não contém caracteres suspeitos (proteção XSS)
  const suspiciousPattern = /[<>\"'%;()&+]|script|javascript|onerror|onload/i;
  if (suspiciousPattern.test(nomeSanitizado) || suspiciousPattern.test(cidadeSanitizada)) {
    logger.warn('Tentativa de cadastro com dados suspeitos', {
      ip: req.ip,
      nome: nomeSanitizado.substring(0, 20),
      cidade: cidadeSanitizada.substring(0, 20)
    });
    return res.status(400).json({ error: 'Dados inválidos' });
  }
  
  // Adicionar dados sanitizados ao request
  req.sanitizedData = {
    nome: nomeSanitizado,
    celular: celularSanitizado,
    cidade: cidadeSanitizada
  };
  
  next();
};

// Verificar duplicatas (mesmo celular não pode cadastrar novamente)
const checkDuplicates = async (req, res, next) => {
  try {
    const { celular } = req.sanitizedData;
    
    // Verificar se já existe cadastro com esse celular (qualquer data)
    const existing = await admin.firestore()
      .collection('waitlist_landing')
      .where('celular', '==', celular)
      .limit(1)
      .get();
    
    if (!existing.empty) {
      logger.info('Tentativa de cadastro duplicado bloqueada', {
        celular: celular.substring(0, 4) + '****',
        ip: req.ip
      });
      return res.status(409).json({ 
        error: 'Este número de celular já foi cadastrado na lista de espera. Aguarde nosso contato.' 
      });
    }
    
    next();
  } catch (error) {
    logger.error('Erro ao verificar duplicatas:', error);
    // Em caso de erro, permitir (não bloquear por falha técnica)
    next();
  }
};

// Middleware CORS específico para waitlist (antes de tudo)
// Este middleware sobrescreve a configuração CORS global para garantir headers corretos
const corsWaitlist = (req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://leaf.app.br',
    'https://www.leaf.app.br',
    'https://dashboard.147.182.204.181.sslip.io',
    'https://api.147.182.204.181.sslip.io',
    'https://socket.147.182.204.181.sslip.io',
    'http://localhost:3000',
    'http://localhost:8080'
  ];
  
  // IMPORTANTE: Remover TODOS os headers CORS que possam ter sido definidos anteriormente
  // Isso garante que não haja conflito com o CORS global do Express
  const corsHeaders = [
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Methods',
    'Access-Control-Allow-Headers',
    'Access-Control-Allow-Credentials',
    'Access-Control-Max-Age',
    'Access-Control-Expose-Headers'
  ];
  
  corsHeaders.forEach(header => {
    res.removeHeader(header);
  });
  
  // Definir headers CORS corretos - APENAS um valor por header
  if (origin && allowedOrigins.includes(origin)) {
    // Definir APENAS a origem específica (não array, não múltiplos valores)
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Se não houver origin (requisição direta), permitir
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  // Definir métodos permitidos como string única, não array
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // Responder imediatamente para OPTIONS (preflight)
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
};

// Middleware final para garantir headers CORS corretos na resposta
// Este middleware intercepta TODAS as formas de enviar resposta para garantir headers corretos
const ensureCorsHeaders = (req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://leaf.app.br',
    'https://www.leaf.app.br',
    'https://dashboard.147.182.204.181.sslip.io',
    'https://api.147.182.204.181.sslip.io',
    'https://socket.147.182.204.181.sslip.io',
    'http://localhost:3000',
    'http://localhost:8080'
  ];
  
  // Interceptar o método json()
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    // Remover TODOS os headers CORS existentes (pode ter sido definido pelo CORS global)
    const corsHeaders = [
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Methods',
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Credentials',
      'Access-Control-Max-Age',
      'Vary'
    ];
    
    corsHeaders.forEach(header => {
      res.removeHeader(header);
    });
    
    // Definir header CORS correto (apenas um valor, não array)
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (!origin) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    return originalJson(data);
  };
  
  // Interceptar o método end() também (para respostas que não usam json)
  const originalEnd = res.end.bind(res);
  res.end = function(chunk, encoding) {
    // Aplicar mesma lógica de headers CORS
    const corsHeaders = [
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Methods',
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Credentials',
      'Access-Control-Max-Age',
      'Vary'
    ];
    
    corsHeaders.forEach(header => {
      res.removeHeader(header);
    });
    
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (!origin) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    return originalEnd(chunk, encoding);
  };
  
  next();
};

// OPTIONS /api/waitlist/landing - Preflight CORS
router.options('/api/waitlist/landing', corsWaitlist);

// POST /api/waitlist/landing - Registrar na lista de espera da landing page (público)
// Aplicar middlewares de segurança na ordem: CORS -> rate limit -> origem -> validação -> duplicatas -> ensure CORS
router.post('/api/waitlist/landing', 
  corsWaitlist,
  waitlistLimiter,
  validateOrigin,
  validateWaitlistData,
  checkDuplicates,
  ensureCorsHeaders,
  async (req, res) => {
    try {
      // Verificar se sanitizedData existe (pode não existir se validação falhou)
      if (!req.sanitizedData) {
        logger.error('sanitizedData não existe na requisição');
        return res.status(400).json({ error: 'Dados inválidos' });
      }
      
      const { nome, celular, cidade } = req.sanitizedData;
      const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
      
      // Salvar na coleção waitlist_landing
      const waitListData = {
        nome,
        celular,
        cidade,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        origem: 'landing_page',
        status: 'pending',
        ip: clientIP.substring(0, 50), // Limitar tamanho do IP
        userAgent: (req.headers['user-agent'] || '').substring(0, 200) // Limitar tamanho
      };
      
      await admin.firestore().collection('waitlist_landing').add(waitListData);
      await incrementLandingMetric('waitlistCount');
      
      logger.info(`Novo registro na lista de espera`, {
        nome: nome.substring(0, 20),
        celular: celular.substring(0, 4) + '****',
        cidade: cidade.substring(0, 20),
        ip: clientIP
      });
      
      res.json({
        success: true,
        message: 'Cadastro realizado com sucesso!'
      });
      
    } catch (error) {
      logger.error('Erro ao registrar na lista de espera:', error);
      logger.error('Stack trace:', error.stack);
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
);

// Middleware de autenticação Firebase
const requireFirebase = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autorização não fornecido' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    logger.error('Erro na autenticação Firebase:', error);
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Middleware para verificar se é admin
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.role || !['admin', 'manager', 'super-admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }
  next();
};

// GET /api/waitlist/status - Status da wait list para motorista
router.get('/api/waitlist/status', requireFirebase, async (req, res) => {
  try {
    const driverId = req.user.uid;
    
    // Buscar dados do motorista
    const userSnapshot = await admin.firestore().collection('users').doc(driverId).get();
    if (!userSnapshot.exists) {
      return res.status(404).json({ error: 'Motorista não encontrado' });
    }

    const userData = userSnapshot.data();
    
    // Verificar se é motorista
    if (userData.usertype !== 'driver') {
      return res.status(400).json({ error: 'Usuário não é um motorista' });
    }

    // Buscar configurações globais de fallback
    const configSnapshot = await admin.firestore().collection('systemConfig').doc('waitList').get();
    const config = configSnapshot.exists ? configSnapshot.data() : {
      maxActiveDrivers: WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS,
      currentActiveDrivers: 0,
      waitListEnabled: true
    };

    // Buscar posição na wait list
    const waitListSnapshot = await admin.firestore()
      .collection('waitList')
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .get();

    let waitListData = null;
    if (!waitListSnapshot.empty) {
      const waitListDoc = waitListSnapshot.docs[0];
      waitListData = {
        id: waitListDoc.id,
        position: waitListDoc.data().position,
        joinedAt: waitListDoc.data().joinedAt,
        priority: waitListDoc.data().priority || 'normal',
        cityKey: waitListDoc.data().cityKey || null,
        cityLabel: waitListDoc.data().cityLabel || null,
        stateCode: waitListDoc.data().stateCode || null
      };
    }

    const cityActivationConfig = await loadCityActivationConfig();
    const requestedCityValue = waitListData?.cityKey || userData.waitListCityKey || userData.city || userData.citySlug || '';
    const resolvedCity = resolveCityConfigFromActivation(
      cityActivationConfig,
      requestedCityValue,
      waitListData?.stateCode || userData.state || userData.waitListStateCode || 'RJ'
    );
    const cityCounts = await getCityWaitlistCounts(resolvedCity.cityKey);

    // Calcular estimativa de tempo (baseado na posição)
    let estimatedWaitTime = null;
    if (waitListData) {
      const avgApprovalTime = 7; // dias
      estimatedWaitTime = waitListData.position * avgApprovalTime;
    }

    const response = {
      waitListStatus: userData.waitListStatus || 'none',
      isApproved: userData.isApproved || false,
      isActiveDriver: userData.isActiveDriver || false,
      position: waitListData?.position || null,
      estimatedWaitTime: estimatedWaitTime,
      maxActiveDrivers: Number(resolvedCity.maxActiveDrivers || config.maxActiveDrivers || WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS),
      currentActiveDrivers: Number(cityCounts.approved || 0),
      waitListEnabled: resolvedCity.waitlistEnabled !== false,
      city: {
        cityKey: resolvedCity.cityKey,
        cityLabel: waitListData?.cityLabel || resolvedCity.cityLabel,
        stateCode: resolvedCity.stateCode,
        cityActive: resolvedCity.cityActive !== false,
        stateEnabled: resolvedCity.stateEnabled !== false,
        pendingDrivers: Number(cityCounts.pending || 0),
        approvedDrivers: Number(cityCounts.approved || 0)
      },
      documentsStatus: {
        cnhUploaded: userData.cnhUploaded || false,
        vehicleRegistered: userData.vehicleRegistered || false,
        documentsComplete: userData.documentsComplete || false
      },
      joinedAt: waitListData?.joinedAt || null,
      priority: waitListData?.priority || 'normal'
    };

    logger.info(`Status da wait list consultado para motorista ${driverId}`);
    res.json(response);

  } catch (error) {
    logger.error('Erro ao buscar status da wait list:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/waitlist/join - Entrar na wait list
router.post('/api/waitlist/join', requireFirebase, async (req, res) => {
  try {
    const driverId = req.user.uid;
    const { priority = 'normal', notes = '', city: requestedCity } = req.body;

    // Verificar se já está na wait list
    const existingWaitList = await admin.firestore()
      .collection('waitList')
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .get();

    if (!existingWaitList.empty) {
      return res.status(400).json({ error: 'Motorista já está na wait list' });
    }

    // Verificar se já é motorista ativo
    const userSnapshot = await admin.firestore().collection('users').doc(driverId).get();
    if (!userSnapshot.exists) {
      return res.status(404).json({ error: 'Motorista não encontrado' });
    }

    const userData = userSnapshot.data();
    if (userData.isActiveDriver) {
      return res.status(400).json({ error: 'Motorista já está ativo' });
    }

    const cityActivationConfig = await loadCityActivationConfig();
    const resolvedCity = resolveCityConfigFromActivation(
      cityActivationConfig,
      requestedCity || userData.city || userData.waitListCityKey || '',
      userData.state || userData.waitListStateCode || 'RJ'
    );

    if (!resolvedCity.cityKey) {
      return res.status(400).json({
        error: 'Cidade obrigatoria para entrar na waitlist'
      });
    }

    if (resolvedCity.stateEnabled === false || resolvedCity.cityActive === false) {
      return res.status(400).json({
        error: 'Cidade desativada para operacao no momento'
      });
    }

    if (resolvedCity.waitlistEnabled === false) {
      return res.status(400).json({
        error: 'Fila de espera desativada para esta cidade'
      });
    }

    // Buscar próxima posição na fila (por cidade)
    const waitListSnapshot = await admin.firestore()
      .collection('waitList')
      .where('status', '==', 'pending')
      .where('cityKey', '==', resolvedCity.cityKey)
      .get();

    const maxPosition = waitListSnapshot.docs.reduce((max, doc) => {
      const positionValue = Number(doc.data()?.position || 0);
      return Math.max(max, positionValue);
    }, 0);
    const nextPosition = maxPosition + 1;

    // Adicionar à wait list
    const waitListData = {
      driverId,
      position: nextPosition,
      status: 'pending',
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      priority,
      notes,
      adminId: null,
      cityKey: resolvedCity.cityKey,
      cityLabel: resolvedCity.cityLabel || requestedCity || userData.city || resolvedCity.cityKey,
      stateCode: resolvedCity.stateCode
    };

    await admin.firestore().collection('waitList').add(waitListData);

    // Atualizar status do usuário
    await admin.firestore().collection('users').doc(driverId).update({
      waitListStatus: 'pending',
      waitListPosition: nextPosition,
      waitListJoinedAt: admin.firestore.FieldValue.serverTimestamp(),
      waitListCityKey: resolvedCity.cityKey,
      waitListCityLabel: resolvedCity.cityLabel || requestedCity || userData.city || resolvedCity.cityKey,
      waitListStateCode: resolvedCity.stateCode
    });

    logger.info(`Motorista ${driverId} adicionado à wait list na posição ${nextPosition}`, {
      cityKey: resolvedCity.cityKey
    });

    res.json({
      success: true,
      message: 'Adicionado à wait list com sucesso',
      position: nextPosition,
      city: {
        cityKey: resolvedCity.cityKey,
        cityLabel: resolvedCity.cityLabel || requestedCity || userData.city || resolvedCity.cityKey,
        stateCode: resolvedCity.stateCode
      },
      estimatedWaitTime: nextPosition * 7 // 7 dias por posição
    });

  } catch (error) {
    logger.error('Erro ao adicionar à wait list:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/waitlist/leave - Sair da wait list
router.delete('/api/waitlist/leave', requireFirebase, async (req, res) => {
  try {
    const driverId = req.user.uid;

    // Buscar entrada na wait list
    const waitListSnapshot = await admin.firestore()
      .collection('waitList')
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .get();

    if (waitListSnapshot.empty) {
      return res.status(404).json({ error: 'Motorista não está na wait list' });
    }

    const waitListDoc = waitListSnapshot.docs[0];
    const position = waitListDoc.data().position;
    const cityKey = waitListDoc.data().cityKey || null;

    // Remover da wait list
    await waitListDoc.ref.delete();

    // Atualizar posições dos outros motoristas (apenas da mesma cidade)
    let otherWaitListSnapshot = null;
    if (cityKey) {
      otherWaitListSnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', 'pending')
        .where('cityKey', '==', cityKey)
        .get();
    } else {
      otherWaitListSnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', 'pending')
        .where('position', '>', position)
        .get();
    }

    const batch = admin.firestore().batch();
    otherWaitListSnapshot.docs
      .filter((doc) => Number(doc.data()?.position || 0) > Number(position || 0))
      .forEach(doc => {
      batch.update(doc.ref, {
        position: doc.data().position - 1
      });
      });
    await batch.commit();

    // Atualizar status do usuário
    await admin.firestore().collection('users').doc(driverId).update({
      waitListStatus: 'none',
      waitListPosition: null,
      waitListJoinedAt: null,
      waitListCityKey: null,
      waitListCityLabel: null,
      waitListStateCode: null
    });

    logger.info(`Motorista ${driverId} removido da wait list`);

    res.json({
      success: true,
      message: 'Removido da wait list com sucesso'
    });

  } catch (error) {
    logger.error('Erro ao remover da wait list:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/waitlist/drivers - Listar motoristas na wait list (admin)
router.get('/api/waitlist/drivers', requireFirebase, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'pending', city } = req.query;
    const offset = (page - 1) * limit;
    const cityKeyFilter = slugify(city);

    // Buscar motoristas na wait list
    let waitListDocs = [];
    if (cityKeyFilter) {
      const citySnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', status)
        .where('cityKey', '==', cityKeyFilter)
        .get();
      waitListDocs = citySnapshot.docs
        .sort((a, b) => Number(a.data()?.position || 0) - Number(b.data()?.position || 0))
        .slice(offset, offset + parseInt(limit, 10));
    } else {
      const waitListSnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', status)
        .orderBy('position', 'asc')
        .offset(offset)
        .limit(parseInt(limit, 10))
        .get();
      waitListDocs = waitListSnapshot.docs;
    }

    const drivers = [];
    for (const doc of waitListDocs) {
      const waitListData = doc.data();
      
      // Buscar dados do motorista
      const userSnapshot = await admin.firestore().collection('users').doc(waitListData.driverId).get();
      if (userSnapshot.exists) {
        const userData = userSnapshot.data();
        drivers.push({
          id: doc.id,
          driverId: waitListData.driverId,
          position: waitListData.position,
          status: waitListData.status,
          joinedAt: waitListData.joinedAt,
          priority: waitListData.priority,
          notes: waitListData.notes,
          cityKey: waitListData.cityKey || null,
          cityLabel: waitListData.cityLabel || null,
          stateCode: waitListData.stateCode || null,
          driver: {
            firstName: userData.firstName,
            lastName: userData.lastName,
            email: userData.email,
            mobile: userData.mobile,
            profileImage: userData.profile_image
          },
          documents: {
            cnhUploaded: userData.cnhUploaded || false,
            vehicleRegistered: userData.vehicleRegistered || false,
            documentsComplete: userData.documentsComplete || false
          }
        });
      }
    }

    // Buscar total de motoristas na wait list
    let totalQuery = admin.firestore()
      .collection('waitList')
      .where('status', '==', status);

    if (cityKeyFilter) {
      totalQuery = totalQuery.where('cityKey', '==', cityKeyFilter);
    }

    const totalSnapshot = await totalQuery.get();

    res.json({
      drivers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalSnapshot.size,
        pages: Math.ceil(totalSnapshot.size / limit)
      },
      filters: {
        status,
        city: cityKeyFilter || null
      }
    });

  } catch (error) {
    logger.error('Erro ao listar motoristas da wait list:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/waitlist/approve - Aprovar motorista da wait list (admin)
router.post('/api/waitlist/approve', requireFirebase, requireAdmin, async (req, res) => {
  try {
    const { driverId, notes = '' } = req.body;
    const adminId = req.user.uid;

    // Buscar entrada na wait list
    const waitListSnapshot = await admin.firestore()
      .collection('waitList')
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .get();

    if (waitListSnapshot.empty) {
      return res.status(404).json({ error: 'Motorista não está na wait list' });
    }

    const waitListDoc = waitListSnapshot.docs[0];
    const waitListData = waitListDoc.data();
    const position = waitListData.position;
    const cityKey = waitListData.cityKey || null;
    const stateCode = waitListData.stateCode || 'RJ';

    // Verificar se há vaga global
    const configSnapshot = await admin.firestore().collection('systemConfig').doc('waitList').get();
    const config = configSnapshot.exists
      ? configSnapshot.data()
      : { maxActiveDrivers: WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS, currentActiveDrivers: 0 };

    if (config.currentActiveDrivers >= config.maxActiveDrivers) {
      return res.status(400).json({ error: 'Limite de motoristas ativos atingido' });
    }

    // Verificar limite por cidade
    const cityActivationConfig = await loadCityActivationConfig();
    const resolvedCity = resolveCityConfigFromActivation(cityActivationConfig, cityKey, stateCode);
    const cityCounts = await getCityWaitlistCounts(resolvedCity.cityKey);
    if (Number(cityCounts.approved || 0) >= Number(resolvedCity.maxActiveDrivers || WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS)) {
      return res.status(400).json({
        error: 'Limite de motoristas ativos atingido para esta cidade',
        city: {
          cityKey: resolvedCity.cityKey,
          cityLabel: resolvedCity.cityLabel,
          maxActiveDrivers: resolvedCity.maxActiveDrivers,
          currentActiveDrivers: cityCounts.approved
        }
      });
    }

    // Aprovar motorista
    await waitListDoc.ref.update({
      status: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      adminId,
      notes
    });

    // Atualizar status do usuário
    await admin.firestore().collection('users').doc(driverId).update({
      waitListStatus: 'approved',
      isActiveDriver: true,
      waitListApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
      waitListReason: notes,
      waitListCityKey: resolvedCity.cityKey,
      waitListCityLabel: waitListData.cityLabel || resolvedCity.cityLabel,
      waitListStateCode: resolvedCity.stateCode
    });

    // Atualizar contador de motoristas ativos
    await admin.firestore().collection('systemConfig').doc('waitList').set({
      ...config,
      currentActiveDrivers: config.currentActiveDrivers + 1
    }, { merge: true });

    // Ajustar posições dos outros motoristas (apenas mesma cidade)
    let otherWaitListSnapshot = null;
    if (cityKey) {
      otherWaitListSnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', 'pending')
        .where('cityKey', '==', cityKey)
        .get();
    } else {
      otherWaitListSnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', 'pending')
        .where('position', '>', position)
        .get();
    }

    const batch = admin.firestore().batch();
    otherWaitListSnapshot.docs
      .filter((doc) => Number(doc.data()?.position || 0) > Number(position || 0))
      .forEach(doc => {
      batch.update(doc.ref, {
        position: doc.data().position - 1
      });
      });
    await batch.commit();

    logger.info(`Motorista ${driverId} aprovado da wait list por admin ${adminId}`, {
      cityKey: resolvedCity.cityKey
    });

    res.json({
      success: true,
      message: 'Motorista aprovado com sucesso',
      city: {
        cityKey: resolvedCity.cityKey,
        cityLabel: resolvedCity.cityLabel,
        maxActiveDrivers: resolvedCity.maxActiveDrivers,
        currentActiveDrivers: Number(cityCounts.approved || 0) + 1
      }
    });

  } catch (error) {
    logger.error('Erro ao aprovar motorista da wait list:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/waitlist/reject - Rejeitar motorista da wait list (admin)
router.post('/api/waitlist/reject', requireFirebase, requireAdmin, async (req, res) => {
  try {
    const { driverId, reason = '' } = req.body;
    const adminId = req.user.uid;

    // Buscar entrada na wait list
    const waitListSnapshot = await admin.firestore()
      .collection('waitList')
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .get();

    if (waitListSnapshot.empty) {
      return res.status(404).json({ error: 'Motorista não está na wait list' });
    }

    const waitListDoc = waitListSnapshot.docs[0];
    const position = waitListDoc.data().position;
    const cityKey = waitListDoc.data().cityKey || null;

    // Rejeitar motorista
    await waitListDoc.ref.update({
      status: 'rejected',
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      adminId,
      reason
    });

    // Atualizar status do usuário
    await admin.firestore().collection('users').doc(driverId).update({
      waitListStatus: 'rejected',
      waitListRejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      waitListReason: reason,
      waitListPosition: null
    });

    // Ajustar posições dos outros motoristas (mesma cidade)
    let otherWaitListSnapshot = null;
    if (cityKey) {
      otherWaitListSnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', 'pending')
        .where('cityKey', '==', cityKey)
        .get();
    } else {
      otherWaitListSnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', 'pending')
        .where('position', '>', position)
        .get();
    }

    const batch = admin.firestore().batch();
    otherWaitListSnapshot.docs
      .filter((doc) => Number(doc.data()?.position || 0) > Number(position || 0))
      .forEach(doc => {
      batch.update(doc.ref, {
        position: doc.data().position - 1
      });
      });
    await batch.commit();

    logger.info(`Motorista ${driverId} rejeitado da wait list por admin ${adminId}`, {
      cityKey
    });

    res.json({
      success: true,
      message: 'Motorista rejeitado com sucesso'
    });

  } catch (error) {
    logger.error('Erro ao rejeitar motorista da wait list:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/waitlist/position - Ajustar posição na wait list (admin)
router.put('/api/waitlist/position', requireFirebase, requireAdmin, async (req, res) => {
  try {
    const { driverId, newPosition } = req.body;
    const adminId = req.user.uid;

    // Buscar entrada na wait list
    const waitListSnapshot = await admin.firestore()
      .collection('waitList')
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .get();

    if (waitListSnapshot.empty) {
      return res.status(404).json({ error: 'Motorista não está na wait list' });
    }

    const waitListDoc = waitListSnapshot.docs[0];
    const currentPosition = waitListDoc.data().position;
    const cityKey = waitListDoc.data().cityKey || null;

    // Buscar total de motoristas na wait list (mesma cidade)
    let totalQuery = admin.firestore()
      .collection('waitList')
      .where('status', '==', 'pending');

    if (cityKey) {
      totalQuery = totalQuery.where('cityKey', '==', cityKey);
    }

    const totalSnapshot = await totalQuery.get();

    if (newPosition < 1 || newPosition > totalSnapshot.size) {
      return res.status(400).json({ error: 'Posição inválida' });
    }

    // Ajustar posições
    const batch = admin.firestore().batch();
    
    if (newPosition > currentPosition) {
      // Movendo para baixo
      let otherWaitListSnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', 'pending')
        .get();

      if (cityKey) {
        otherWaitListSnapshot = {
          docs: otherWaitListSnapshot.docs.filter(
            (doc) => String(doc.data()?.cityKey || '') === String(cityKey || '')
          )
        };
      }

      otherWaitListSnapshot.docs
        .filter((doc) => {
          const pos = Number(doc.data()?.position || 0);
          return pos > Number(currentPosition || 0) && pos <= Number(newPosition || 0);
        })
        .forEach(doc => {
        batch.update(doc.ref, {
          position: doc.data().position - 1
        });
        });
    } else if (newPosition < currentPosition) {
      // Movendo para cima
      let otherWaitListSnapshot = await admin.firestore()
        .collection('waitList')
        .where('status', '==', 'pending')
        .get();

      if (cityKey) {
        otherWaitListSnapshot = {
          docs: otherWaitListSnapshot.docs.filter(
            (doc) => String(doc.data()?.cityKey || '') === String(cityKey || '')
          )
        };
      }

      otherWaitListSnapshot.docs
        .filter((doc) => {
          const pos = Number(doc.data()?.position || 0);
          return pos >= Number(newPosition || 0) && pos < Number(currentPosition || 0);
        })
        .forEach(doc => {
        batch.update(doc.ref, {
          position: doc.data().position + 1
        });
        });
    }

    // Atualizar posição do motorista
    batch.update(waitListDoc.ref, {
      position: newPosition,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: adminId
    });

    await batch.commit();

    logger.info(`Posição do motorista ${driverId} ajustada para ${newPosition} por admin ${adminId}`);

    res.json({
      success: true,
      message: 'Posição ajustada com sucesso'
    });

  } catch (error) {
    logger.error('Erro ao ajustar posição na wait list:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/waitlist/stats - Estatísticas da wait list (admin)
router.get('/api/waitlist/stats', requireFirebase, requireAdmin, async (req, res) => {
  try {
    // Buscar configurações
    const configSnapshot = await admin.firestore().collection('systemConfig').doc('waitList').get();
    const config = configSnapshot.exists ? configSnapshot.data() : {
      maxActiveDrivers: WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS,
      currentActiveDrivers: 0,
      waitListEnabled: true
    };

    // Buscar estatísticas da wait list
    const pendingSnapshot = await admin.firestore()
      .collection('waitList')
      .where('status', '==', 'pending')
      .get();

    const approvedSnapshot = await admin.firestore()
      .collection('waitList')
      .where('status', '==', 'approved')
      .get();

    const rejectedSnapshot = await admin.firestore()
      .collection('waitList')
      .where('status', '==', 'rejected')
      .get();

    const [pendingCitySnapshot, approvedCitySnapshot, rejectedCitySnapshot] = await Promise.all([
      admin.firestore().collection('waitList').where('status', '==', 'pending').get(),
      admin.firestore().collection('waitList').where('status', '==', 'approved').get(),
      admin.firestore().collection('waitList').where('status', '==', 'rejected').get()
    ]);

    const cityStatsMap = {};
    const addCityCounter = (docData, counterField) => {
      const cityKey = docData.cityKey || 'unknown';
      if (!cityStatsMap[cityKey]) {
        cityStatsMap[cityKey] = {
          cityKey,
          cityLabel: docData.cityLabel || cityKey,
          stateCode: docData.stateCode || 'NA',
          pending: 0,
          approved: 0,
          rejected: 0
        };
      }
      cityStatsMap[cityKey][counterField] += 1;
    };

    pendingCitySnapshot.docs.forEach((doc) => addCityCounter(doc.data(), 'pending'));
    approvedCitySnapshot.docs.forEach((doc) => addCityCounter(doc.data(), 'approved'));
    rejectedCitySnapshot.docs.forEach((doc) => addCityCounter(doc.data(), 'rejected'));

    const cityActivationConfig = await loadCityActivationConfig();
    const cityCapIndex = {};
    const states = cityActivationConfig?.states || {};
    Object.values(states).forEach((state) => {
      Object.values(state?.cities || {}).forEach((city) => {
        cityCapIndex[city.key] = {
          maxActiveDrivers: Number(city.maxActiveDrivers || WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS),
          waitlistEnabled: city.waitlistEnabled !== false,
          active: city.active !== false,
          stateEnabled: state.enabled !== false
        };
      });
    });

    // Calcular tempo médio de espera
    const now = new Date();
    let totalWaitTime = 0;
    let count = 0;

    for (const doc of approvedSnapshot.docs) {
      const data = doc.data();
      if (data.joinedAt && data.approvedAt) {
        const joinedAt = data.joinedAt.toDate();
        const approvedAt = data.approvedAt.toDate();
        const waitTime = (approvedAt - joinedAt) / (1000 * 60 * 60 * 24); // dias
        totalWaitTime += waitTime;
        count++;
      }
    }

    const avgWaitTime = count > 0 ? totalWaitTime / count : 0;
    const byCity = Object.values(cityStatsMap)
      .map((cityItem) => {
        const capData = cityCapIndex[cityItem.cityKey] || {
          maxActiveDrivers: WAITLIST_DEFAULT_MAX_ACTIVE_DRIVERS,
          waitlistEnabled: true,
          active: true,
          stateEnabled: true
        };
        return {
          ...cityItem,
          maxActiveDrivers: capData.maxActiveDrivers,
          availableSlots: Math.max(0, capData.maxActiveDrivers - cityItem.approved),
          waitlistEnabled: capData.waitlistEnabled,
          cityActive: capData.active,
          stateEnabled: capData.stateEnabled
        };
      })
      .sort((a, b) => String(a.cityLabel || '').localeCompare(String(b.cityLabel || ''), 'pt-BR'));

    res.json({
      config,
      stats: {
        pending: pendingSnapshot.size,
        approved: approvedSnapshot.size,
        rejected: rejectedSnapshot.size,
        total: pendingSnapshot.size + approvedSnapshot.size + rejectedSnapshot.size,
        avgWaitTime: Math.round(avgWaitTime * 10) / 10, // 1 casa decimal
        availableSlots: config.maxActiveDrivers - config.currentActiveDrivers
      },
      byCity
    });

  } catch (error) {
    logger.error('Erro ao buscar estatísticas da wait list:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==================== LISTA DE ESPERA DA LANDING PAGE (DASHBOARD) ====================

/**
 * GET /api/waitlist/landing/list - Listar todos os cadastros da waitlist (Dashboard)
 * Query params: page, limit, search, status
 */
router.get('/api/waitlist/landing/list', requireFirebase, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      status // 'pending', 'contacted', 'converted', 'all'
    } = req.query;

    const firestore = admin.firestore();
    let query = firestore.collection('waitlist_landing').orderBy('timestamp', 'desc');

    // Aplicar filtro de status
    if (status && status !== 'all') {
      query = query.where('status', '==', status);
    }

    // Buscar todos os documentos
    const snapshot = await query.get();
    
    let waitlist = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      waitlist.push({
        id: doc.id,
        nome: data.nome || '',
        sobrenome: data.sobrenome || '', // Pode não existir, será extraído do nome se necessário
        celular: data.celular || '',
        cidade: data.cidade || '',
        status: data.status || 'pending',
        timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null,
        origem: data.origem || 'landing_page',
        ip: data.ip || '',
        userAgent: data.userAgent || ''
      });
    });

    // Extrair sobrenome do nome se não existir campo separado
    waitlist = waitlist.map(item => {
      if (!item.sobrenome && item.nome) {
        const nameParts = item.nome.trim().split(/\s+/);
        if (nameParts.length > 1) {
          item.nome = nameParts[0];
          item.sobrenome = nameParts.slice(1).join(' ');
        } else {
          item.sobrenome = '';
        }
      }
      return item;
    });

    // Aplicar busca (nome, sobrenome, celular, cidade)
    if (search) {
      const searchLower = search.toLowerCase();
      waitlist = waitlist.filter(item => 
        item.nome.toLowerCase().includes(searchLower) ||
        item.sobrenome.toLowerCase().includes(searchLower) ||
        item.celular.includes(search) ||
        item.cidade.toLowerCase().includes(searchLower)
      );
    }

    // Paginação
    const total = waitlist.length;
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedWaitlist = waitlist.slice(startIndex, endIndex);

    // Estatísticas
    const stats = {
      total,
      pending: waitlist.filter(item => item.status === 'pending').length,
      contacted: waitlist.filter(item => item.status === 'contacted').length,
      converted: waitlist.filter(item => item.status === 'converted').length,
      today: waitlist.filter(item => {
        if (!item.timestamp) return false;
        const itemDate = new Date(item.timestamp);
        const today = new Date();
        return itemDate.toDateString() === today.toDateString();
      }).length
    };

    res.json({
      success: true,
      waitlist: paginatedWaitlist,
      stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('❌ Erro ao listar waitlist:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * PATCH /api/waitlist/landing/:id/status - Atualizar status de um cadastro
 * Body: { status: 'pending' | 'contacted' | 'converted' }
 */
router.patch('/api/waitlist/landing/:id/status', requireFirebase, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'contacted', 'converted'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const firestore = admin.firestore();
    await firestore.collection('waitlist_landing').doc(id).update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info(`Status da waitlist atualizado: ${id} -> ${status}`);

    res.json({
      success: true,
      message: 'Status atualizado com sucesso',
      id,
      status
    });

  } catch (error) {
    logger.error(`❌ Erro ao atualizar status da waitlist ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * DELETE /api/waitlist/landing/:id - Remover cadastro da waitlist
 */
router.delete('/api/waitlist/landing/:id', requireFirebase, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const firestore = admin.firestore();
    
    await firestore.collection('waitlist_landing').doc(id).delete();

    logger.info(`Cadastro removido da waitlist: ${id}`);

    res.json({
      success: true,
      message: 'Cadastro removido com sucesso',
      id
    });

  } catch (error) {
    logger.error(`❌ Erro ao remover cadastro da waitlist ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

module.exports = router;
