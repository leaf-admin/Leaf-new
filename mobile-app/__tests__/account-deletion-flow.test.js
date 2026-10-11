import { Alert } from 'react-native';
import { renderHook } from '@testing-library/react-native';

import { useAccountDeletionFlow } from '../src/hooks/useAccountDeletionFlow';
import { requestAuthenticatedAccountDeletion } from '../src/services/AccountDeletionService';

const mockResetSessionToStart = jest.fn();

jest.mock('../src/services/AccountDeletionService', () => ({
  requestAuthenticatedAccountDeletion: jest.fn(),
}));

jest.mock('../src/hooks/useAccountSessionReset', () => ({
  useAccountSessionReset: () => ({ resetSessionToStart: mockResetSessionToStart }),
}));

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function confirmDeletion() {
  const { result } = renderHook(() => useAccountDeletionFlow({ profile: { uid: 'user-1' } }));
  result.current.promptAccountDeletion();
  const buttons = Alert.alert.mock.calls[0][2];
  Alert.alert.mockClear();
  buttons.find((button) => button.style === 'destructive').onPress();
  await flush();
}

describe('useAccountDeletionFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  test('confirms the deletion even when the local session reset throws afterwards', async () => {
    requestAuthenticatedAccountDeletion.mockResolvedValue({ message: 'Conta removida.' });
    mockResetSessionToStart.mockRejectedValue(new Error('storage unavailable'));

    await confirmDeletion();

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('Conta excluída', 'Conta removida.');
  });

  test('still reports a failure when the server rejects the deletion', async () => {
    requestAuthenticatedAccountDeletion.mockRejectedValue(new Error('Sem conexão'));

    await confirmDeletion();

    expect(mockResetSessionToStart).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('Não foi possível excluir a conta', 'Sem conexão');
  });
});
