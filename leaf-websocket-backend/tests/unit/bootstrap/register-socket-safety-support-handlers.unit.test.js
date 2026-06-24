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

const supportChatService = require('../../../services/support-chat-service');
const safetyIncidentService = require('../../../services/safety-incident-service');
const supportQueueService = require('../../../services/support-queue-service');
const registerSocketSafetySupportHandlers = require('../../../bootstrap/register-socket-safety-support-handlers');

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
  const io = {
    to: jest.fn(),
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
      ticket: { id: 'ticket_1', priority: 'N2' },
      queue: { slaMinutes: { firstResponse: 60 } }
    });
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
});
