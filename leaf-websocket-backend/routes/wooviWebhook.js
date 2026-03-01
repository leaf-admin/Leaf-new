const express = require('express');
const { logStructured, logError } = require('../utils/logger');
const router = express.Router();

router.post('/woovi-webhook', (req, res) => {
  // Log para debug (remova em produção se quiser)
  logStructured('info', 'Webhook recebido da Woovi:', req.body, { service: 'wooviWebhook-routes' });

  // Sempre responda 200 OK rapidamente!
  res.status(200).json({ received: true });
});

module.exports = router; 