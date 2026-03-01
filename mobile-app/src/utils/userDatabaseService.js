import Logger from './Logger';
import database from '@react-native-firebase/database';
import auth from '@react-native-firebase/auth';


/**
 * Serviço para gerenciar dados do usuário no Realtime Database
 */
export class UserDatabaseService {
  
  /**
   * Cria/atualiza o perfil do usuário no Realtime Database
   * @param {Object} userData - Dados completos do usuário
   * @returns {Promise<boolean>} - Sucesso da operação
   */
  static async saveUserProfile(userData) {
    try {
      const currentUser = auth().currentUser;
      if (!currentUser) {
        Logger.error('❌ Usuário não autenticado');
        return false;
      }

      const uid = currentUser.uid;
      Logger.log('💾 Salvando perfil do usuário no Realtime Database:', uid);
      Logger.log('📱 Dados recebidos para salvar:', userData);

      // Obter telefone completo - priorizar dados do onboarding
      let phoneNumber = '';
      if (userData.phoneNumber && userData.phoneNumber !== '+55') {
        phoneNumber = userData.phoneNumber;
      } else if (currentUser.phoneNumber) {
        phoneNumber = currentUser.phoneNumber;
      } else {
        // Se não tiver telefone, usar o que está no authData
        phoneNumber = userData.phoneNumber || '+55';
      }

      Logger.log('📱 Telefone que será salvo:', phoneNumber);

      // Preparar dados para salvar (SEM senha)
      const profileData = {
        // Dados básicos
        uid: uid,
        mobile: phoneNumber, // Corrected to use the full phoneNumber
        email: userData.documentData?.email || currentUser.email,
        
        // Dados pessoais
        firstName: userData.profileData?.firstName || '',
        lastName: userData.profileData?.lastName || '',
        dateOfBirth: userData.profileData?.dateOfBirth || '',
        gender: userData.profileData?.gender || '',
        
        // Dados do documento
        cpf: userData.documentData?.cpf || '',
        
        // Tipo de usuário
        usertype: userData.profileSelection?.userType || 'customer',
        
        // Status de validação
        phoneValidated: userData.phoneValidated || false,
        cnhUploaded: userData.cnhUploaded || false,
        
        // Status de aprovação (apenas para drivers)
        isApproved: userData.profileSelection?.userType === 'driver' ? false : undefined,

        // Timestamps
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        
        // Dados de marketing
        acceptMarketing: userData.credentials?.acceptMarketing || false,
        acceptTerms: userData.credentials?.acceptTerms || false,
        
        // Status do perfil
        profileComplete: true,
        onboardingCompleted: true
      };

      Logger.log('💾 Dados finais que serão salvos:', profileData);

      // Salvar no Realtime Database
      await database().ref(`users/${uid}`).set(profileData);
      
      Logger.log('✅ Perfil do usuário salvo com sucesso no Realtime Database');
      return true;
      
    } catch (error) {
      Logger.error('❌ Erro ao salvar perfil do usuário:', error);
      return false;
    }
  }

  /**
   * Verifica se o usuário já existe no Realtime Database
   * @param {string} uid - UID do usuário
   * @returns {Promise<boolean>} - Se o usuário existe
   */
  static async userExists(uid) {
    try {
      const snapshot = await database().ref(`users/${uid}`).once('value');
      return snapshot.exists();
    } catch (error) {
      Logger.error('❌ Erro ao verificar se usuário existe:', error);
      return false;
    }
  }

  /**
   * Obtém dados do usuário do Realtime Database
   * @param {string} uid - UID do usuário
   * @returns {Promise<Object|null>} - Dados do usuário
   */
  static async getUserProfile(uid) {
    try {
      const snapshot = await database().ref(`users/${uid}`).once('value');
      return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
      Logger.error('❌ Erro ao obter perfil do usuário:', error);
      return null;
    }
  }
}

export default UserDatabaseService;
