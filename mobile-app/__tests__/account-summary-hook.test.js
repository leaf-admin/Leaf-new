import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import useAccountSummary from '../src/hooks/useAccountSummary';
const mockLoad = jest.fn();
jest.mock('../src/services/AccountSummaryService', () => ({ getCachedAccountSummary: () => null, loadAccountSummary: (...args) => mockLoad(...args) }));
function Probe(props) {
  const value = useAccountSummary(props);
  return <Text>{value.summary?.profile?.name || (value.loading ? 'Carregando' : 'Indisponível')}</Text>;
}
describe('account summary ownership', () => {
  beforeEach(() => mockLoad.mockReset());
  it('ignores an old user response without showing its data', async () => {
    let first;
    mockLoad.mockImplementation(uid => uid === 'u1' ? new Promise(resolve => { first = resolve; }) : Promise.resolve({ profile: { name: 'Beatriz' } }));
    const screen = render(<Probe uid="u1" role="customer" focused />);
    expect(screen.getByText('Carregando')).toBeTruthy();
    screen.rerender(<Probe uid="u2" role="customer" focused />);
    await waitFor(() => expect(screen.getByText('Beatriz')).toBeTruthy());
    await act(async () => first({ profile: { name: 'Ana' } }));
    expect(screen.queryByText('Ana')).toBeNull();
  });
  it('does not request data while the account tab is hidden', () => {
    render(<Probe uid="u1" role="customer" focused={false} />);
    expect(mockLoad).not.toHaveBeenCalled();
  });
});
