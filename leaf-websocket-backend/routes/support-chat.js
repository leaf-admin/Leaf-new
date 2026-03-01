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
const { authenticateJWT } = require('../middleware/jwt-auth');
const { logger } = require('../utils/logger');

/**
 * GET /api/support/chat/:userId/history
 * Buscar histórico de mensagens
 */
router.get('/chat/:userId/history', authenticateJWT, async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 50;

        // Verificar se usuário tem permissão (próprio usuário ou admin)
        if (req.user.id !== userId && !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const messages = await supportChatService.getMessageHistory(userId, limit);

        res.json({
            success: true,
            messages,
            count: messages.length
        });

    } catch (error) {
        logger.error('❌ Erro ao buscar histórico:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * POST /api/support/chat/:userId/mark-read
 * Marcar mensagens como lidas
 */
router.post('/chat/:userId/mark-read', authenticateJWT, async (req, res) => {
    try {
        const { userId } = req.params;
        const { messageIds } = req.body;

        // Verificar se usuário tem permissão
        if (req.user.id !== userId && !['admin', 'manager'].includes(req.user.role)) {
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
router.post('/chat/:userId/message', authenticateJWT, async (req, res) => {
    try {
        const { userId } = req.params;
        const { message, senderType = 'user' } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Mensagem é obrigatória' });
        }

        // Verificar se usuário tem permissão
        if (req.user.id !== userId && !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        // ✅ Verificar se o chat não está encerrado
        const chatStatus = await supportChatService.getChatStatus(userId);
        if (chatStatus.status === 'closed') {
            return res.status(400).json({ error: 'Chat já está encerrado' });
        }

        const result = await supportChatService.sendMessage(
            userId,
            message.trim(),
            req.user.role === 'admin' || req.user.role === 'manager' ? 'agent' : senderType
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
 * POST /api/support/chat/:userId/close
 * ✅ Encerrar chat e salvar todas as mensagens no Firestore
 */
router.post('/chat/:userId/close', authenticateJWT, async (req, res) => {
    try {
        const { userId } = req.params;
        const { closedBy = 'agent' } = req.body;

        // Verificar se usuário tem permissão (apenas admin/manager pode encerrar)
        if (!['admin', 'manager'].includes(req.user.role)) {
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
router.get('/chat/:userId/status', authenticateJWT, async (req, res) => {
    try {
        const { userId } = req.params;

        // Verificar se usuário tem permissão
        if (req.user.id !== userId && !['admin', 'manager'].includes(req.user.role)) {
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

