import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import SupportScreen from '../src/screens/SupportScreen';
import SupportService from '../src/services/SupportService';
import SupportChatService from '../src/services/SupportChatService';
import { useSelector } from 'react-redux';

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  error: jest.fn(),
}));

jest.mock('react-redux', () => ({
  useSelector: jest.fn(),
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => ({
    isConnected: jest.fn(() => true),
    connect: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('../src/services/SupportService', () => ({
  getTickets: jest.fn(),
  getFAQ: jest.fn(),
}));

jest.mock('../src/services/SupportChatService', () => ({
  initialize: jest.fn().mockResolvedValue(undefined),
  getMessages: jest.fn().mockResolvedValue([]),
  onNewMessage: jest.fn(() => jest.fn()),
  disconnect: jest.fn(),
  sendMessage: jest.fn(),
  markAsRead: jest.fn(),
}));

describe('SupportScreen fail-visible states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSelector.mockReturnValue({
      profile: {
        uid: 'user_1',
      },
    });
    SupportService.getFAQ.mockResolvedValue({
      success: true,
      faqs: [],
    });
    SupportChatService.getMessages.mockResolvedValue([]);
  });

  it('shows ticket load failures as an error instead of an empty ticket inbox', async () => {
    SupportService.getTickets.mockResolvedValueOnce({
      success: false,
      error: 'support tickets unavailable',
    });

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const screen = render(<SupportScreen navigation={navigation} />);

    await waitFor(() => {
      expect(SupportService.getTickets).toHaveBeenCalledWith('user_1');
    });

    fireEvent.press(screen.getByTestId('support-tab-tickets'));

    expect(screen.getByTestId('support-tickets-error-state')).toBeTruthy();
    expect(screen.getByText('Não foi possível carregar tickets')).toBeTruthy();
    expect(screen.getByText('support tickets unavailable')).toBeTruthy();
    expect(screen.queryByText('Nenhum ticket encontrado')).toBeNull();
  });

  it('shows support chat history failures instead of an empty conversation', async () => {
    SupportService.getTickets.mockResolvedValueOnce({
      success: true,
      tickets: [],
    });
    SupportChatService.getMessages.mockRejectedValueOnce(
      new Error('support history unavailable'),
    );

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const screen = render(<SupportScreen navigation={navigation} />);

    await waitFor(() => {
      expect(SupportChatService.getMessages).toHaveBeenCalledWith('user_1');
    });

    expect(screen.getByTestId('support-chat-error-state')).toBeTruthy();
    expect(screen.getByText('support history unavailable')).toBeTruthy();
    expect(screen.queryByText('Nenhuma mensagem ainda. Escreva para começar.')).toBeNull();
  });
});
