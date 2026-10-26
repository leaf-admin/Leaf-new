'use strict';
const rateLimit = require('express-rate-limit');
let active = 0;

const rateLimiter = rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => String(req.user?.id || req.user?.uid || 'admin-unknown'),
  message: { error: 'Muitas consultas; aguarde antes de tentar novamente' } });

function run(handler) {
  return async (req, res, next) => {
    if (active >= 2) return res.status(503).json({ error: 'Listagem temporariamente ocupada' });
    active++;
    try { return await handler(req, res, next); }
    catch (error) { if (next) return next(error); throw error; }
    // HTTP close is not database cancellation. Keep the slot until work ends.
    finally { active--; }
  };
}

module.exports = { rateLimiter, run };
