'use strict';

const { createHash } = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const rioBairros = require('../config/rio-bairros.json');
const { authenticateSupport, requireSupportRoles } = require('../middleware/support-auth');
const { logStructured, logError } = require('../utils/logger');

const router = express.Router();

const SITE_DATA_TTL_MS = 60 * 1000;
const REGION_GOALS = Object.freeze({ drivers: 10, passengers: 100 });
const ROLE_FIELDS = Object.freeze({ driver: 'drivers', passenger: 'passengers' });
const INVESTOR_ROLES = ['admin', 'manager', 'super-admin'];
const INVESTOR_LIST_LIMIT = 100;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const CITY_NAMES = ['Niterói', 'Duque de Caxias', 'São Gonçalo', 'Nova Iguaçu'];
const SITE_ORIGINS = new Set([
  'https://leaf.app.br',
  'https://www.leaf.app.br',
  ...String(process.env.PUBLIC_SITE_EXTRA_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
]);

function regionKey(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const REGION_NAMES = new Map(
  [...rioBairros.bairros.map((bairro) => bairro.name), ...CITY_NAMES].map((name) => [regionKey(name), name])
);

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas. Tente de novo em alguns minutos.' }
});

const firestore = () => firebaseConfig.getFirestore();
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const cleanText = (value, max) => String(value || '').trim().slice(0, max);

function requireSiteOrigin(req, res, next) {
  if (SITE_ORIGINS.has(req.headers.origin)) return next();
  return res.status(403).json({ success: false, error: 'Origem não permitida' });
}

// Campo invisível: quem preenche é robô. Responde sucesso e não grava nada.
function dropHoneypot(req, res, next) {
  if (req.body?.website) return res.json({ success: true });
  return next();
}

function validName(name) {
  return name.length >= 3 && !/[<>]/.test(name);
}

let siteDataCache = { expiresAt: 0, payload: null };

function publishedNumbers(snapshot) {
  const data = snapshot.exists ? snapshot.data() : null;
  if (data?.published !== true) return null;
  return { rides: Number(data.rides) || 0, drivers: Number(data.drivers) || 0 };
}

router.get('/api/public/site-data', async (_req, res) => {
  try {
    if (Date.now() >= siteDataCache.expiresAt) {
      const collection = firestore().collection('public_site');
      const [regions, numbers] = await Promise.all([
        collection.doc('regions').get(),
        collection.doc('numbers').get()
      ]);
      siteDataCache = {
        expiresAt: Date.now() + SITE_DATA_TTL_MS,
        payload: {
          success: true,
          goals: REGION_GOALS,
          regions: regions.exists ? regions.data() : {},
          numbers: publishedNumbers(numbers)
        }
      };
    }
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(siteDataCache.payload);
  } catch (error) {
    logError(error, { service: 'public-site', operation: 'siteData' });
    return res.status(500).json({ success: false, error: 'Dados indisponíveis' });
  }
});

router.post('/api/public/region-interest', formLimiter, requireSiteOrigin, dropHoneypot, async (req, res) => {
  try {
    const key = cleanText(req.body?.regionKey, 80);
    const role = req.body?.role;
    const nome = cleanText(req.body?.nome, 100);
    const celular = cleanText(req.body?.celular, 30).replace(/\D/g, '');
    const regionName = REGION_NAMES.get(key);
    if (!regionName) return res.status(400).json({ success: false, error: 'Região inválida' });
    if (!ROLE_FIELDS[role]) return res.status(400).json({ success: false, error: 'Perfil inválido' });
    if (!validName(nome)) return res.status(400).json({ success: false, error: 'Informe seu nome' });
    if (celular.length < 10 || celular.length > 13) {
      return res.status(400).json({ success: false, error: 'Informe um WhatsApp válido, com DDD' });
    }
    if (req.body?.consent !== true) {
      return res.status(400).json({ success: false, error: 'É preciso concordar com o contato' });
    }

    const db = firestore();
    const batch = db.batch();
    batch.create(db.collection('waitlist_landing').doc(`region_${hash(`${key}|${role}|${celular}`)}`), {
      nome,
      celular,
      cidade: regionName,
      regionKey: key,
      role,
      userType: role,
      origem: 'site_area_operacao',
      acquisitionChannel: 'site_region_request',
      status: 'pending',
      consentAt: new Date().toISOString(),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    batch.set(
      db.collection('public_site').doc('regions'),
      { [key]: { [ROLE_FIELDS[role]]: admin.firestore.FieldValue.increment(1) } },
      { merge: true }
    );
    await batch.commit();
    logStructured('info', 'Pedido de região pelo site', { service: 'public-site', regionKey: key, role });
    return res.status(201).json({ success: true });
  } catch (error) {
    if (error?.code === 6) return res.json({ success: true, alreadyRegistered: true });
    logError(error, { service: 'public-site', operation: 'regionInterest' });
    return res.status(500).json({ success: false, error: 'Não foi possível registrar agora' });
  }
});

router.post('/api/public/investor-interest', formLimiter, requireSiteOrigin, dropHoneypot, async (req, res) => {
  try {
    const nome = cleanText(req.body?.nome, 100);
    const email = cleanText(req.body?.email, 254).toLowerCase();
    if (!validName(nome)) return res.status(400).json({ success: false, error: 'Informe seu nome' });
    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ success: false, error: 'Informe um e-mail válido' });
    if (req.body?.consent !== true) {
      return res.status(400).json({ success: false, error: 'É preciso concordar com o contato' });
    }
    await firestore().collection('investor_leads').doc(hash(email)).set({
      nome,
      email,
      empresa: cleanText(req.body?.empresa, 120),
      mensagem: cleanText(req.body?.mensagem, 1000),
      status: 'pending',
      consentAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });
    logStructured('info', 'Contato de investidor pelo site', { service: 'public-site' });
    return res.status(201).json({ success: true });
  } catch (error) {
    logError(error, { service: 'public-site', operation: 'investorInterest' });
    return res.status(500).json({ success: false, error: 'Não foi possível registrar agora' });
  }
});

router.get(
  '/api/waitlist/investor-leads',
  authenticateSupport,
  requireSupportRoles(INVESTOR_ROLES),
  async (_req, res) => {
    try {
      const snapshot = await firestore().collection('investor_leads')
        .orderBy('createdAt', 'desc')
        .limit(INVESTOR_LIST_LIMIT)
        .get();
      return res.json({ success: true, leads: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
    } catch (error) {
      logError(error, { service: 'public-site', operation: 'listInvestorLeads' });
      return res.status(500).json({ success: false, error: 'Erro ao listar contatos' });
    }
  }
);

module.exports = router;
module.exports.regionKey = regionKey;
