jest.mock('../../../services/support-chat-service', () => ({
  setIOInstance: jest.fn(),
  sendMessage: jest.fn()
}));

jest.mock('../../../services/safety-incident-service', () => ({
  createIncident: jest.fn()
}));

jest.mock('../../../services/support-queue-service', () => ({
  createSupportTicket: jest.fn()
}));

jest.mock('../../../services/support-ticket-service', () => ({
  updateTicketMetadata: jest.fn()
}));

jest.mock('../../../services/payment-runtime-profile-service', () => ({
  resolveProfile: jest.fn()
}));

jest.mock('../../../services/kyc-identity-review-workflow-service', () => ({
  openCaseFromTicket: jest.fn()
}));

const supportChatService = require('../../../services/support-chat-service');
const safetyIncidentService = require('../../../services/safety-incident-service');
const supportQueueService = require('../../../services/support-queue-service');
const supportTicketService = require('../../../services/support-ticket-service');
const paymentRuntimeProfileService = require('../../../services/payment-runtime-profile-service');
const kycIdentityReviewWorkflowService = require('../../../services/kyc-identity-review-workflow-service');
const registerSocketSafetySupportHandlers = require('../../../bootstrap/register-socket-safety-support-handlers');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');

function createHarness(socketOverrides = {}, options = {}) {
  const handlers = {};
  const socket = {
    id: 'socket_1',
    userId: 'user_1',
    userType: 'passenger',
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    emit: jest.fn(),
    ...socketOverrides
  };
  const dashboardEmit = jest.fn();
  const ownerEmit = jest.fn();
  const io = {
    emit: jest.fn(),
    of: jest.fn(() => ({
      to: jest.fn(() => ({ emit: dashboardEmit }))
    })),
    to: jest.fn(() => ({ emit: ownerEmit })),
    dashboardEmit,
    ownerEmit,
    activeBookings: options.activeBookings || new Map()
  };

  registerSocketSafetySupportHandlers({
    socket,
    io,
    logStructured: jest.fn(),
    redisPool: options.redisPool || null
  });

  return { handlers, socket, io };
}

describe('registerSocketSafetySupportHandlers support chat scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supportChatService.sendMessage.mockResolvedValue({
      message: { id: 'support_msg_1' }
    });
    safetyIncidentService.createIncident.mockResolvedValue({
      incidentId: 'incident_1',
      status: 'OPEN',
      slaTargetAt: '2026-06-22T21:00:00.000Z',
      ticketId: 'ticket_1'
    });
    supportQueueService.createSupportTicket.mockResolvedValue({
      ticket: {
        id: 'ticket_1',
        userId: 'user_1',
        userType: 'passenger',
        priority: 'N2',
        status: 'open',
        adminNotes: 'nota interna',
        assignedAgent: 'secret-agent',
        metadata: {
          bookingId: 'booking_1',
          queue: { overdueAck: true }
        }
      },
      queue: { slaMinutes: { firstResponse: 60 } }
    });
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'env-default',
      environment: 'production',
      source: 'env',
      testUserSandbox: false
    });
    kycIdentityReviewWorkflowService.openCaseFromTicket.mockResolvedValue({
      case: { caseId: 'kyc_case_1' }
    });
    supportTicketService.updateTicketMetadata.mockImplementation(async (ticketId, metadata) => ({
      id: ticketId,
      userId: 'driver_1',
      userType: 'driver',
      priority: 'N2',
      status: 'open',
      metadata
    }));
  });

  it('rejects a normal user trying to write into another support chat', async () => {
    const { handlers, socket } = createHarness();

    await handlers['support:chat:message']({
      userId: 'user_2',
      message: 'Oi'
    });

    expect(supportChatService.sendMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'support:chat:error',
      expect.objectContaining({
        code: 'SUPPORT_SCOPE_DENIED'
      })
    );
  });

  it('uses the authenticated user id for normal support chat messages', async () => {
    const { handlers, socket } = createHarness();

    await handlers['support:chat:message']({
      senderType: 'agent',
      message: '  Oi  '
    });

    expect(supportChatService.sendMessage).toHaveBeenCalledWith('user_1', 'Oi', 'user');
    expect(socket.emit).toHaveBeenCalledWith(
      'support:chat:sent',
      expect.objectContaining({
        success: true,
        messageId: 'support_msg_1'
      })
    );
  });

  it('rejects empty support chat messages before dispatching to the chat service', async () => {
    const { handlers, socket } = createHarness();

    await handlers['support:chat:message']({
      message: '   '
    });

    expect(supportChatService.sendMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'support:chat:error',
      expect.objectContaining({
        code: 'MESSAGE_REQUIRED'
      })
    );
  });

  it('rejects oversized support chat messages before dispatching to the chat service', async () => {
    const { handlers, socket } = createHarness();

    await handlers['support:chat:message']({
      message: 'x'.repeat(2001)
    });

    expect(supportChatService.sendMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'support:chat:error',
      expect.objectContaining({
        code: 'MESSAGE_TOO_LONG'
      })
    );
  });

  it('allows support actors to target a user chat only as agent', async () => {
    const { handlers } = createHarness({
      userId: 'agent_1',
      userRole: 'support',
      userType: 'support'
    });

    await handlers['support:chat:message']({
      userId: 'user_2',
      senderType: 'user',
      message: 'Como posso ajudar?'
    });

    expect(supportChatService.sendMessage).toHaveBeenCalledWith(
      'user_2',
      'Como posso ajudar?',
      'agent'
    );
  });

  it('rejects a normal user reporting an incident against another participant booking', async () => {
    const activeBookings = new Map([
      ['booking_1', {
        bookingId: 'booking_1',
        customerId: 'user_2',
        driverId: 'driver_1',
        status: 'STARTED'
      }]
    ]);
    const { handlers, socket } = createHarness({}, { activeBookings });

    await handlers.reportIncident({
      bookingId: 'booking_1',
      type: 'safety',
      description: 'O motorista se envolveu em um incidente.'
    });

    expect(safetyIncidentService.createIncident).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'incidentReportError',
      expect.objectContaining({
        code: 'RIDE_SCOPE_DENIED'
      })
    );
  });

  it('allows a ride participant to report an incident for the scoped booking', async () => {
    const activeBookings = new Map([
      ['booking_1', {
        bookingId: 'booking_1',
        customerId: 'user_1',
        driverId: 'driver_1',
        status: 'STARTED'
      }]
    ]);
    const { handlers, socket } = createHarness({}, { activeBookings });

    await handlers.reportIncident({
      bookingId: 'booking_1',
      type: 'safety',
      description: 'Preciso registrar um problema durante a corrida.'
    });

    expect(safetyIncidentService.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        userId: 'user_1',
        userType: 'passenger',
        category: 'safety'
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'incidentReported',
      expect.objectContaining({
        success: true,
        incidentId: 'incident_1',
        ticketId: 'ticket_1'
      })
    );
  });

  it('propagates the sealed sandbox ride scope into incident persistence', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'qa-test-users-sandbox-durable',
      environment: 'sandbox',
      source: 'firestore',
      testUserSandbox: true
    });
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    const activeBookings = new Map([
      ['booking_sandbox', {
        bookingId: 'booking_sandbox',
        customerId: 'user_1',
        driverId: 'driver_1',
        status: 'STARTED',
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId
      }]
    ]);
    const { handlers } = createHarness({}, { activeBookings });

    await handlers.reportIncident({
      bookingId: 'booking_sandbox',
      type: 'safety',
      description: 'Incidente controlado no sandbox.'
    });

    expect(safetyIncidentService.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_sandbox',
        persistenceContext: expect.objectContaining({
          namespace: 'sandbox',
          financialContextId: financialContext.contextId
        })
      })
    );
  });

  it('fails closed when an incident carries a sandbox signal without a sealed context', async () => {
    const activeBookings = new Map([
      ['booking_sandbox_lost', {
        bookingId: 'booking_sandbox_lost',
        customerId: 'user_1',
        driverId: 'driver_1',
        status: 'STARTED',
        financialNamespace: 'sandbox'
      }]
    ]);
    const { handlers, socket } = createHarness({}, { activeBookings });

    await handlers.reportIncident({
      bookingId: 'booking_sandbox_lost',
      type: 'safety',
      description: 'Contexto perdido.'
    });

    expect(safetyIncidentService.createIncident).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'incidentReportError',
      expect.objectContaining({
        code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
      })
    );
  });

  it('does not trust app user critical severity without matching evidence', async () => {
    const activeBookings = new Map([
      ['booking_1', {
        bookingId: 'booking_1',
        customerId: 'user_1',
        driverId: 'driver_1',
        status: 'STARTED'
      }]
    ]);
    const { handlers } = createHarness({}, { activeBookings });

    await handlers.reportIncident({
      bookingId: 'booking_1',
      type: 'safety',
      severity: 'critical',
      description: 'Preciso registrar uma duvida simples sobre a corrida.'
    });

    expect(safetyIncidentService.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        category: 'safety',
        severity: 'high'
      })
    );
  });

  it('raises incident severity from server-side emergency evidence', async () => {
    const activeBookings = new Map([
      ['booking_1', {
        bookingId: 'booking_1',
        customerId: 'user_1',
        driverId: 'driver_1',
        status: 'STARTED'
      }]
    ]);
    const { handlers } = createHarness({}, { activeBookings });

    await handlers.reportIncident({
      bookingId: 'booking_1',
      type: 'safety',
      severity: 'low',
      description: 'Emergencia na corrida, estou em risco de vida.'
    });

    expect(safetyIncidentService.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        category: 'safety',
        severity: 'critical'
      })
    );
  });

  it('requires an authenticated identity for an incident without a booking', async () => {
    const { handlers, socket } = createHarness({ userId: null });

    await handlers.reportIncident({
      type: 'safety',
      description: 'Preciso registrar um problema fora de uma corrida.'
    });

    expect(safetyIncidentService.createIncident).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'incidentReportError',
      expect.objectContaining({ code: 'AUTH_REQUIRED' })
    );
  });

  it('rejects a support ticket linked to a booking outside the authenticated user scope', async () => {
    const activeBookings = new Map([
      ['booking_2', {
        bookingId: 'booking_2',
        customerId: 'user_2',
        driverId: 'driver_1',
        status: 'STARTED'
      }]
    ]);
    const { handlers, socket } = createHarness({}, { activeBookings });

    await handlers.createSupportTicket({
      bookingId: 'booking_2',
      type: 'payment',
      priority: 'N1',
      description: 'Quero abrir ticket para outra corrida.'
    });

    expect(supportQueueService.createSupportTicket).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'supportTicketError',
      expect.objectContaining({
        code: 'RIDE_SCOPE_DENIED'
      })
    );
  });

  it('requires an authenticated identity for a ticket without a booking', async () => {
    const { handlers, socket } = createHarness({ userId: null });

    await handlers.createSupportTicket({
      type: 'technical',
      description: 'Não consigo concluir o cadastro.'
    });

    expect(supportQueueService.createSupportTicket).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'supportTicketError',
      expect.objectContaining({ code: 'AUTH_REQUIRED' })
    );
  });

  it('returns a public ticket and publishes only to authenticated dashboard and owner rooms', async () => {
    const { handlers, socket, io } = createHarness();

    await handlers.createSupportTicket({
      type: 'payment',
      priority: 'N1',
      subject: 'Problema com Pix',
      description: 'Preciso revisar uma cobrança.'
    });

    expect(supportQueueService.createSupportTicket).toHaveBeenCalledWith(expect.objectContaining({
      requesterId: 'user_1',
      userType: 'passenger'
    }));
    expect(socket.emit).toHaveBeenCalledWith(
      'supportTicketCreated',
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: 'ticket_1',
          userId: 'user_1',
          bookingId: 'booking_1'
        })
      })
    );
    const createdPayload = socket.emit.mock.calls.find(([event]) => event === 'supportTicketCreated')[1];
    expect(createdPayload.data).not.toHaveProperty('adminNotes');
    expect(createdPayload.data).not.toHaveProperty('assignedAgent');
    expect(createdPayload.data).not.toHaveProperty('metadata');
    expect(io.emit).not.toHaveBeenCalled();
    expect(io.of).toHaveBeenCalledWith('/dashboard');
    expect(io.dashboardEmit).toHaveBeenCalledWith(
      'support:ticket:new',
      expect.objectContaining({ ticket: expect.objectContaining({ id: 'ticket_1' }) })
    );
    expect(io.to).toHaveBeenCalledWith('customer_user_1');
    expect(io.ownerEmit).toHaveBeenCalledWith(
      'support:ticket:new',
      expect.objectContaining({ ticket: expect.objectContaining({ id: 'ticket_1' }) })
    );
  });

  it('binds a driver identity mismatch ticket to the authenticated driver and exact evidence', async () => {
    supportQueueService.createSupportTicket.mockResolvedValueOnce({
      ticket: {
        id: 'ticket_kyc_1',
        userId: 'driver_1',
        userType: 'driver',
        priority: 'N2',
        status: 'open',
        metadata: {}
      },
      queue: { slaMinutes: { firstResponse: 60 } }
    });
    const { handlers, socket } = createHarness({
      userId: 'driver_1',
      userType: 'driver',
      userEmail: 'driver@leaf.test'
    });

    await handlers.createSupportTicket({
      type: 'account',
      description: 'Quero solicitar a analise da validacao de identidade.',
      source: 'kyc_identity_mismatch_appeal',
      kycEvidenceId: 'evidence_1',
      requirement: 'IDENTITY_REVERIFICATION'
    });

    expect(supportQueueService.createSupportTicket).toHaveBeenCalledWith(expect.objectContaining({
      requesterId: 'driver_1',
      userType: 'driver',
      metadata: expect.objectContaining({
        source: 'kyc_identity_mismatch_appeal',
        driverId: 'driver_1',
        kycEvidenceId: 'evidence_1',
        requirement: 'IDENTITY_REVERIFICATION',
        identityReviewLinkStatus: 'pending',
        identityReviewLinkAttempts: 0
      })
    }));
    expect(kycIdentityReviewWorkflowService.openCaseFromTicket).toHaveBeenCalledWith({
      driverId: 'driver_1',
      evidenceId: 'evidence_1',
      ticketId: 'ticket_kyc_1',
      requestedBy: expect.objectContaining({ uid: 'driver_1', type: 'driver' })
    });
    expect(supportTicketService.updateTicketMetadata).toHaveBeenCalledWith(
      'ticket_kyc_1',
      expect.objectContaining({
        identityReviewLinkStatus: 'registered',
        identityReviewLinkAttempts: 1,
        identityReviewCaseId: 'kyc_case_1'
      }),
      expect.objectContaining({ namespace: 'operational' })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'supportTicketCreated',
      expect.objectContaining({
        identityReviewRegistered: true,
        reviewCaseId: 'kyc_case_1'
      })
    );
  });

  it('preserva ticket duravel como pendente quando o vinculo KYC falha duas vezes', async () => {
    supportQueueService.createSupportTicket.mockResolvedValueOnce({
      ticket: {
        id: 'ticket_kyc_pending',
        userId: 'driver_1',
        userType: 'driver',
        priority: 'N2',
        status: 'open',
        metadata: { identityReviewLinkStatus: 'pending' }
      },
      queue: { slaMinutes: { firstResponse: 60 } }
    });
    kycIdentityReviewWorkflowService.openCaseFromTicket.mockRejectedValue(
      Object.assign(new Error('store indisponivel'), {
        code: 'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE'
      })
    );
    const { handlers, socket } = createHarness({
      userId: 'driver_1',
      userType: 'driver'
    });

    await handlers.createSupportTicket({
      type: 'account',
      description: 'Quero solicitar a analise da validacao de identidade.',
      source: 'kyc_identity_mismatch_appeal',
      kycEvidenceId: 'evidence_1'
    });

    expect(kycIdentityReviewWorkflowService.openCaseFromTicket).toHaveBeenCalledTimes(2);
    expect(supportTicketService.updateTicketMetadata).toHaveBeenCalledWith(
      'ticket_kyc_pending',
      expect.objectContaining({
        identityReviewLinkStatus: 'pending',
        identityReviewLinkAttempts: 2,
        identityReviewCaseId: null
      }),
      expect.objectContaining({ namespace: 'operational' })
    );
    expect(socket.emit).toHaveBeenCalledWith('supportTicketCreated', expect.objectContaining({
      success: true,
      ticketId: 'ticket_kyc_pending',
      identityReviewRegistered: false,
      reviewCaseId: null,
      message: 'Solicitacao recebida e aguardando vinculacao segura'
    }));
  });

  it('rejects identity mismatch review requests from non-drivers before ticket creation', async () => {
    const { handlers, socket } = createHarness({ userId: 'user_1', userType: 'passenger' });

    await handlers.createSupportTicket({
      type: 'account',
      description: 'Tentativa indevida de abrir revisao de identidade.',
      source: 'kyc_identity_mismatch_appeal',
      kycEvidenceId: 'evidence_1'
    });

    expect(supportQueueService.createSupportTicket).not.toHaveBeenCalled();
    expect(kycIdentityReviewWorkflowService.openCaseFromTicket).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'supportTicketError',
      expect.objectContaining({ error: 'Erro interno do servidor' })
    );
  });

  it('uses the ride sandbox context and never publishes the ticket to the operational dashboard room', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'qa-test-users-sandbox-durable',
      environment: 'sandbox',
      source: 'firestore',
      testUserSandbox: true
    });
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    const activeBookings = new Map([
      ['booking_sandbox_1', {
        bookingId: 'booking_sandbox_1',
        customerId: 'user_1',
        driverId: 'driver_1',
        status: 'STARTED',
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId,
        providerEnvironment: 'sandbox'
      }]
    ]);
    const { handlers, io } = createHarness({}, { activeBookings });

    await handlers.createSupportTicket({
      bookingId: 'booking_sandbox_1',
      type: 'payment',
      description: 'Validar ticket sandbox desta corrida.'
    });

    expect(supportQueueService.createSupportTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterId: 'user_1',
        persistenceContext: expect.objectContaining({
          namespace: 'sandbox',
          financialContextId: financialContext.contextId
        })
      })
    );
    expect(io.of).not.toHaveBeenCalled();
    expect(io.ownerEmit).toHaveBeenCalledWith(
      'support:ticket:new',
      expect.objectContaining({ ticket: expect.objectContaining({ id: 'ticket_1' }) })
    );
  });

  it('requires explicit scope and support:sandbox permission from a support socket', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'qa-test-users-sandbox-durable',
      environment: 'sandbox',
      source: 'firestore',
      testUserSandbox: true
    });
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    const activeBookings = new Map([
      ['booking_support_sandbox', {
        bookingId: 'booking_support_sandbox',
        customerId: 'user_1',
        driverId: 'driver_1',
        status: 'STARTED',
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId,
        providerEnvironment: 'sandbox'
      }]
    ]);
    const denied = createHarness({
      userId: 'support_1',
      userType: 'support',
      userRole: 'support'
    }, { activeBookings });

    await denied.handlers.createSupportTicket({
      bookingId: 'booking_support_sandbox',
      type: 'technical',
      description: 'Acesso sem escopo explícito.'
    });

    expect(supportQueueService.createSupportTicket).not.toHaveBeenCalled();
    expect(denied.socket.emit).toHaveBeenCalledWith(
      'supportTicketError',
      expect.objectContaining({ code: 'SANDBOX_PERSISTENCE_ACCESS_DENIED' })
    );

    const allowed = createHarness({
      userId: 'support_1',
      userType: 'support',
      userRole: 'support',
      userPermissions: ['support:sandbox']
    }, { activeBookings });
    await allowed.handlers.createSupportTicket({
      bookingId: 'booking_support_sandbox',
      persistenceScope: 'sandbox',
      type: 'technical',
      description: 'Acesso explicitamente autorizado.'
    });

    expect(supportQueueService.createSupportTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        persistenceContext: expect.objectContaining({ namespace: 'sandbox' })
      })
    );
  });

  it('rejects a support socket requesting sandbox without an authoritative booking context', async () => {
    const { handlers, socket } = createHarness({
      userId: 'support_1',
      userType: 'support',
      userRole: 'support',
      userPermissions: ['support:sandbox']
    });

    await handlers.createSupportTicket({
      persistenceScope: 'sandbox',
      type: 'technical',
      description: 'Não há booking ou usuário sandbox autoritativo.'
    });

    expect(supportQueueService.createSupportTicket).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'supportTicketError',
      expect.objectContaining({ code: 'SANDBOX_SUPPORT_CONTEXT_REQUIRED' })
    );
  });

  it('fails closed with a sandbox boundary code when the participant profile diverges', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    const activeBookings = new Map([
      ['booking_sandbox_mismatch', {
        bookingId: 'booking_sandbox_mismatch',
        customerId: 'user_1',
        driverId: 'driver_1',
        status: 'STARTED',
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId,
        providerEnvironment: 'sandbox'
      }]
    ]);
    const { handlers, socket } = createHarness({}, { activeBookings });

    await handlers.createSupportTicket({
      bookingId: 'booking_sandbox_mismatch',
      type: 'payment',
      description: 'Este ticket deve ser bloqueado.'
    });

    expect(supportQueueService.createSupportTicket).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'supportTicketError',
      expect.objectContaining({
        code: 'SANDBOX_PARTICIPANT_CONTEXT_MISMATCH'
      })
    );
  });
});
