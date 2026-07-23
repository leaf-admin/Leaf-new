const mockSupportRequest = jest.fn();
const mockHandleApiResponse = jest.fn();

jest.mock('../src/services/AuthService', () => ({
  __esModule: true,
  default: {
    supportRequest: (...args) => mockSupportRequest(...args),
    handleApiResponse: (...args) => mockHandleApiResponse(...args),
    getCurrentUser: jest.fn(),
    getDeviceInfo: jest.fn(() => ({})),
  },
}));

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  error: jest.fn(),
}));

import SupportTicketService from '../src/services/SupportTicketService';

describe('SupportTicketService bilateral ticket message contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts a rider reply and reads the same canonical REST thread used by support agents', async () => {
    mockSupportRequest
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    mockHandleApiResponse
      .mockResolvedValueOnce({
        message: {
          id: 'message-user-1',
          ticketId: 'TICKET-123',
          senderType: 'user',
          message: 'Preciso corrigir o recibo.',
        },
      })
      .mockResolvedValueOnce({
        messages: [
          {
            id: 'message-agent-1',
            ticketId: 'TICKET-123',
            senderType: 'agent',
            message: 'O recibo foi revisado.',
          },
        ],
      });

    const createdMessage = await SupportTicketService.addMessage('TICKET-123', {
      message: 'Preciso corrigir o recibo.',
      messageType: 'text',
      attachments: [],
    });
    const thread = await SupportTicketService.getTicketMessages('TICKET-123');

    expect(mockSupportRequest).toHaveBeenNthCalledWith(
      1,
      '/tickets/TICKET-123/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          message: 'Preciso corrigir o recibo.',
          messageType: 'text',
          attachments: [],
        }),
      },
    );
    expect(mockSupportRequest).toHaveBeenNthCalledWith(
      2,
      '/tickets/TICKET-123/messages',
      { method: 'GET' },
    );
    expect(createdMessage).toEqual(expect.objectContaining({
      id: 'message-user-1',
      senderType: 'user',
    }));
    expect(thread).toEqual([
      expect.objectContaining({
        id: 'message-agent-1',
        senderType: 'agent',
      }),
    ]);
  });
});
