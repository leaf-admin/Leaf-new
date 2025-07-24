const express = require('express');
const router = express.Router();

router.post('/woovi-webhook', (req, res) => {
  // Log para debug (remova em produção se quiser)
  console.log('Webhook recebido da Woovi:', req.body);

  // Sempre responda 200 OK rapidamente!
  res.status(200).json({ received: true });
});

module.exports = router; 