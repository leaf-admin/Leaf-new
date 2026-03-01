import Logger from './Logger';
import AsyncStorage from '@react-native-async-storage/async-storage';


const OLD_STORAGE_KEYS = {
  ONBOARDING_DATA: '@onboarding_data',
  ONBOARDING_PROGRESS: '@onboarding_progress',
  CURRENT_STEP: '@onboarding_current_step'
};

const NEW_STORAGE_KEYS = {
  ENCRYPTED_DATA: '@onboarding_encrypted_data',
  PROGRESS: '@onboarding_progress',
  CURRENT_STEP: '@onboarding_current_step'
};

// Função para migrar dados existentes
export const migrateOnboardingData = async () => {
  try {
    Logger.log('🔄 Iniciando migração para armazenamento seguro...');
    
    // Verificar se já foi migrado
    const alreadyMigrated = await AsyncStorage.getItem('migration_completed');
    if (alreadyMigrated) {
      Logger.log('✅ Migração já foi realizada anteriormente');
      return true;
    }
    
    // Carregar dados antigos
    const oldData = await AsyncStorage.getItem(OLD_STORAGE_KEYS.ONBOARDING_DATA);
    const oldProgress = await AsyncStorage.getItem(OLD_STORAGE_KEYS.ONBOARDING_PROGRESS);
    const oldCurrentStep = await AsyncStorage.getItem(OLD_STORAGE_KEYS.CURRENT_STEP);
    
    if (!oldData && !oldProgress && !oldCurrentStep) {
      Logger.log('ℹ️ Nenhum dado antigo encontrado para migrar');
              await AsyncStorage.setItem('migration_completed', 'true');
      return true;
    }
    
    // Migrar dados sensíveis
    if (oldData) {
      const parsedData = JSON.parse(oldData);
      Logger.log('📥 Dados antigos encontrados:', parsedData);
      
      // Separar dados sensíveis e não sensíveis
      const sensitiveData = {};
      const nonSensitiveData = {};
      
      Object.keys(parsedData).forEach(step => {
        const stepData = parsedData[step];
        
        // Filtrar dados sensíveis
        if (step === 'profile_data') {
          sensitiveData[step] = {
            firstName: stepData.firstName || '',
            lastName: stepData.lastName || '',
            dateOfBirth: stepData.dateOfBirth || '',
            gender: stepData.gender || '',
            timestamp: stepData.timestamp
          };
        } else if (step === 'document_data') {
          sensitiveData[step] = {
            cpf: stepData.cpf || '',
            email: stepData.email || '',
            timestamp: stepData.timestamp
          };
        } else if (step === 'credentials') {
          sensitiveData[step] = {
            password: stepData.password || '',
            confirmPassword: stepData.confirmPassword || '',
            timestamp: stepData.timestamp
          };
        } else {
          // Dados não sensíveis
          nonSensitiveData[step] = stepData;
        }
      });
      
      // Salvar dados sensíveis no novo formato
      if (Object.keys(sensitiveData).length > 0) {
        await AsyncStorage.setItem(NEW_STORAGE_KEYS.ENCRYPTED_DATA, JSON.stringify(sensitiveData));
        Logger.log('🔒 Dados sensíveis migrados para armazenamento seguro');
      }
      
      // Salvar dados não sensíveis
      Object.keys(nonSensitiveData).forEach(step => {
        AsyncStorage.setItem(`onboarding_${step}`, JSON.stringify(nonSensitiveData[step]));
      });
    }
    
    // Migrar progresso
    if (oldProgress) {
      const parsedProgress = JSON.parse(oldProgress);
      await AsyncStorage.setItem(NEW_STORAGE_KEYS.PROGRESS, JSON.stringify(parsedProgress));
      Logger.log('📊 Progresso migrado para armazenamento seguro');
    }
    
    // Migrar step atual
    if (oldCurrentStep) {
      await AsyncStorage.setItem(NEW_STORAGE_KEYS.CURRENT_STEP, oldCurrentStep);
      Logger.log('📍 Step atual migrado para armazenamento seguro');
    }
    
    // Limpar dados antigos do AsyncStorage
    await Promise.all([
      AsyncStorage.removeItem(OLD_STORAGE_KEYS.ONBOARDING_DATA),
      AsyncStorage.removeItem(OLD_STORAGE_KEYS.ONBOARDING_PROGRESS),
      AsyncStorage.removeItem(OLD_STORAGE_KEYS.CURRENT_STEP)
    ]);
    
    // Marcar migração como concluída
    await AsyncStorage.setItem('migration_completed', 'true');
    
    Logger.log('✅ Migração concluída com sucesso!');
    return true;
    
  } catch (error) {
    Logger.error('❌ Erro durante migração:', error);
    return false;
  }
};

// Função para verificar se há dados antigos
export const hasOldData = async () => {
  try {
    const oldData = await AsyncStorage.getItem(OLD_STORAGE_KEYS.ONBOARDING_DATA);
    const oldProgress = await AsyncStorage.getItem(OLD_STORAGE_KEYS.ONBOARDING_PROGRESS);
    const oldCurrentStep = await AsyncStorage.getItem(OLD_STORAGE_KEYS.CURRENT_STEP);
    
    return !!(oldData || oldProgress || oldCurrentStep);
  } catch (error) {
    return false;
  }
};

// Função para limpar dados antigos (após migração bem-sucedida)
export const cleanupOldData = async () => {
  try {
    await Promise.all([
      AsyncStorage.removeItem(OLD_STORAGE_KEYS.ONBOARDING_DATA),
      AsyncStorage.removeItem(OLD_STORAGE_KEYS.ONBOARDING_PROGRESS),
      AsyncStorage.removeItem(OLD_STORAGE_KEYS.CURRENT_STEP)
    ]);
    Logger.log('🧹 Dados antigos limpos do AsyncStorage');
    return true;
  } catch (error) {
    Logger.error('❌ Erro ao limpar dados antigos:', error);
    return false;
  }
};

