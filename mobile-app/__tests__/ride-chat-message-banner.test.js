import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return { Ionicons: () => <View /> };
});

import RideChatMessageBanner, {
  RIDE_CHAT_NOTICE_AUTO_HIDE_MS,
  resolveRideChatNoticeTitle,
} from '../src/screens/prototype/home/RideChatMessageBanner';
import { shouldAcceptIncomingChatMessage } from '../src/screens/prototype/chatMessageRouting';

describe('RideChatMessageBanner', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const notice = { id: 'm1', bookingId: 'ride_1', text: 'Estou indo', senderType: 'passenger', receivedAt: 1_000 };

  it('names who sent the message', () => {
    expect(resolveRideChatNoticeTitle('passenger')).toBe('Mensagem do passageiro');
    expect(resolveRideChatNoticeTitle('driver')).toBe('Mensagem do motorista');
  });

  it('shows the message with Responder and hides after 5 s', () => {
    const onReply = jest.fn();
    const onDismiss = jest.fn();
    const screen = render(
      <RideChatMessageBanner notice={notice} bookingId="ride_1" onReply={onReply} onDismiss={onDismiss} now={() => 2_000} />
    );
    expect(screen.getByText('Mensagem do passageiro')).toBeTruthy();
    expect(screen.getByText('Estou indo')).toBeTruthy();
    act(() => jest.advanceTimersByTime(RIDE_CHAT_NOTICE_AUTO_HIDE_MS));
    expect(screen.queryByText('Estou indo')).toBeNull();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('opens the chat from Responder', () => {
    const onReply = jest.fn();
    const screen = render(<RideChatMessageBanner notice={notice} bookingId="ride_1" onReply={onReply} now={() => 2_000} />);
    fireEvent.press(screen.getByTestId('ride-chat-message-banner-action'));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Estou indo')).toBeNull();
  });

  it('ignores stale notices and notices from another ride', () => {
    const stale = render(<RideChatMessageBanner notice={notice} bookingId="ride_1" now={() => 60_000} />);
    expect(stale.queryByText('Estou indo')).toBeNull();
    const other = render(<RideChatMessageBanner notice={notice} bookingId="ride_2" now={() => 2_000} />);
    expect(other.queryByText('Estou indo')).toBeNull();
  });
});

describe('shouldAcceptIncomingChatMessage', () => {
  it('keeps the open conversation filter', () => {
    const state = { activeChatId: 'ride_1', activeChatBookingId: 'ride_1' };
    expect(shouldAcceptIncomingChatMessage(state, 'ride_1')).toBe(true);
    expect(shouldAcceptIncomingChatMessage(state, 'ride_9')).toBe(false);
  });

  it('accepts the active ride message when a chat from an earlier ride is still saved', () => {
    const state = { activeChatId: 'ride_old', activeChatBookingId: 'ride_old', driverActiveRide: { bookingId: 'ride_new' } };
    expect(shouldAcceptIncomingChatMessage(state, 'ride_new')).toBe(true);
    expect(shouldAcceptIncomingChatMessage(state, 'ride_other')).toBe(false);
  });

  it('accepts the active ride message when no chat is open', () => {
    expect(shouldAcceptIncomingChatMessage({ driverActiveRide: { bookingId: 'ride_1' } }, 'ride_1')).toBe(true);
    expect(shouldAcceptIncomingChatMessage({ activeBookingId: 'ride_1' }, 'ride_1')).toBe(true);
    expect(shouldAcceptIncomingChatMessage({ activeBookingId: 'ride_1' }, 'ride_2')).toBe(false);
    expect(shouldAcceptIncomingChatMessage({}, 'ride_1')).toBe(false);
  });
});
