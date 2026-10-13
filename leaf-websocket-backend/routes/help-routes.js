const express = require('express');
const { logStructured, logError } = require('../utils/logger');
const router = express.Router();

/**
 * GET /api/help/content
 * Buscar conteúdo de ajuda
 */
router.get('/content', async (req, res) => {
    try {
        const { category } = req.query;

        const content = {
            categories: [
                { id: 'getting-started', label: 'Primeiros Passos', icon: 'play-circle-outline' },
                { id: 'trips', label: 'Viagens', icon: 'car-outline' },
                { id: 'payments', label: 'Pagamentos', icon: 'card-outline' },
                { id: 'account', label: 'Conta', icon: 'person-outline' },
                { id: 'safety', label: 'Segurança', icon: 'shield-checkmark-outline' },
                { id: 'troubleshooting', label: 'Problemas', icon: 'construct-outline' }
            ],
            tutorials: [],
            guides: [],
            emergencyContacts: []
        };

        res.json(content);
    } catch (error) {
        logError(error, '❌ Erro ao buscar conteúdo de ajuda:', { service: 'help-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar conteúdo de ajuda' });
    }
});

/**
 * GET /api/help/faq
 * Buscar FAQ
 */
router.get('/faq', async (req, res) => {
    try {
        const { category } = req.query;

        const faqs = {
            'getting-started': [
                { question: 'Como criar uma conta?', answer: 'Para criar uma conta, baixe o app Leaf, abra e toque em "Criar conta". Informe seu número de telefone, nome completo e e-mail. Você receberá um código de verificação por SMS.' },
                { question: 'Como solicitar uma viagem?', answer: 'Abra o app, informe seu destino no mapa ou digite o endereço. Escolha o tipo de veículo e confirme. Um motorista próximo será notificado.' },
                { question: 'Como funciona o pagamento?', answer: 'O pagamento é feito via PIX antes da viagem começar. Você receberá um QR Code para pagar. Após a confirmação do pagamento, o motorista iniciará a viagem.' },
            ],
            'trips': [
                { question: 'Como cancelar uma viagem?', answer: 'Você pode cancelar uma viagem a qualquer momento antes do motorista iniciar a corrida. Toque na viagem ativa e selecione "Cancelar".' },
                { question: 'Como avaliar o motorista?', answer: 'Após a conclusão da viagem, você receberá uma solicitação para avaliar. Toque nas estrelas e deixe um comentário opcional.' },
            ],
            'payments': [
                { question: 'Quais formas de pagamento são aceitas?', answer: 'Atualmente aceitamos apenas pagamento via PIX. Em breve, adicionaremos outras formas de pagamento.' },
                { question: 'Como solicitar reembolso?', answer: 'Entre em contato com o suporte através do app ou e-mail. Forneça o número da viagem e o motivo do reembolso.' },
            ],
        };

        const result = category ? (faqs[category] || []) : Object.values(faqs).flat();

        res.json({ faqs: result });
    } catch (error) {
        logError(error, '❌ Erro ao buscar FAQ:', { service: 'help-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar FAQ' });
    }
});

/**
 * GET /api/help/tutorials
 * Buscar tutoriais
 */
router.get('/tutorials', async (req, res) => {
    try {
        const { category } = req.query;
        res.json({ tutorials: [] });
    } catch (error) {
        logError(error, '❌ Erro ao buscar tutoriais:', { service: 'help-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar tutoriais' });
    }
});

module.exports = router;

