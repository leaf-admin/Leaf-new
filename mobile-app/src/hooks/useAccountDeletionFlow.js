import { useCallback } from 'react';
import { Alert } from 'react-native';

import { requestAuthenticatedAccountDeletion } from '../services/AccountDeletionService';
import { useAccountSessionReset } from './useAccountSessionReset';
import Logger from '../utils/Logger';

export function useAccountDeletionFlow({
  navigation,
  profile,
  source = 'mobile-app',
  additionalInfo = 'Solicitação enviada pelo app mobile',
} = {}) {
  const { resetSessionToStart } = useAccountSessionReset({ navigation, profile });

  const confirmDeleteData = useCallback(async () => {
    const response = await requestAuthenticatedAccountDeletion({
      source,
      additionalInfo,
      profile: {
        id: profile?.id,
        uid: profile?.uid,
        name: profile?.name,
        mobile: profile?.mobile,
        phone: profile?.phone,
        phoneNumber: profile?.phoneNumber,
        email: profile?.email,
      },
    });

    const confirmationMessage = response?.message
      || 'Sua conta foi excluída com sucesso.';

    try {
      await resetSessionToStart();
    } catch (error) {
      // A exclusão já foi confirmada pelo servidor; não reportar como falha.
      Logger.error('Erro ao encerrar a sessão após excluir a conta:', error);
    }
    Alert.alert('Conta excluída', confirmationMessage);
  }, [additionalInfo, profile, resetSessionToStart, source]);

  const promptAccountDeletion = useCallback(() => {
    Alert.alert(
      'Excluir conta',
      'Essa ação é irreversível e removerá sua conta e seus dados da Leaf. Deseja continuar?',
      [
        {
          text: 'Cancelar',
          style: 'cancel',
        },
        {
          text: 'Excluir conta',
          style: 'destructive',
          onPress: () => {
            confirmDeleteData().catch((error) => {
              Logger.error('Erro ao excluir conta pelo app:', error);
              Alert.alert(
                'Não foi possível excluir a conta',
                error?.message || 'Tente novamente em alguns instantes.',
              );
            });
          },
        },
      ],
    );
  }, [confirmDeleteData]);

  return {
    promptAccountDeletion,
  };
}
