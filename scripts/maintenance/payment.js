const express = require('express');
const router = express.Router();
const PaymentService = require('../services/payment-service');

const paymentService = new PaymentService();

// Calcular valor líquido
router.get('/calculate-net', (req, res) => {
    try {
        const amount = parseInt(req.query.amount);
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                error: 'Amount is required and must be greater than 0'
            });
        }

        const result = paymentService.calculateNetAmount(amount);
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Erro ao calcular valor líquido:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

module.exports = router;









