const express = require('express');
const { logStructured, logError } = require('../utils/logger');
const router = express.Router();

// Teste simples de rota
router.post('/login', (req, res) => {
    logStructured('info', '🔍 Rota /auth/login chamada!', { service: 'auth-routes-debug-routes' });
    logStructured('info', '📊 Body:', req.body, { service: 'auth-routes-debug-routes' });
    
    res.json({
        success: true,
        message: 'Rota funcionando!',
        data: req.body
    });
});

module.exports = router;



