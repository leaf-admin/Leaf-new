import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({
  usePrototypeRideRuntime: jest.fn(),
}));

import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
import RobotaxiNotificationsScreen, {
  formatNotificationTime,
} from '../src/screens/prototype/RobotaxiNotificationsScreen';

const navigation = { canGoBack: jest.fn(() => true), goBack: jest.fn(), navigate: jest.fn() };

function mockRuntime(overrides = {}) {
  const runtime = {
    notifications: [
      { id: 'n1', title: 'Motorista a caminho', message: 'Chega em 4 min.', read: false, createdAt: new Date().toISOString() },
      { id: 'n2', title: 'Corrida concluída', message: 'Obrigado por viajar com a Leaf.', read: true, createdAt: new Date().toISOString() },
    ],
    unreadNotificationCount: 1,
    markNotificationRead: jest.fn(),
    markAllNotificationsRead: jest.fn(),
    ...overrides,
  };
  usePrototypeRideRuntime.mockReturnValue(runtime);
  return runtime;
}

describe('RobotaxiNotificationsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists notifications, marks one read on tap and the rest when leaving', () => {
    const runtime = mockRuntime();
    const screen = render(<RobotaxiNotificationsScreen navigation={navigation} />);

    expect(screen.getByText('Notificações')).toBeTruthy();
    expect(screen.getByLabelText('Nova. Motorista a caminho. Chega em 4 min.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('notification-row-n1'));
    expect(runtime.markNotificationRead).toHaveBeenCalledWith('n1');

    fireEvent.press(screen.getByTestId('notifications-mark-all'));
    expect(runtime.markAllNotificationsRead).toHaveBeenCalledTimes(1);

    screen.unmount();
    expect(runtime.markAllNotificationsRead).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state without the mark-all action', () => {
    mockRuntime({ notifications: [], unreadNotificationCount: 0 });
    const screen = render(<RobotaxiNotificationsScreen navigation={navigation} />);

    expect(screen.getByTestId('notifications-empty')).toBeTruthy();
    expect(screen.queryByTestId('notifications-mark-all')).toBeNull();
    fireEvent.press(screen.getByTestId('notifications-back'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('formats times like a ride app inbox', () => {
    const now = new Date('2026-10-07T18:00:00Z').getTime();
    expect(formatNotificationTime('2026-10-07T17:59:40Z', now)).toBe('agora');
    expect(formatNotificationTime('2026-10-07T17:48:00Z', now)).toBe('12 min');
    expect(formatNotificationTime('2026-10-07T15:00:00Z', now)).toBe('3 h');
    expect(formatNotificationTime('2026-10-06T12:00:00Z', now)).toBe('ontem');
    expect(formatNotificationTime('2026-03-18T12:00:00Z', now)).toBe('18 mar');
    expect(formatNotificationTime('not a date', now)).toBe('');
  });
});
