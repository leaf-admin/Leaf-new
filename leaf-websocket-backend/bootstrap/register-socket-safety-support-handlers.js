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
const { publishSupportEvent } = require('../services/support-realtime-publisher');
const { serializeSupportTicket } = require('../services/support-visibility-policy');
const supportTicketService = require('../services/support-ticket-service');
const { resolveKycRuntimeForUser } = require('../services/kyc-runtime-scope-service');
const {
    resolveRidePersistenceScope,
    resolveUserPersistenceScope,
    assertRideParticipantsSharePersistenceScope
} = require('../services/sandbox-persistence-context');

const SUPPORT_SANDBOX_PERMISSION = 'support:sandbox';
const KYC_IDENTITY_REVIEW_SOURCE = 'kyc_identity_mismatch_appeal';
const SAFE_KYC_CONTEXT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_KYC_REQUIREMENT_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function normalizeKycContextId(value) {
    const normalized = String(value || '').trim();
    return SAFE_KYC_CONTEXT_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeKycRequirement(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return SAFE_KYC_REQUIREMENT_PATTERN.test(normalized) ? normalized : null;
}

function resolveIdentityReviewTicketScope(data = {}, identity = {}) {
    const source = String(data.source || '').trim().toLowerCase();
    const evidenceId = normalizeKycContextId(data.kycEvidenceId);
    const requested = source === KYC_IDENTITY_REVIEW_SOURCE || Boolean(evidenceId);
    if (!requested) return null;

    if (String(identity.userType || '').trim().toLowerCase() !== 'driver') {
        const error = new Error('Revisao de identidade disponivel somente para o proprio motorista');
        error.code = 'KYC_IDENTITY_REVIEW_DRIVER_REQUIRED';
        throw error;
    }
    if (!evidenceId) {
        return {
            source: KYC_IDENTITY_REVIEW_SOURCE,
            driverId: identity.userId,
            reviewAvailable: false
        };
    }

    return {
        source: KYC_IDENTITY_REVIEW_SOURCE,
        driverId: identity.userId,
        kycEvidenceId: evidenceId,
        kycReviewCaseId: normalizeKycContextId(data.kycReviewCaseId),
        kycChallengeId: normalizeKycContextId(data.kycChallengeId),
        requirement: normalizeKycRequirement(data.requirement),
        reviewAvailable: data.reviewAvailable !== false
    };
}

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

function isPersistenceBoundaryError(error) {
    const code = String(error?.code || '');
    return (
        code.startsWith('PERSISTENCE_') ||
        code.startsWith('FINANCIAL_') ||
        code.startsWith('SANDBOX_') ||
        code.startsWith('KYC_RUNTIME_') ||
        code.startsWith('KYC_SANDBOX_')
    );
}

function supportExplicitlyRequestsSandbox(data = {}) {
    return [data.supportScope, data.persistenceScope]
        .some((value) => String(value || '').trim().toLowerCase() === 'sandbox');
}

function supportCanAccessSandbox(identity = {}) {
    const permissions = Array.isArray(identity.permissions) ? identity.permissions : [];
    return permissions.includes('*') || permissions.includes(SUPPORT_SANDBOX_PERMISSION);
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

    async function resolveIncidentPersistenceContext(bookingScope, identity) {
        let persistenceContext = bookingScope.bookingId
            ? resolveRidePersistenceScope(
                bookingScope.participant?.scope?.raw ||
                bookingScope.participant?.scope ||
                {}
            )
            : await resolveUserPersistenceScope({
                userId: identity.userId,
                actor: identity
            });

        if (bookingScope.bookingId && persistenceContext.namespace === 'sandbox') {
            persistenceContext = await assertRideParticipantsSharePersistenceScope(
                persistenceContext,
                {
                    passengerId: bookingScope.participant?.scope?.customerId,
                    driverId: bookingScope.participant?.scope?.driverId,
                    requireBoth: true
                }
            );
        }

        return persistenceContext;
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
            const persistenceContext = await resolveIncidentPersistenceContext(
                bookingScope,
                identity
            );

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
                actorId: identity.userId,
                persistenceContext
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
            socket.emit('incidentReportError', isPersistenceBoundaryError(error)
                ? { error: error.message, code: error.code }
                : { error: 'Erro interno do servidor' });
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
            const persistenceContext = await resolveIncidentPersistenceContext(
                bookingScope,
                identity
            );

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
                actorId: identity.userId,
                persistenceContext
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
            socket.emit('emergencyError', isPersistenceBoundaryError(error)
                ? { error: error.message, code: error.code }
                : { error: 'Erro interno do servidor' });
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
            const persistenceContext = await resolveUserPersistenceScope({
                userId,
                phone: authz.identity.phone || authz.identity.phoneNumber || null,
                actor: authz.identity
            });
            if (persistenceContext.namespace === 'sandbox') {
                socket.emit('support:chat:error', {
                    error: 'O chat não está disponível neste ambiente de validação.',
                    code: 'KYC_SANDBOX_SUPPORT_CHAT_ISOLATION_REQUIRED'
                });
                return;
            }

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
            let persistenceContext = bookingScope.bookingId
                ? resolveRidePersistenceScope(bookingScope.participant?.scope?.raw || {})
                : await resolveUserPersistenceScope({
                    userId: identity.userId,
                    actor: identity
                });
            const supportRequestedSandbox = supportExplicitlyRequestsSandbox(data);
            if (!bookingScope.bookingId) {
                if (isSupportActor(socket) && supportRequestedSandbox) {
                    throw Object.assign(
                        new Error('Ticket sandbox de agente exige uma corrida ou usuário sandbox autoritativo'),
                        { code: 'SANDBOX_SUPPORT_CONTEXT_REQUIRED' }
                    );
                }
                if (supportRequestedSandbox && persistenceContext.namespace !== 'sandbox') {
                    throw Object.assign(
                        new Error('Usuário não pertence ao namespace sandbox solicitado'),
                        { code: 'SANDBOX_PERSISTENCE_SCOPE_MISMATCH' }
                    );
                }
                if (isSupportActor(socket) && persistenceContext.namespace === 'sandbox') {
                    throw Object.assign(
                        new Error('Acesso sandbox de agente exige contexto autoritativo'),
                        { code: 'SANDBOX_SUPPORT_CONTEXT_REQUIRED' }
                    );
                }
            }
            if (bookingScope.bookingId) {
                if (bookingScope.participant?.participantRole === 'support') {
                    if (supportRequestedSandbox && persistenceContext.namespace !== 'sandbox') {
                        throw Object.assign(
                            new Error('A corrida solicitada não pertence ao namespace sandbox'),
                            { code: 'SANDBOX_PERSISTENCE_SCOPE_MISMATCH' }
                        );
                    }
                    if (
                        persistenceContext.namespace === 'sandbox' &&
                        (!supportRequestedSandbox || !supportCanAccessSandbox(identity))
                    ) {
                        throw Object.assign(
                            new Error('Acesso explícito ao suporte sandbox não autorizado'),
                            { code: 'SANDBOX_PERSISTENCE_ACCESS_DENIED' }
                        );
                    }
                }
                persistenceContext = await assertRideParticipantsSharePersistenceScope(
                    persistenceContext,
                    {
                        passengerId: bookingScope.participant?.scope?.customerId,
                        driverId: bookingScope.participant?.scope?.driverId,
                        requireBoth: persistenceContext.namespace === 'sandbox'
                    }
                );
            }

            const identityReviewScope = resolveIdentityReviewTicketScope(data, identity);
            let identityReviewWorkflowService = null;
            if (identityReviewScope?.kycEvidenceId) {
                const kycRuntime = await resolveKycRuntimeForUser({
                    userId: identity.userId,
                    phone: identity.phone || identity.phoneNumber || null,
                    actor: identity,
                    expectedPersistenceContext: persistenceContext
                });
                identityReviewWorkflowService = kycRuntime.workflow;

                const existingReview = await identityReviewWorkflowService
                    .resumeExistingCaseRequest({
                        driverId: identity.userId,
                        evidenceId: identityReviewScope.kycEvidenceId,
                        requestedBy: {
                            uid: identity.userId,
                            email: identity.email || null,
                            type: 'driver'
                        }
                    });
                if (existingReview?.case?.caseId && existingReview?.ticket?.id) {
                    const publicTicket = serializeSupportTicket(existingReview.ticket, { isAgent: false });
                    socket.emit('supportTicketCreated', {
                        success: true,
                        ticketId: existingReview.ticket.id,
                        reviewCaseId: existingReview.case.caseId,
                        identityReviewRegistered: true,
                        idempotentReplay: true,
                        message: 'Solicitacao de analise ja registrada',
                        data: publicTicket
                    });
                    return;
                }
            }

            const { ticket, queue } = await supportQueueService.createSupportTicket({
                subject: data.subject || `${type} support request`,
                description,
                category: ['technical', 'payment', 'account', 'general'].includes(type) ? type : 'general',
                priority: priority || 'N3',
                requesterId: identity.userId,
                userType: identity.userType || 'passenger',
                metadata: {
                    source: identityReviewScope?.source || 'socket_support',
                    attachments: attachments || [],
                    bookingId: bookingScope.bookingId || null,
                    ...(identityReviewScope || {}),
                    ...(identityReviewScope?.kycEvidenceId
                        ? {
                            identityReviewLinkStatus: 'pending',
                            identityReviewLinkAttempts: 0
                        }
                        : {})
                },
                persistenceContext
            });

            let identityReviewCase = null;
            let identityReviewLinkError = null;
            let identityReviewLinkAttempts = 0;
            let persistedTicket = ticket;
            if (identityReviewScope?.kycEvidenceId) {
                for (let attempt = 1; attempt <= 2 && !identityReviewCase; attempt += 1) {
                    identityReviewLinkAttempts = attempt;
                    try {
                        const reviewResult = await identityReviewWorkflowService.openCaseFromTicket({
                            driverId: identity.userId,
                            evidenceId: identityReviewScope.kycEvidenceId,
                            ticketId: ticket.id,
                            requestedBy: {
                                uid: identity.userId,
                                email: identity.email || null,
                                type: 'driver'
                            }
                        });
                        identityReviewCase = reviewResult?.case || null;
                        identityReviewLinkError = null;
                    } catch (reviewError) {
                        identityReviewLinkError = reviewError;
                    }
                }

                try {
                    persistedTicket = await supportTicketService.updateTicketMetadata(ticket.id, {
                        identityReviewLinkStatus: identityReviewCase?.caseId ? 'registered' : 'pending',
                        identityReviewLinkAttempts,
                        identityReviewCaseId: identityReviewCase?.caseId || null,
                        identityReviewLinkUpdatedAt: new Date().toISOString()
                    }, persistenceContext);
                } catch (metadataError) {
                    logStructured('error', 'Falha ao atualizar estado do vinculo KYC no ticket', {
                        service: 'websocket',
                        operation: 'createSupportTicketKycIdentityReviewMetadata',
                        userId: identity.userId,
                        ticketId: ticket.id,
                        error: metadataError?.message || String(metadataError)
                    });
                }

                if (!identityReviewCase) {
                    // O ticket permanece válido para atendimento, mas nenhuma
                    // decisão biométrica pode ocorrer sem o caso canônico. O
                    // status pending permite reconciliação explícita no backoffice.
                    logStructured('error', 'Falha ao vincular ticket ao caso KYC', {
                        service: 'websocket',
                        operation: 'createSupportTicketKycIdentityReview',
                        userId: identity.userId,
                        ticketId: ticket.id,
                        code: identityReviewLinkError?.code || null,
                        error: identityReviewLinkError?.message || String(identityReviewLinkError)
                    });
                }
            }

            const publicTicket = serializeSupportTicket(persistedTicket, { isAgent: false });
            const realtimePayload = { ticket: publicTicket };
            publishSupportEvent(io, {
                dashboardEvent: persistenceContext.namespace === 'sandbox'
                    ? null
                    : 'support:ticket:new',
                ownerEvent: 'support:ticket:new',
                dashboardPayload: realtimePayload,
                ownerPayload: realtimePayload,
                userId: ticket.userId || identity.userId,
                userType: ticket.userType || identity.userType
            });

            // Emitir confirmação
            socket.emit('supportTicketCreated', {
                success: true,
                ticketId: ticket.id,
                estimatedResponseTime: queue?.slaMinutes?.firstResponse || 240,
                ackTargetAt: queue?.ackTargetAt || null,
                firstResponseTargetAt: queue?.firstResponseTargetAt || null,
                reviewCaseId: identityReviewCase?.caseId || null,
                identityReviewRegistered: Boolean(identityReviewCase?.caseId),
                message: identityReviewScope?.kycEvidenceId && !identityReviewCase?.caseId
                    ? 'Solicitacao recebida e aguardando vinculacao segura'
                    : 'Ticket de suporte criado com sucesso',
                data: publicTicket
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
            socket.emit('supportTicketError', isPersistenceBoundaryError(error)
                ? { error: error.message, code: error.code }
                : { error: 'Erro interno do servidor' });
        }
    });
}

module.exports = registerSocketSafetySupportHandlers;
