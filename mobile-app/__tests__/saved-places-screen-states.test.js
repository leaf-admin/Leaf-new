import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import LeafSavedPlacesScreen from '../src/screens/prototype/LeafSavedPlacesScreen';

const mockRuntime = jest.fn();
const mockSnapshot = jest.fn();
const mockRemove = jest.fn();
jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({ usePrototypeRideRuntime: () => mockRuntime() }));
jest.mock('../src/components/prototype/LeafVisualElements', () => ({ LeafObjectIcon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/services/SavedPlacesService', () => ({
  getSavedPlacesSnapshot: (...args) => mockSnapshot(...args),
  removeSavedPlace: (...args) => mockRemove(...args),
  savePlace: jest.fn(),
  syncLocalSavedPlaces: jest.fn(),
}));

const place = { id: 'p1', name: 'Casa', address: 'Rua A, 10', coordinate: { latitude: -22, longitude: -43 } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('saved places screen states', () => {
  beforeEach(() => {
    mockRuntime.mockReturnValue({ profileUid: 'u1', loadRecentDestinations: jest.fn().mockResolvedValue([]) });
    mockSnapshot.mockReset();
    mockRemove.mockReset();
  });

  it('shows only the loading state before the first answer, without claiming local storage', async () => {
    const pending = deferred();
    mockSnapshot.mockReturnValue(pending.promise);
    const screen = render(<LeafSavedPlacesScreen navigation={{ goBack: jest.fn() }} route={{ key: 'saved' }} />);
    expect(screen.getByText('Carregando endereços…')).toBeTruthy();
    expect(screen.getByText('Sincronizando com sua conta…')).toBeTruthy();
    expect(screen.queryByText('Salvos neste aparelho')).toBeNull();
    expect(screen.queryByText('Adicionar endereço')).toBeNull();
    expect(screen.queryByText('Seus lugares, por perto')).toBeNull();
    await act(async () => pending.resolve({ places: [], localOnly: [], synced: true }));
    expect(screen.getByText('Seus lugares, por perto')).toBeTruthy();
    expect(screen.getByText('Adicionar endereço')).toBeTruthy();
    expect(screen.getByText('Sincronizados com sua conta')).toBeTruthy();
  });

  it('confirms before removing and does not fall back to the full loading state afterwards', async () => {
    mockSnapshot.mockResolvedValueOnce({ places: [place], localOnly: [], synced: true });
    const reload = deferred();
    mockSnapshot.mockReturnValueOnce(reload.promise);
    mockRemove.mockResolvedValue([]);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<LeafSavedPlacesScreen navigation={{ goBack: jest.fn() }} route={{ key: 'saved' }} />);
    await waitFor(() => expect(screen.getByText('Casa')).toBeTruthy());
    fireEvent.press(screen.getByTestId('leaf-place-remove-0'));
    expect(mockRemove).not.toHaveBeenCalled();
    const removeAction = alert.mock.calls[0][2].find(button => button.text === 'Remover');
    // Not awaited: mutate() then waits for the reload resolved below.
    act(() => { removeAction.onPress(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mockRemove).toHaveBeenCalledWith('u1', 'p1');
    expect(screen.queryByText('Carregando endereços…')).toBeNull();
    expect(screen.getByText('Seus lugares, por perto')).toBeTruthy();
    await act(async () => reload.resolve({ places: [], localOnly: [], synced: true }));
    alert.mockRestore();
  });
});
