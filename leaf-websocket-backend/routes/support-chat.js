/**
 * 💬 ROTAS DE API PARA CHAT DE SUPORTE
 * 
 * Endpoints REST para:
 * - Buscar histórico de mensagens
 * - Marcar como lida
 * - Estatísticas
 */

const express = require('express');
const router = express.Router();
const supportChatService = require('../services/support-chat-service');
const backofficeCostGuardService = require('../services/backoffice-cost-guard-service');
const { authenticateSupport, canAccessUserScope, isSupportAgent } = require('../middleware/support-auth');
const { logger } = require('../utils/logger');

/**
 * GET /api/support/chat/inbox
 * Listar chats N0 ativos para atendimento simples.
 */
router.get('/chat/inbox', authenticateSupport, async (req, res) => {
    try {
        if (!isSupportAgent(req.user)) {
            return res.status(403).json({ error: 'Apenas agentes podem listar chats' });
        }

        const limit = parseInt(req.query.limit, 10) || 50;
        const includeClosed = String(req.query.includeClosed || '').toLowerCase() === 'true';
        const chats = await supportChatService.listActiveChats({ limit, includeClosed });

        const payload = await backofficeCostGuardService.attachToResponse(
            res,
            'support.chat.inbox',
            {
                success: true,
                chats,
                count: chats.length
            },
            { limit, includeClosed }
        );

        res.json(payload);
    } catch (error) {
        logger.error('❌ Erro ao listar inbox de chat:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * GET /api/support/chat/:userId/history
 * Buscar histórico de mensagens
 */
router.get('/chat/:userId/history', authenticateSupport, async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const includeArchived = String(req.query.includeArchived || 'true').toLowerCase() !== 'false';

        // Verificar se usuário tem permissão (próprio usuário ou admin)
        if (!canAccessUserScope(req.user, userId)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const messages = await supportChatService.getMessageHistory(userId, limit, { includeArchived });

        const payload = await backofficeCostGuardService.attachToResponse(
            res,
            'support.chat.history',
            {
                success: true,
                messages,
                count: messages.length
            },
            { limit, includeArchived }
        );

        res.json(payload);

    } catch (error) {
        logger.error('❌ Erro ao buscar histórico:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * POST /api/support/chat/:userId/mark-read
 * Marcar mensagens como lidas
 */
router.post('/chat/:userId/mark-read', authenticateSupport, async (req, res) => {
    try {
        const { userId } = req.params;
        const { messageIds } = req.body;

        // Verificar se usuário tem permissão
        if (!canAccessUserScope(req.user, userId)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        await supportChatService.markAsRead(userId, messageIds || []);

        res.json({
            success: true,
            message: 'Mensagens marcadas como lidas'
        });

    } catch (error) {
        logger.error('❌ Erro ao marcar como lida:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * POST /api/support/chat/:userId/message
 * Enviar mensagem (REST fallback, preferir WebSocket)
 */
router.post('/chat/:userId/message', authenticateSupport, async (req, res) => {
    try {
        const { userId } = req.params;
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Mensagem é obrigatória' });
        }

        // Verificar se usuário tem permissão
        if (!canAccessUserScope(req.user, userId)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        // ✅ Verificar se o chat não está encerrado
        const chatStatus = await supportChatService.getChatStatus(userId);
        if (chatStatus.status === 'closed') {
            const reopenResult = await supportChatService.reopenChatForOpenTicket(userId, 'incoming_message_after_closed');
            if (!reopenResult.reopened) {
                return res.status(400).json({ error: 'Chat já está encerrado' });
            }
        }

        const result = await supportChatService.sendMessage(
            userId,
            message.trim(),
            isSupportAgent(req.user) ? 'agent' : 'user'
        );

        res.json({
            success: true,
            message: result.message
        });

    } catch (error) {
        logger.error('❌ Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * POST /api/support/chat/:userId/convert-ticket
 * Converter um chat N0 em chamado operacional.
 */
router.post('/chat/:userId/convert-ticket', authenticateSupport, async (req, res) => {
    try {
        if (!isSupportAgent(req.user)) {
            return res.status(403).json({ error: 'Apenas agentes podem converter chats em chamados' });
        }

        const { userId } = req.params;
        const {
            subject,
            description,
            category = 'chat',
            priority = 'N3',
            userInfo = {},
            metadata = {}
        } = req.body || {};

        const actorId = req.user?.id || req.user?.uid || req.user?.email || 'support-agent';
        const result = await supportChatService.convertChatToTicket(userId, {
            subject,
            description,
            category,
            priority,
            actorId,
            userInfo,
            metadata
        });

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        logger.error('❌ Erro ao converter chat em ticket:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * POST /api/support/chat/:userId/close
 * ✅ Encerrar chat e salvar todas as mensagens no Firestore
 */
router.post('/chat/:userId/close', authenticateSupport, async (req, res) => {
    try {
        const { userId } = req.params;
        const { closedBy = 'agent' } = req.body;

        // Verificar se usuário tem permissão (apenas admin/manager pode encerrar)
        if (!isSupportAgent(req.user)) {
            return res.status(403).json({ error: 'Apenas administradores podem encerrar chats' });
        }

        // ✅ Verificar se o chat não está já encerrado
        const chatStatus = await supportChatService.getChatStatus(userId);
        if (chatStatus.status === 'closed') {
            return res.status(400).json({ error: 'Chat já está encerrado' });
        }

        // ✅ Encerrar chat e salvar no Firestore
        const result = await supportChatService.closeChat(userId, closedBy);

        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        logger.error('❌ Erro ao encerrar chat:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * GET /api/support/chat/:userId/status
 * ✅ Obter status do chat
 */
router.get('/chat/:userId/status', authenticateSupport, async (req, res) => {
    try {
        const { userId } = req.params;

        // Verificar se usuário tem permissão
        if (!canAccessUserScope(req.user, userId)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const status = await supportChatService.getChatStatus(userId);

        res.json({
            success: true,
            status
        });

    } catch (error) {
        logger.error('❌ Erro ao obter status do chat:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

module.exports = router;
