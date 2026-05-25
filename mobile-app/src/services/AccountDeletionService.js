import firebaseAuth from '@react-native-firebase/auth';
import { apiClient } from './httpClient';

const resolveProfilePhone = (profile, firebaseUser) => (
  profile?.mobile ||
  profile?.phone ||
  profile?.phoneNumber ||
  firebaseUser?.phoneNumber ||
  ''
);

export async function requestAuthenticatedAccountDeletion({
  profile,
  reason = 'user_requested_mobile_app',
  additionalInfo = 'Solicitacao enviada pelo app',
  source = 'mobile-app'
} = {}) {
  const firebaseUser = firebaseAuth().currentUser;
  const token = await firebaseUser?.getIdToken(true);

  if (!token) {
    throw new Error('Sessao invalida para solicitar exclusao de conta.');
  }

  const payload = {
    reason,
    additionalInfo,
    phone: resolveProfilePhone(profile, firebaseUser),
    source
  };

  try {
    const response = await apiClient.post('/api/account/delete', payload, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    return response?.data || {};
  } catch (error) {
    const fallbackUserId = profile?.id || profile?.uid || firebaseUser?.uid;

    if (fallbackUserId && error?.response?.status === 404) {
      const response = await apiClient.delete(`/api/privacy/delete-data/${fallbackUserId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      return response?.data || {};
    }

    throw error;
  }
}
