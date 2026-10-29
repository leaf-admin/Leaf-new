import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return { Ionicons: () => <View /> };
});

import PassengerRideMomentBanner, {
  PASSENGER_MOMENT_AUTO_HIDE_MS,
  resetPassengerRideMomentMemory,
  resolvePassengerRideMoment,
} from '../src/screens/prototype/home/PassengerRideMomentBanner';

describe('PassengerRideMomentBanner', () => {
  beforeEach(() => {
    resetPassengerRideMomentMemory();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('maps ride moments to the approved banner types', () => {
    expect(resolvePassengerRideMoment('accepted', { driverName: 'Ana', vehicleModel: 'Onix', vehiclePlate: 'ABC1D23' }))
      .toMatchObject({ tone: 'success', title: 'Motorista a caminho', message: 'Ana · Onix · ABC1D23' });
    expect(resolvePassengerRideMoment('arrived')).toMatchObject({ tone: 'action', actionLabel: 'Estou indo', sticky: true });
    expect(resolvePassengerRideMoment('started', { arrivalText: 'Chegada às 10:05' }))
      .toMatchObject({ tone: 'info', message: 'Chegada às 10:05' });
    expect(resolvePassengerRideMoment('searching')).toBeNull();
  });

  it('hides information after 5 s and shows each moment once per ride', () => {
    const screen = render(<PassengerRideMomentBanner bookingId="r1" status="accepted" driverName="Ana" />);
    expect(screen.getByText('Motorista a caminho')).toBeTruthy();
    act(() => jest.advanceTimersByTime(PASSENGER_MOMENT_AUTO_HIDE_MS));
    expect(screen.queryByText('Motorista a caminho')).toBeNull();

    screen.unmount();
    const again = render(<PassengerRideMomentBanner bookingId="r1" status="accepted" />);
    expect(again.queryByText('Motorista a caminho')).toBeNull();
  });

  it('keeps the arrival banner until the passenger answers, then confirms', async () => {
    const onOnMyWay = jest.fn().mockResolvedValue(undefined);
    const screen = render(<PassengerRideMomentBanner bookingId="r2" status="arrived" onOnMyWay={onOnMyWay} />);
    act(() => jest.advanceTimersByTime(PASSENGER_MOMENT_AUTO_HIDE_MS * 3));
    expect(screen.getByText('Motorista chegou')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('passenger-ride-moment-banner-action'));
    });
    expect(onOnMyWay).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Avisamos o motorista')).toBeTruthy();
  });

  it('tells the passenger when the message could not be sent', async () => {
    const onOnMyWay = jest.fn().mockRejectedValue(new Error('offline'));
    const screen = render(<PassengerRideMomentBanner bookingId="r3" status="arrived" onOnMyWay={onOnMyWay} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('passenger-ride-moment-banner-action'));
    });
    expect(screen.getByText('Não deu para avisar')).toBeTruthy();
  });

  it('drops a moment the ride already left', () => {
    const screen = render(<PassengerRideMomentBanner bookingId="r4" status="arrived" onOnMyWay={jest.fn()} />);
    expect(screen.getByText('Motorista chegou')).toBeTruthy();
    screen.rerender(<PassengerRideMomentBanner bookingId="r4" status="started" arrivalText="Chegada às 10:05" />);
    expect(screen.queryByText('Motorista chegou')).toBeNull();
    expect(screen.getByText('Viagem iniciada')).toBeTruthy();
  });
});
