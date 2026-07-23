import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RobotaxiSupportThreadScreen, {
  SUPPORT_TICKET_POLL_MS,
} from '../src/screens/prototype/RobotaxiSupportThreadScreen';
import SupportTicketService from '../src/services/SupportTicketService';

jest.mock('../src/services/SupportTicketService', () => ({
  getTicket: jest.fn(),
  getTicketMessages: jest.fn(),
  addMessage: jest.fn(),
}));

jest.mock('../src/screens/prototype/prototypeMapOcclusion', () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock('../src/components/prototype/PrototypeScreenTransition', () => {
  const React = require('react');
  return ({ children }) => <>{children}</>;
});

jest.mock('../src/components/prototype/PrototypeDismissibleSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }) => <View>{children}</View>;
});

jest.mock('../src/components/prototype/PrototypeMenuSurface', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    PrototypeMenuSurface: ({ title, subtitle, headerAccessory, children }) => (
      <View>
        <Text>{title}</Text>
        <Text>{subtitle}</Text>
        {headerAccessory}
        {children}
      </View>
    ),
    PrototypeMenuCloseButton: ({ onPress, testID, accessibilityLabel }) => (
      <TouchableOpacity onPress={onPress} testID={testID} accessibilityLabel={accessibilityLabel}>
        <Text>Fechar</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../src/components/prototype/LeafRideUI', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    leafRideColors: {
      leaf: '#1A330E',
      text: '#171412',
      secondary: '#756F68',
      muted: '#827B73',
      line: '#E9E2D8',
      dangerText: '#9F2424',
    },
    LeafButton: ({ label, onPress, disabled, testID, accessibilityLabel }) => (
      <TouchableOpacity
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
      >
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

function buildNavigation(overrides = {}) {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: jest.fn(() => false),
    ...overrides,
  };
}

function buildRoute(overrides = {}) {
  return {
    key: 'support-thread',
    params: {
      ticketId: 'TICKET-123',
      source: 'support-ticket',
      ...overrides,
    },
  };
}

describe('RobotaxiSupportThreadScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SupportTicketService.getTicket.mockResolvedValue({
      id: 'TICKET-123',
      status: 'assigned',
    });
    SupportTicketService.getTicketMessages.mockResolvedValue([
      {
        id: 'message-user',
        senderType: 'user',
        message: 'Preciso de ajuda com a cobrança.',
        createdAt: '2026-07-12T10:00:00.000Z',
      },
      {
        id: 'message-agent',
        senderType: 'agent',
        message: 'Olá, já estamos analisando seu caso.',
        createdAt: '2026-07-12T10:01:00.000Z',
      },
      {
        id: 'message-internal',
        senderType: 'agent',
        message: 'Nota interna que o usuário não pode ler.',
        isInternal: true,
        createdAt: '2026-07-12T10:02:00.000Z',
      },
    ]);
    SupportTicketService.addMessage.mockResolvedValue({
      id: 'message-new',
      senderType: 'user',
      message: 'Obrigado pelo retorno.',
      createdAt: '2026-07-12T10:03:00.000Z',
    });
  });

  it('loads the REST thread, exposes the dashboard reply and supports manual refresh', async () => {
    const screen = render(
      <RobotaxiSupportThreadScreen navigation={buildNavigation()} route={buildRoute()} />,
    );

    await waitFor(() => {
      expect(SupportTicketService.getTicket).toHaveBeenCalledWith('TICKET-123');
      expect(SupportTicketService.getTicketMessages).toHaveBeenCalledWith('TICKET-123');
      expect(screen.getByText('Olá, já estamos analisando seu caso.')).toBeTruthy();
    });

    expect(screen.getByText('Em atendimento')).toBeTruthy();
    expect(screen.queryByText('Nota interna que o usuário não pode ler.')).toBeNull();
    expect(SUPPORT_TICKET_POLL_MS).toBeGreaterThanOrEqual(5000);

    fireEvent(screen.getByTestId('robotaxi-support-thread-list'), 'refresh');

    await waitFor(() => {
      expect(SupportTicketService.getTicketMessages).toHaveBeenCalledTimes(2);
    });

    screen.unmount();
  });

  it('sends one primary reply through REST and reloads the canonical thread', async () => {
    SupportTicketService.getTicketMessages
      .mockResolvedValueOnce([
        {
          id: 'message-agent',
          senderType: 'agent',
          message: 'Como podemos ajudar?',
          createdAt: '2026-07-12T10:01:00.000Z',
        },
      ])
      .mockResolvedValue([
        {
          id: 'message-agent',
          senderType: 'agent',
          message: 'Como podemos ajudar?',
          createdAt: '2026-07-12T10:01:00.000Z',
        },
        {
          id: 'message-new',
          senderType: 'user',
          message: 'Preciso corrigir o recibo.',
          createdAt: '2026-07-12T10:03:00.000Z',
        },
      ]);

    const screen = render(
      <RobotaxiSupportThreadScreen navigation={buildNavigation()} route={buildRoute()} />,
    );

    await waitFor(() => expect(screen.getByText('Como podemos ajudar?')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('robotaxi-support-thread-input'), 'Preciso corrigir o recibo.');
    fireEvent.press(screen.getByTestId('robotaxi-support-thread-send-button'));

    await waitFor(() => {
      expect(SupportTicketService.addMessage).toHaveBeenCalledWith('TICKET-123', {
        message: 'Preciso corrigir o recibo.',
        messageType: 'text',
        attachments: [],
      });
      expect(screen.getByText('Preciso corrigir o recibo.')).toBeTruthy();
      expect(SupportTicketService.getTicketMessages).toHaveBeenCalledTimes(2);
    });

    screen.unmount();
  });

  it('returns a direct ticket link to the current support surface', async () => {
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiSupportThreadScreen navigation={navigation} route={buildRoute()} />,
    );

    await waitFor(() => expect(screen.getByText('Preciso de ajuda com a cobrança.')).toBeTruthy());
    fireEvent.press(screen.getByTestId('robotaxi-support-thread-close-button'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeSupport',
      expect.objectContaining({ source: 'support-ticket' }),
    );

    screen.unmount();
  });
});
