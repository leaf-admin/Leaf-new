const express = require('express');
const { logStructured, logError } = require('../utils/logger');
const router = express.Router();

/**
 * GET /api/support/chat/:userId
 * Buscar mensagens do chat de suporte
 */
router.get('/chat/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        // TODO: Buscar mensagens do Firestore ou banco de dados
        res.json({ messages: [] });
    } catch (error) {
        logError(error, '❌ Erro ao buscar mensagens:', { service: 'support-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar mensagens' });
    }
});

/**
 * POST /api/support/chat/:userId/message
 * Enviar mensagem no chat de suporte
 */
router.post('/chat/:userId/message', async (req, res) => {
    try {
        const { userId } = req.params;
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Texto da mensagem é obrigatório' });
        }

        // TODO: Salvar mensagem no Firestore
        const messageId = `msg_${Date.now()}`;

        res.json({
            success: true,
            messageId,
            message: {
                id: messageId,
                text,
                sender: 'user',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        logError(error, '❌ Erro ao enviar mensagem:', { service: 'support-routes-routes' });
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
});

/**
 * GET /api/support/tickets/:userId
 * Buscar tickets de suporte do usuário
 */
router.get('/tickets/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        // TODO: Buscar tickets do Firestore ou banco de dados
        res.json({ tickets: [] });
    } catch (error) {
        logError(error, '❌ Erro ao buscar tickets:', { service: 'support-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar tickets' });
    }
});

/**
 * POST /api/support/tickets/:userId
 * Criar novo ticket de suporte
 */
router.post('/tickets/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { type, priority, description, attachments } = req.body;

        if (!type || !description) {
            return res.status(400).json({ error: 'Tipo e descrição são obrigatórios' });
        }

        // TODO: Salvar ticket no Firestore
        const ticketId = `ticket_${Date.now()}`;

        res.json({
            success: true,
            ticketId,
            ticket: {
                id: ticketId,
                userId,
                type,
                priority: priority || 'medium',
                description,
                status: 'open',
                createdAt: new Date().toISOString()
            }
        });
    } catch (error) {
        logError(error, '❌ Erro ao criar ticket:', { service: 'support-routes-routes' });
        res.status(500).json({ error: 'Erro ao criar ticket' });
    }
});

/**
 * GET /api/support/faq
 * Buscar FAQ de suporte
 */
router.get('/faq', async (req, res) => {
    try {
        const faqs = [
            { question: 'Como entrar em contato com o suporte?', answer: 'Você pode entrar em contato através do chat em tempo real, criando um ticket ou enviando um e-mail para suporte@leaf.com.br' },
            { question: 'Qual o horário de atendimento?', answer: 'Nosso suporte está disponível 24 horas por dia, 7 dias por semana.' },
            { question: 'Como criar um ticket?', answer: 'Na aba "Tickets", toque em "Novo Ticket" e preencha as informações solicitadas.' },
        ];

        res.json({ faqs });
    } catch (error) {
        logError(error, '❌ Erro ao buscar FAQ:', { service: 'support-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar FAQ' });
    }
});

module.exports = router;

