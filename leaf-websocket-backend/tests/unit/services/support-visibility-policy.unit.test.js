const {
  serializeSupportTicket,
  serializeSupportMessage,
  serializeSupportMessages
} = require('../../../services/support-visibility-policy');

describe('support visibility policy', () => {
  const ticket = {
    id: 'ticket-1',
    userId: 'passenger-1',
    userType: 'passenger',
    subject: 'Cobrança',
    description: 'Revisar recibo',
    category: 'payment',
    priority: 'N2',
    status: 'assigned',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:01:00.000Z',
    assignedAgent: 'agent-secret-id',
    assignedAgentName: 'Agente Interno',
    adminNotes: 'não compartilhar',
    ipAddress: '127.0.0.1',
    userAgent: 'internal-agent',
    escalationHistory: [{ reason: 'interno' }],
    metadata: {
      bookingId: 'booking-1',
      queue: { overdueAck: true },
      supportClassification: { reasons: ['internal'] }
    }
  };

  it('whitelists tickets for the owning app user and strips operational fields', () => {
    const visible = serializeSupportTicket(ticket, { isAgent: false });

    expect(visible).toEqual(expect.objectContaining({
      id: 'ticket-1',
      userId: 'passenger-1',
      subject: 'Cobrança',
      status: 'assigned',
      bookingId: 'booking-1'
    }));
    expect(visible).not.toHaveProperty('adminNotes');
    expect(visible).not.toHaveProperty('assignedAgent');
    expect(visible).not.toHaveProperty('assignedAgentName');
    expect(visible).not.toHaveProperty('ipAddress');
    expect(visible).not.toHaveProperty('userAgent');
    expect(visible).not.toHaveProperty('metadata');
    expect(visible).not.toHaveProperty('escalationHistory');
  });

  it('preserves the complete ticket for authenticated support agents', () => {
    expect(serializeSupportTicket(ticket, { isAgent: true })).toBe(ticket);
  });

  it('drops internal messages and strips internal markers from public messages', () => {
    const publicMessage = {
      id: 'message-public',
      ticketId: 'ticket-1',
      senderId: 'agent-secret-id',
      senderType: 'agent',
      message: 'Resposta pública',
      messageType: 'text',
      isInternal: false,
      readBy: { 'agent-secret-id': true },
      createdAt: '2026-07-13T00:02:00.000Z'
    };
    const internalMessage = {
      ...publicMessage,
      id: 'message-internal',
      message: 'Nota interna',
      isInternal: true
    };

    expect(serializeSupportMessages([publicMessage, internalMessage], { isAgent: false })).toEqual([
      {
        id: 'message-public',
        ticketId: 'ticket-1',
        senderType: 'agent',
        message: 'Resposta pública',
        messageType: 'text',
        createdAt: '2026-07-13T00:02:00.000Z'
      }
    ]);
    expect(serializeSupportMessage(internalMessage, { isAgent: false })).toBeNull();
    expect(serializeSupportMessages([publicMessage, internalMessage], { isAgent: true })).toEqual([
      publicMessage,
      internalMessage
    ]);
  });
});
