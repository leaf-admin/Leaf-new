const {
    assertRideParticipant,
    getSocketIdentity,
    isSupportActor,
    normalizeSocketTextMessage,
    resolveSupportChatAuthorization
} = require('../services/socket-scope-guard');

const {
    classifySupportTicketSeverity
} = require('../services/support-severity-classifier');

const INCIDENT_SEVERITY_RANK = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
};

function normalizeIncidentSeverity(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return INCIDENT_SEVERITY_RANK[normalized] ? normalized : null;
}

function severityToPriority(severity) {
    const normalized = normalizeIncidentSeverity(severity);
    if (normalized === 'critical' || normalized === 'high') return 'N1';
    return 'N3';
}

function defaultIncidentSeverity(category) {
    const normalized = String(category || 'safety').trim().toLowerCase();
    if (normalized === 'emergency') return 'critical';
    if (normalized === 'safety') return 'high';
    return 'medium';
}

function strongerIncidentSeverity(left, right) {
    const safeLeft = normalizeIncidentSeverity(left) || 'medium';
    const safeRight = normalizeIncidentSeverity(right) || 'medium';
    return INCIDENT_SEVERITY_RANK[safeLeft] >= INCIDENT_SEVERITY_RANK[safeRight]
        ? safeLeft
        : safeRight;
}

function resolveIncidentSeverity({ type, description, requestedSeverity, requesterIsAgent }) {
    const category = String(type || 'safety').trim().toLowerCase();
    const requestedPriority = requesterIsAgent ? severityToPriority(requestedSeverity) : 'N3';
    const classification = classifySupportTicketSeverity({
        subject: `Incidente ${category}`,
        description,
        category: category === 'payment' ? 'payment' : 'general',
        requestedPriority,
        metadata: {
            source: requesterIsAgent ? 'dashboard' : 'app_incident_report'
        },
        requesterIsAgent
    });
    const classifiedSeverity = classification.priority === 'N1' ? 'critical' : defaultIncidentSeverity(category);
    const trustedRequestedSeverity = requesterIsAgent ? normalizeIncidentSeverity(requestedSeverity) : null;

    return {
        severity: trustedRequestedSeverity
            ? strongerIncidentSeverity(classifiedSeverity, trustedRequestedSeverity)
            : classifiedSeverity,
        classification
    };
}

function registerSocketSafetySupportHandlers({
    socket,
    io,
    logStructured,
    redisPool = null
}) {
    const safetyIncidentService = require('../services/safety-incident-service');
    const supportQueueService = require('../services/support-queue-service');

    function requireAuthenticatedIdentity(errorEventName) {
        const identity = getSocketIdentity(socket);
        if (identity.userId) {
            return identity;
        }

        socket.emit(errorEventName, {
            error: 'Autenticação obrigatória',
            code: 'AUTH_REQUIRED'
        });
        return null;
    }

    async function assertBookingScopedAction(data = {}, errorEventName) {
        const bookingId = data?.bookingId || data?.rideId || data?.tripId || null;
        if (!bookingId) {
            return { allowed: true, bookingId: null };
        }

        const participant = await assertRideParticipant({
            socket,
            io,
            redisPool,
            bookingId,
            allowedRoles: ['passenger', 'driver'],
            allowSupport: true
        });

        if (!participant.allowed) {
            socket.emit(errorEventName, {
                error: participant.error,
                code: participant.code
            });
            return {
                allowed: false,
                bookingId,
                participant
            };
        }

        return {
            allowed: true,
            bookingId: participant.scope?.bookingId || bookingId,
            participant
        };
    }

    // ==================== NOVOS EVENTOS - SISTEMA DE SEGURANÇA ====================

    // Reportar incidente
    socket.on('reportIncident', async (data) => {
        try {
            const identity = requireAuthenticatedIdentity('incidentReportError');
            if (!identity) {
                return;
            }

            logStructured('info', 'Incidente reportado', {
                service: 'server',
                userId: identity.userId,
                type: data?.type,
                eventType: 'reportIncident'
            });

            const { type, description, evidence, location, timestamp } = data;

            if (!type || !description) {
                socket.emit('incidentReportError', { error: 'Tipo e descrição obrigatórios' });
                return;
            }

            const bookingScope = await assertBookingScopedAction(data, 'incidentReportError');
            if (!bookingScope.allowed) {
                return;
            }

            const severityResolution = resolveIncidentSeverity({
                type,
                description,
                requestedSeverity: data?.severity,
                requesterIsAgent: isSupportActor(socket)
            });

            const incidentData = await safetyIncidentService.createIncident({
                bookingId: bookingScope.bookingId || null,
                userId: identity.userId,
                userType: identity.userType || 'passenger',
                city: data?.city || data?.pickupCity || 'default',
                regionHash: data?.regionHash || '*',
                category: type || 'safety',
                severity: severityResolution.severity,
                description,
                evidence: evidence || [],
                location: location || null,
                actorId: identity.userId
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
                userId: identity.userId,
                reportId: incidentData.incidentId,
                type,
                priority: incidentData.severity,
                prioritySource: severityResolution.classification.prioritySource,
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
            const identity = requireAuthenticatedIdentity('emergencyError');
            if (!identity) {
                return;
            }

            logStructured('warn', 'Contato de emergência recebido', {
                service: 'server',
                userId: identity.userId,
                contactType: data?.contactType,
                eventType: 'emergencyContact'
            });

            const { contactType, location, message } = data;

            if (!contactType) {
                socket.emit('emergencyError', { error: 'Tipo de contato obrigatório' });
                return;
            }

            const bookingScope = await assertBookingScopedAction(data, 'emergencyError');
            if (!bookingScope.allowed) {
                return;
            }

            const emergencyData = await safetyIncidentService.createIncident({
                bookingId: bookingScope.bookingId || null,
                userId: identity.userId,
                userType: identity.userType || 'passenger',
                city: data?.city || data?.pickupCity || 'default',
                regionHash: data?.regionHash || '*',
                category: 'emergency',
                severity: 'critical',
                description: message || 'Solicitação de emergência',
                evidence: [],
                location: location || null,
                actorId: identity.userId
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
                userId: identity.userId,
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

            const authz = resolveSupportChatAuthorization(socket, data);

            if (!authz.allowed) {
                socket.emit('support:chat:error', {
                    error: authz.error,
                    code: authz.code
                });
                return;
            }

            const messageValidation = normalizeSocketTextMessage(data?.message, { maxLength: 2000 });
            if (!messageValidation.valid) {
                socket.emit('support:chat:error', {
                    error: messageValidation.error,
                    code: messageValidation.code
                });
                return;
            }

            const userId = authz.userId;
            const senderType = authz.senderType;

            logStructured('info', 'Nova mensagem no chat de suporte', {
                service: 'server',
                userId,
                senderType,
                actorId: authz.identity.userId,
                eventType: 'supportChat'
            });

            // ✅ Enviar via SupportChatService (Redis Pub/Sub + Firestore)
            const result = await supportChatService.sendMessage(userId, messageValidation.text, senderType);

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
            const identity = requireAuthenticatedIdentity('supportTicketError');
            if (!identity) {
                return;
            }

            logStructured('info', 'Ticket de suporte recebido', {
                service: 'websocket',
                operation: 'createSupportTicket',
                userId: identity.userId,
                type: data.type
            });

            const { type, priority, description, attachments } = data;

            if (!type || !description) {
                socket.emit('supportTicketError', { error: 'Tipo e descrição obrigatórios' });
                return;
            }

            const bookingScope = await assertBookingScopedAction(data, 'supportTicketError');
            if (!bookingScope.allowed) {
                return;
            }

            const { ticket, queue } = await supportQueueService.createSupportTicket({
                subject: data.subject || `${type} support request`,
                description,
                category: ['technical', 'payment', 'account', 'general'].includes(type) ? type : 'general',
                priority: priority || 'N3',
                requesterId: identity.userId,
                userType: identity.userType || 'passenger',
                metadata: {
                    source: 'socket_support',
                    attachments: attachments || [],
                    bookingId: bookingScope.bookingId || null
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
