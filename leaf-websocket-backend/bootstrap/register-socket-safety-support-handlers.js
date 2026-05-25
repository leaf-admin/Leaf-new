function registerSocketSafetySupportHandlers({
    socket,
    io,
    logStructured
}) {
    const safetyIncidentService = require('../services/safety-incident-service');
    const supportQueueService = require('../services/support-queue-service');

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

            const incidentData = await safetyIncidentService.createIncident({
                bookingId: data?.bookingId || null,
                userId: socket.userId || socket.id,
                userType: socket.userType || 'passenger',
                city: data?.city || data?.pickupCity || 'default',
                regionHash: data?.regionHash || '*',
                category: type || 'safety',
                severity: data?.severity || (type === 'emergency' ? 'critical' : 'high'),
                description,
                evidence: evidence || [],
                location: location || null,
                actorId: socket.userId || socket.id
            });

            // Emitir confirmação
            socket.emit('incidentReported', {
                success: true,
                reportId: incidentData.incidentId,
                incidentId: incidentData.incidentId,
                status: incidentData.status,
                slaTargetAt: incidentData.slaTargetAt,
                ticketId: incidentData.ticketId || null,
                message: 'Incidente reportado com sucesso',
                data: incidentData
            });

            logStructured('info', 'Incidente reportado com sucesso', {
                service: 'server',
                userId: socket.userId || socket.id,
                reportId: incidentData.incidentId,
                type,
                priority: incidentData.severity,
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

            const emergencyData = await safetyIncidentService.createIncident({
                bookingId: data?.bookingId || null,
                userId: socket.userId || socket.id,
                userType: socket.userType || 'passenger',
                city: data?.city || data?.pickupCity || 'default',
                regionHash: data?.regionHash || '*',
                category: 'emergency',
                severity: 'critical',
                description: message || 'Solicitação de emergência',
                evidence: [],
                location: location || null,
                actorId: socket.userId || socket.id
            });

            // Emitir confirmação
            socket.emit('emergencyContacted', {
                success: true,
                emergencyId: emergencyData.incidentId,
                incidentId: emergencyData.incidentId,
                contactType,
                estimatedResponseTime: contactType === 'police' ? 5 : 10,
                status: emergencyData.status,
                slaTargetAt: emergencyData.slaTargetAt,
                message: 'Contato de emergência realizado'
            });

            logStructured('warn', 'Contato de emergência realizado', {
                service: 'server',
                userId: socket.userId || socket.id,
                emergencyId: emergencyData.incidentId,
                contactType,
                estimatedResponseTime: contactType === 'police' ? 5 : 10,
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

            const { ticket, queue } = await supportQueueService.createSupportTicket({
                subject: data.subject || `${type} support request`,
                description,
                category: ['technical', 'payment', 'account', 'general'].includes(type) ? type : 'general',
                priority: priority || 'N3',
                requesterId: socket.userId || socket.id,
                userType: socket.userType || 'passenger',
                metadata: {
                    source: 'socket_support',
                    attachments: attachments || [],
                    bookingId: data.bookingId || null
                }
            });

            // Emitir confirmação
            socket.emit('supportTicketCreated', {
                success: true,
                ticketId: ticket.id,
                estimatedResponseTime: queue?.slaMinutes?.firstResponse || 240,
                ackTargetAt: queue?.ackTargetAt || null,
                firstResponseTargetAt: queue?.firstResponseTargetAt || null,
                message: 'Ticket de suporte criado com sucesso',
                data: ticket
            });

            logStructured('info', 'Ticket de suporte criado com sucesso', {
                service: 'websocket',
                operation: 'createSupportTicket',
                ticketId: ticket.id,
                priority: ticket.priority
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
