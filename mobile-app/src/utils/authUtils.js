import AsyncStorage from '@react-native-async-storage/async-storage';
import firebase from '@react-native-firebase/app';
import '@react-native-firebase/auth';
import '@react-native-firebase/firestore';

export const USER_DATA_KEY = '@user_data';

/**
 * Verifica se o usuário tem um perfil válido e completo
 * Faz validação local + servidor para garantir segurança
 */
export const validateUserProfile = async () => {
  try {
    console.log('🔍 Iniciando validação de perfil do usuário...');
    
    // 1. Verificar dados locais
    const localUserData = await AsyncStorage.getItem(USER_DATA_KEY);
    if (!localUserData) {
      console.log('❌ Nenhum dado local encontrado');
      return { isValid: false, reason: 'no_local_data' };
    }

    const localProfile = JSON.parse(localUserData);
    console.log('📱 Dados locais encontrados:', {
      uid: localProfile.uid,
      email: localProfile.email,
      usertype: localProfile.usertype
    });

    // 2. Verificar se o usuário está logado no Firebase
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
      console.log('❌ Usuário não está logado no Firebase');
      await AsyncStorage.removeItem(USER_DATA_KEY); // Limpar dados inválidos
      return { isValid: false, reason: 'not_logged_in' };
    }

    // 3. Verificar se o UID local corresponde ao Firebase
    if (localProfile.uid !== currentUser.uid) {
      console.log('❌ UID local não corresponde ao Firebase');
      await AsyncStorage.removeItem(USER_DATA_KEY);
      return { isValid: false, reason: 'uid_mismatch' };
    }

    // 4. Verificar se o perfil existe no Firestore
    const userDoc = await firebase.firestore()
      .collection('users')
      .doc(currentUser.uid)
      .get();

    if (!userDoc.exists) {
      console.log('❌ Perfil não encontrado no Firestore');
      await AsyncStorage.removeItem(USER_DATA_KEY);
      return { isValid: false, reason: 'profile_not_found' };
    }

    const serverProfile = userDoc.data();
    console.log('☁️ Perfil encontrado no servidor:', {
      uid: serverProfile.uid,
      email: serverProfile.email,
      usertype: serverProfile.usertype
    });

    // 5. Verificar se os dados estão sincronizados
    const isSynced = (
      localProfile.email === serverProfile.email &&
      localProfile.usertype === serverProfile.usertype &&
      localProfile.firstName === serverProfile.firstName &&
      localProfile.lastName === serverProfile.lastName
    );

    if (!isSynced) {
      console.log('⚠️ Dados locais desatualizados, sincronizando...');
      // Atualizar dados locais com dados do servidor
      const updatedProfile = {
        ...localProfile,
        ...serverProfile
      };
      await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(updatedProfile));
      console.log('✅ Dados sincronizados');
    }

    // 6. Verificar se o perfil está completo
    const isComplete = (
      serverProfile.firstName &&
      serverProfile.lastName &&
      serverProfile.email &&
      serverProfile.phoneNumber
    );

    if (!isComplete) {
      console.log('⚠️ Perfil incompleto:', {
        hasFirstName: !!serverProfile.firstName,
        hasLastName: !!serverProfile.lastName,
        hasEmail: !!serverProfile.email,
        hasPhone: !!serverProfile.phoneNumber
      });
      return { 
        isValid: false, 
        reason: 'incomplete_profile',
        profile: serverProfile
      };
    }

    console.log('✅ Perfil válido e completo!');
    return { 
      isValid: true, 
      profile: serverProfile,
      isSynced: isSynced
    };

  } catch (error) {
    console.error('💥 Erro na validação de perfil:', error);
    
    // Em caso de erro, limpar dados locais para forçar novo login
    try {
      await AsyncStorage.removeItem(USER_DATA_KEY);
    } catch (clearError) {
      console.error('Erro ao limpar dados locais:', clearError);
    }
    
    return { 
      isValid: false, 
      reason: 'validation_error',
      error: error.message
    };
  }
};

/**
 * Limpa todos os dados de autenticação
 */
export const clearAuthData = async () => {
  try {
    await AsyncStorage.removeItem(USER_DATA_KEY);
    await firebase.auth().signOut();
    console.log('✅ Dados de autenticação limpos');
  } catch (error) {
    console.error('❌ Erro ao limpar dados de autenticação:', error);
  }
};

/**
 * Obtém dados do usuário de forma segura
 */
export const getSecureUserData = async () => {
  const validation = await validateUserProfile();
  return validation;
}; 