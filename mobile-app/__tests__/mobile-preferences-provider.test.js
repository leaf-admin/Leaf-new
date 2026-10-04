import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { MobilePreferencesProvider, useMobilePreferences } from '../src/components/MobilePreferencesProvider';
import service from '../src/services/MobilePreferencesService';
let mockUid = 'one';
jest.mock('react-redux', () => ({ useSelector: fn => fn({ auth: { uid: mockUid } }) }));
jest.mock('../src/services/MobilePreferencesService', () => ({
  __esModule: true,
  DEFAULT_MOBILE_PREFERENCES: { notificationsEnabled: true, trafficLayerEnabled: true, voiceGuidanceEnabled: false },
  getCachedMobilePreferences: jest.fn(() => null),
  default: { getPreferences: jest.fn(), updatePreferences: jest.fn() },
}));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const defaults = { trafficLayerEnabled: true, voiceGuidanceEnabled: false };
function Consumer() {
  const state = useMobilePreferences();
  return <><Text testID="state">{JSON.stringify({ uid: state.uid, ...state.preferences, ready: state.ready, saving: state.saving, error: state.error })}</Text>
    <TouchableOpacity testID="toggle" onPress={() => state.update({ trafficLayerEnabled: false }).catch(() => {})} />
    <TouchableOpacity testID="retry" onPress={() => state.refresh({ forceRefresh: true })} /></>;
}
const App = () => <MobilePreferencesProvider><Consumer /></MobilePreferencesProvider>;
const state = ui => JSON.parse(ui.getByTestId('state').props.children);

describe('shared account preference provider', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockUid = 'one';
    service.getPreferences.mockResolvedValue(defaults);
    service.updatePreferences.mockResolvedValue({ ...defaults, trafficLayerEnabled: false });
  });
  it('loads authenticated settings and exposes confirmed updates to every consumer', async () => {
    const ui = render(<App />);
    await waitFor(() => expect(state(ui).ready).toBe(true));
    fireEvent.press(ui.getByTestId('toggle'));
    await waitFor(() => expect(state(ui).trafficLayerEnabled).toBe(false));
    expect(service.updatePreferences).toHaveBeenCalledWith({ trafficLayerEnabled: false }, { uid: 'one' });
  });
  it('does not expose another account preferences while switching or finishing an old request', async () => {
    const old = deferred(); const next = deferred();
    service.getPreferences.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const ui = render(<App />);
    mockUid = 'two'; ui.rerender(<App />);
    expect(state(ui)).toMatchObject({ uid: 'two', trafficLayerEnabled: true, voiceGuidanceEnabled: false, ready: false });
    await act(async () => old.resolve({ trafficLayerEnabled: false, voiceGuidanceEnabled: true }));
    expect(state(ui)).toMatchObject({ uid: 'two', voiceGuidanceEnabled: false, ready: false });
    await act(async () => next.resolve(defaults));
    expect(state(ui).ready).toBe(true);
  });
  it('retains the confirmed state when a mutation fails', async () => {
    service.updatePreferences.mockRejectedValue(new Error('Offline'));
    const ui = render(<App />); await waitFor(() => expect(state(ui).ready).toBe(true));
    fireEvent.press(ui.getByTestId('toggle'));
    await waitFor(() => expect(state(ui).error).toBe('Offline'));
    expect(state(ui).trafficLayerEnabled).toBe(true);
  });
  it('allows retry after a read fails instead of presenting unsaved defaults as ready', async () => {
    service.getPreferences.mockRejectedValueOnce(new Error('Offline'));
    const ui = render(<App />);
    await waitFor(() => expect(state(ui).error).toBe('Offline')); expect(state(ui).ready).toBe(false);
    fireEvent.press(ui.getByTestId('retry'));
    await waitFor(() => expect(state(ui).ready).toBe(true));
    expect(service.getPreferences).toHaveBeenLastCalledWith({ uid: 'one', forceRefresh: true });
  });
});
