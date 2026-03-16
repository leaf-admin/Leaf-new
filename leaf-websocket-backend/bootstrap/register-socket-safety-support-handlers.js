function registerSocketSafetySupportHandlers({
    socket,
    io,
    logStructured
}) {
    // ==================== NOVOS EVENTOS - SISTEMA DE SEGURANÇA ====================

    // Reportar incidente
    socket.on('reportIncident', async (data) => {
        try {
            logStructured('info', 'Incidente reportado', {
                service: 'server',
                userId: socket.userId || socket.id,
                type: data?.type,
                eventType: 'reportIncident'
            });

            const { type, description, evidence, location, timestamp } = data;

            if (!type || !description) {
                socket.emit('incidentReportError', { error: 'Tipo e descrição obrigatórios' });
                return;
            }

            // Simular processamento do incidente
            const incidentData = {
                reportId: `incident_${Date.now()}`,
                type,
                description,
                evidence: evidence || [],
                location,
                status: 'under_review',
                priority: type === 'safety' ? 'high' : 'medium',
                timestamp: timestamp || new Date().toISOString()
            };

            // Emitir confirmação
            socket.emit('incidentReported', {
                success: true,
                reportId: incidentData.reportId,
                message: 'Incidente reportado com sucesso',
                data: incidentData
            });

            logStructured('info', 'Incidente reportado com sucesso', {
                service: 'server',
                userId: socket.userId || socket.id,
                reportId: incidentData.reportId,
                type,
                priority: incidentData.priority,
                eventType: 'reportIncident'
            });

        } catch (error) {
            logStructured('error', 'Erro ao reportar incidente', {
                service: 'websocket',
                operation: 'reportIncident',
                userId: socket.userId || socket.id,
                error: error.message
            });
            socket.emit('incidentReportError', { error: 'Erro interno do servidor' });
        }
    });

    // Contato de emergência
    socket.on('emergencyContact', async (data) => {
        try {
            logStructured('warn', 'Contato de emergência recebido', {
                service: 'server',
                userId: socket.userId || socket.id,
                contactType: data?.contactType,
                eventType: 'emergencyContact'
            });

            const { contactType, location, message } = data;

            if (!contactType) {
                socket.emit('emergencyError', { error: 'Tipo de contato obrigatório' });
                return;
            }

            // Simular contato de emergência
            const emergencyData = {
                emergencyId: `emergency_${Date.now()}`,
                contactType,
                location,
                message: message || 'Solicitação de emergência',
                status: 'contacted',
                estimatedResponseTime: contactType === 'police' ? 5 : 10,
                timestamp: new Date().toISOString()
            };

            // Emitir confirmação
            socket.emit('emergencyContacted', {
                success: true,
                emergencyId: emergencyData.emergencyId,
                contactType,
                estimatedResponseTime: emergencyData.estimatedResponseTime,
                message: 'Contato de emergência realizado'
            });

            logStructured('warn', 'Contato de emergência realizado', {
                service: 'server',
                userId: socket.userId || socket.id,
                emergencyId: emergencyData.emergencyId,
                contactType,
                estimatedResponseTime: emergencyData.estimatedResponseTime,
                eventType: 'emergencyContact'
            });

        } catch (error) {
            logStructured('error', 'Erro no contato de emergência', {
                service: 'websocket',
                operation: 'emergencyContact',
                userId: socket.userId || socket.id,
                error: error.message
            });
            socket.emit('emergencyError', { error: 'Erro interno do servidor' });
        }
    });

    // ==================== NOVOS EVENTOS - SISTEMA DE SUPORTE ====================

    // 💬 CHAT DE SUPORTE EM TEMPO REAL (Redis Pub/Sub + Firestore)
    socket.on('support:chat:message', async (data) => {
        try {
            const SupportChatService = require('../services/support-chat-service');
            const supportChatService = SupportChatService;

            // Injetar io se ainda não foi injetado
            if (!supportChatService.io) {
                supportChatService.setIOInstance(io);
            }

            const { userId, message, senderType = 'user' } = data;

            if (!userId || !message) {
                socket.emit('support:chat:error', { error: 'Dados inválidos' });
                return;
            }

            logStructured('info', 'Nova mensagem no chat de suporte', {
                service: 'server',
                userId,
                senderType,
                eventType: 'supportChat'
            });

            // ✅ Enviar via SupportChatService (Redis Pub/Sub + Firestore)
            const result = await supportChatService.sendMessage(userId, message, senderType);

            // Confirmar recebimento
            socket.emit('support:chat:sent', {
                success: true,
                messageId: result.message.id
            });

        } catch (error) {
            logStructured('error', 'Erro ao processar mensagem de chat', {
                service: 'websocket',
                operation: 'supportChat',
                userId: socket.userId || socket.id,
                error: error.message
            });
            socket.emit('support:chat:error', { error: 'Erro interno do servidor' });
        }
    });

    // Criar ticket de suporte
    socket.on('createSupportTicket', async (data) => {
        try {
            logStructured('info', 'Ticket de suporte recebido', {
                service: 'websocket',
                operation: 'createSupportTicket',
                userId: socket.userId || socket.id,
                type: data.type
            });

            const { type, priority, description, attachments } = data;

            if (!type || !description) {
                socket.emit('supportTicketError', { error: 'Tipo e descrição obrigatórios' });
                return;
            }

            // Simular criação do ticket
            const ticketData = {
                ticketId: `ticket_${Date.now()}`,
                type,
                priority: priority || 'N3',
                description,
                attachments: attachments || [],
                status: 'open',
                estimatedResponseTime: priority === 'N1' ? 30 : priority === 'N2' ? 120 : 480, // minutos
                timestamp: new Date().toISOString()
            };

            // Emitir confirmação
            socket.emit('supportTicketCreated', {
                success: true,
                ticketId: ticketData.ticketId,
                estimatedResponseTime: ticketData.estimatedResponseTime,
                message: 'Ticket de suporte criado com sucesso',
                data: ticketData
            });

            logStructured('info', 'Ticket de suporte criado com sucesso', {
                service: 'websocket',
                operation: 'createSupportTicket',
                ticketId: ticketData.ticketId,
                priority: ticketData.priority
            });

        } catch (error) {
            logStructured('error', 'Erro ao criar ticket de suporte', {
                service: 'websocket',
                operation: 'createSupportTicket',
                userId: socket.userId || socket.id,
                error: error.message
            });
            socket.emit('supportTicketError', { error: 'Erro interno do servidor' });
        }
    });
}

module.exports = registerSocketSafetySupportHandlers;
