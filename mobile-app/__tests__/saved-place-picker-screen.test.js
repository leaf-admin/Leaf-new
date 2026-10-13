import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import LeafSavedPlacePickerScreen from '../src/screens/prototype/LeafSavedPlacePickerScreen';
const mockRuntime = jest.fn();
jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({ usePrototypeRideRuntime: () => mockRuntime() }));
jest.mock('../src/components/prototype/LeafVisualElements', () => ({ LeafObjectIcon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
const place = { id: 'p1', name: 'Rua A', address: 'Rua A, 10', coordinate: { latitude: -22, longitude: -43 } };

describe('address selection without a ride mutation', () => {
  let runtime;
  const route = { params: { ownerUid: 'u1', returnRouteKey: 'saved-key' } };
  beforeEach(() => {
    runtime = { profileUid: 'u1', loadRecentDestinations: jest.fn().mockResolvedValue([place]), loadDestinationSuggestions: jest.fn().mockResolvedValue([place]), resolveDestinationInput: jest.fn().mockResolvedValue(place), selectDestination: jest.fn() };
    mockRuntime.mockImplementation(() => runtime);
  });
  afterEach(() => jest.useRealTimers());
  it('returns a selected coordinate to the existing saved-place route and leaves the ride untouched', async () => {
    const navigation = { dispatch: jest.fn(), goBack: jest.fn() };
    const screen = render(<LeafSavedPlacePickerScreen route={route} navigation={navigation} />);
    fireEvent.press(await screen.findByTestId('leaf-place-search-result-0'));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(navigation.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_PARAMS', source: 'saved-key', payload: { params: { selectedSavedPlace: { ownerUid: 'u1', place } } } }));
    expect(runtime.selectDestination).not.toHaveBeenCalled();
  });
  it('debounces queries and does not request a one or two character query', async () => {
    jest.useFakeTimers();
    const screen = render(<LeafSavedPlacePickerScreen route={route} navigation={{ goBack: jest.fn() }} />);
    fireEvent.changeText(screen.getByTestId('leaf-place-search-input'), 'Ru');
    await act(async () => jest.advanceTimersByTime(400));
    expect(runtime.loadDestinationSuggestions).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('leaf-place-search-input'), 'Rua');
    await act(async () => jest.advanceTimersByTime(349));
    expect(runtime.loadDestinationSuggestions).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(runtime.loadDestinationSuggestions).toHaveBeenCalledWith('Rua');
  });
  it('discards a selection that resolves after the authenticated user changes', async () => {
    let finish;
    runtime.resolveDestinationInput.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const navigation = { dispatch: jest.fn(), goBack: jest.fn() };
    const screen = render(<LeafSavedPlacePickerScreen route={route} navigation={navigation} />);
    fireEvent.press(await screen.findByTestId('leaf-place-search-result-0'));
    runtime.profileUid = 'u2';
    screen.rerender(<LeafSavedPlacePickerScreen route={route} navigation={navigation} />);
    await act(async () => finish(place));
    expect(navigation.dispatch).not.toHaveBeenCalled();
    expect(screen.queryByText('Rua A')).toBeNull();
  });
  it('keeps the picker open with a retryable error when coordinates cannot be confirmed', async () => {
    runtime.resolveDestinationInput.mockRejectedValue(new Error('offline'));
    const navigation = { dispatch: jest.fn(), goBack: jest.fn() };
    const screen = render(<LeafSavedPlacePickerScreen route={route} navigation={navigation} />);
    fireEvent.press(await screen.findByTestId('leaf-place-search-result-0'));
    expect(await screen.findByText('Não foi possível confirmar esse endereço. Escolha novamente.')).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
