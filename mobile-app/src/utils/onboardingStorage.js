import Logger from './Logger';
import AsyncStorage from '@react-native-async-storage/async-storage';


const STORAGE_KEYS = {
  ONBOARDING_DATA: '@onboarding_data',
  ONBOARDING_PROGRESS: '@onboarding_progress',
  CURRENT_STEP: '@onboarding_current_step'
};

// Salvar dados de um step
export const saveStepData = async (step, data) => {
  try {
    const currentData = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_DATA);
    const parsedData = currentData ? JSON.parse(currentData) : {};
    
    const updatedData = {
      ...parsedData,
      [step]: {
        ...parsedData[step],
        ...data,
        timestamp: new Date().toISOString()
      }
    };
    
    await AsyncStorage.setItem(STORAGE_KEYS.ONBOARDING_DATA, JSON.stringify(updatedData));
    Logger.log(`✅ Dados do step ${step} salvos:`, data);
    return true;
  } catch (error) {
    Logger.error(`❌ Erro ao salvar step ${step}:`, error);
    return false;
  }
};

// Marcar step como completo
export const completeStep = async (step) => {
  try {
    const currentProgress = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_PROGRESS);
    const parsedProgress = currentProgress ? JSON.parse(currentProgress) : {};
    
    const updatedProgress = {
      ...parsedProgress,
      [step]: true
    };
    
    await AsyncStorage.setItem(STORAGE_KEYS.ONBOARDING_PROGRESS, JSON.stringify(updatedProgress));
    Logger.log(`✅ Step ${step} marcado como completo`);
    return true;
  } catch (error) {
    Logger.error(`❌ Erro ao completar step ${step}:`, error);
    return false;
  }
};

// Salvar step atual
export const saveCurrentStep = async (step) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.CURRENT_STEP, step.toString());
    return true;
  } catch (error) {
    Logger.error('❌ Erro ao salvar step atual:', error);
    return false;
  }
};

// Carregar dados de um step
export const loadStepData = async (step) => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_DATA);
    if (data) {
      const parsedData = JSON.parse(data);
      return parsedData[step] || {};
    }
    return {};
  } catch (error) {
    Logger.error(`❌ Erro ao carregar step ${step}:`, error);
    return {};
  }
};

// Carregar progresso
export const loadProgress = async () => {
  try {
    const progress = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_PROGRESS);
    return progress ? JSON.parse(progress) : {};
  } catch (error) {
    Logger.error('❌ Erro ao carregar progresso:', error);
    return {};
  }
};

// Carregar step atual
export const loadCurrentStep = async () => {
  try {
    const step = await AsyncStorage.getItem(STORAGE_KEYS.CURRENT_STEP);
    return step ? parseInt(step) : 0;
  } catch (error) {
    Logger.error('❌ Erro ao carregar step atual:', error);
    return 0;
  }
};

// Limpar todos os dados
export const clearOnboardingData = async () => {
  try {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.ONBOARDING_DATA),
      AsyncStorage.removeItem(STORAGE_KEYS.ONBOARDING_PROGRESS),
      AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_STEP)
    ]);
    Logger.log('✅ Dados do onboarding limpos');
    return true;
  } catch (error) {
    Logger.error('❌ Erro ao limpar dados:', error);
    return false;
  }
};

// Verificar se step está completo
export const isStepComplete = async (step) => {
  try {
    const progress = await loadProgress();
    return progress[step] === true;
  } catch (error) {
    return false;
  }
};



