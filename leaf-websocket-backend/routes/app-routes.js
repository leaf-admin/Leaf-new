const express = require('express');
const { logStructured, logError } = require('../utils/logger');
const router = express.Router();

/**
 * GET /api/app/info
 * Buscar informações do app
 */
router.get('/info', async (req, res) => {
    try {
        const appInfo = {
            version: '1.0.0',
            buildNumber: '1',
            lastUpdate: new Date().toISOString().split('T')[0],
            features: [
                { icon: 'card-outline', title: 'Pagamento PIX', description: 'Pagamento instantâneo e seguro via PIX' },
                { icon: 'shield-checkmark-outline', title: 'Segurança Total', description: 'Motoristas verificados e viagens monitoradas' },
                { icon: 'location-outline', title: 'Rastreamento em Tempo Real', description: 'Acompanhe sua viagem em tempo real' },
                { icon: 'chatbubbles-outline', title: 'Suporte 24/7', description: 'Suporte ao cliente disponível 24 horas' },
            ],
            team: [],
            changelog: [
                {
                    version: '1.0.0',
                    date: new Date().toISOString().split('T')[0],
                    title: 'Lançamento Inicial',
                    description: '• Integração completa com Woovi PIX\n• Sistema de busca de motoristas\n• Rastreamento em tempo real\n• Chat integrado\n• Dashboard para motoristas\n• Conta Leaf BaaS'
                }
            ]
        };

        res.json(appInfo);
    } catch (error) {
        logError(error, '❌ Erro ao buscar informações do app:', { service: 'app-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar informações do app' });
    }
});

/**
 * GET /api/app/stats
 * Buscar estatísticas do app
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = {
            activeUsers: '50K+',
            totalTrips: '100K+',
            averageRating: '4.8'
        };

        res.json(stats);
    } catch (error) {
        logError(error, '❌ Erro ao buscar estatísticas:', { service: 'app-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

module.exports = router;

