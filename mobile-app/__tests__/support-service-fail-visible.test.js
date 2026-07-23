jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/services/AuthService', () => ({
  getCurrentUser: jest.fn(),
  supportRequest: jest.fn(),
  handleApiResponse: jest.fn(),
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => ({})),
}));

jest.mock('../src/services/SupportTicketService', () => ({
  __esModule: true,
  default: {
    getTicketMessages: jest.fn(),
    getUserTickets: jest.fn(),
  },
}));

import SupportService from '../src/services/SupportService';
import SupportTicketService from '../src/services/SupportTicketService';

describe('SupportService fail-visible loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not convert ticket message load failures into a successful empty chat', async () => {
    SupportTicketService.getTicketMessages.mockRejectedValueOnce(
      new Error('support messages unavailable'),
    );

    const result = await SupportService.getChatMessages('ticket_1');

    expect(result).toEqual({
      success: false,
      error: 'support messages unavailable',
    });
    expect(result.messages).toBeUndefined();
  });

  it('does not convert ticket list load failures into a successful empty inbox', async () => {
    SupportTicketService.getUserTickets.mockRejectedValueOnce(
      new Error('support tickets unavailable'),
    );

    const result = await SupportService.getTickets('user_1');

    expect(result).toEqual({
      success: false,
      error: 'support tickets unavailable',
    });
    expect(result.tickets).toBeUndefined();
  });
});
