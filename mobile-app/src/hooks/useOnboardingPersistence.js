import Logger from '../utils/Logger';
import { useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveOnboardingStepData as saveOnboardingData,
  completeOnboardingStep as completeOnboardingStepAction,
  resetOnboarding as resetOnboardingAction,
  loadOnboardingFromStorage,
  setOnboardingStep
} from '../../common/common-packages/src/actions/onboardingActions';

const ONBOARDING_STORAGE_KEY = '@onboarding_data';
const ONBOARDING_PROGRESS_KEY = '@onboarding_progress';

export const useOnboardingPersistence = () => {
  const dispatch = useDispatch();
  const onboarding = useSelector(state => state.onboarding) || {
    currentStep: 0,
    completedSteps: [],
    stepData: {},
    progress: {
      phone_validation: false,
      profile_selection: false,
      profile_data: false,
      document_data: false,
      credentials: false
    },
    isLoaded: false
  };

  // Carregar dados do onboarding do AsyncStorage
  const loadOnboardingData = useCallback(async () => {
    try {
      Logger.log('useOnboardingPersistence - 🔍 Carregando dados do onboarding...');
      
      const [dataString, progressString] = await Promise.all([
        AsyncStorage.getItem(ONBOARDING_STORAGE_KEY),
        AsyncStorage.getItem(ONBOARDING_PROGRESS_KEY)
      ]);

      if (dataString || progressString) {
        const data = dataString ? JSON.parse(dataString) : {};
        const progress = progressString ? JSON.parse(progressString) : {};
        
        Logger.log('useOnboardingPersistence - 📥 Dados carregados:', { data, progress });
        
        // Carregar no Redux
        dispatch(loadOnboardingFromStorage({
          stepData: data,
          progress: progress,
          completedSteps: Object.keys(progress).filter(key => progress[key] === true)
        }));
        
        return { data, progress };
      }
      
      return { data: {}, progress: {} };
    } catch (error) {
      Logger.error('useOnboardingPersistence - ❌ Erro ao carregar dados:', error);
      return { data: {}, progress: {} };
    }
  }, [dispatch]);

  // Salvar dados de um step específico
  const saveStepData = useCallback(async (step, data) => {
    try {
      Logger.log(`useOnboardingPersistence - 💾 Salvando dados do step ${step}:`, data);
      
      // Salvar no Redux
      dispatch(saveOnboardingData(step, data));
      
      // Salvar no AsyncStorage
      const currentData = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
      const parsedData = currentData ? JSON.parse(currentData) : {};
      
      const updatedData = {
        ...parsedData,
        [step]: {
          ...parsedData[step],
          ...data,
          timestamp: new Date().toISOString()
        }
      };
      
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(updatedData));
      Logger.log(`useOnboardingPersistence - ✅ Dados do step ${step} salvos com sucesso`);
      
      return { success: true };
    } catch (error) {
      Logger.error(`useOnboardingPersistence - ❌ Erro ao salvar dados do step ${step}:`, error);
      return { success: false, error };
    }
  }, [dispatch]);

  // Marcar um step como completo
  const completeStep = useCallback(async (step) => {
    try {
      Logger.log(`useOnboardingPersistence - ✅ Marcando step ${step} como completo`);
      
      // Marcar como completo no Redux
      dispatch(completeOnboardingStepAction(step));
      
      // Atualizar progresso no AsyncStorage
      const currentProgress = await AsyncStorage.getItem(ONBOARDING_PROGRESS_KEY);
      const parsedProgress = currentProgress ? JSON.parse(currentProgress) : {};
      
      const updatedProgress = {
        ...parsedProgress,
        [step]: true
      };
      
      await AsyncStorage.setItem(ONBOARDING_PROGRESS_KEY, JSON.stringify(updatedProgress));
      Logger.log(`useOnboardingPersistence - ✅ Step ${step} marcado como completo`);
      
      return { success: true };
    } catch (error) {
      Logger.error(`useOnboardingPersistence - ❌ Erro ao completar step ${step}:`, error);
      return { success: false, error };
    }
  }, [dispatch]);

  // Definir o step atual
  const setCurrentStep = useCallback((step) => {
    dispatch(setOnboardingStep(step));
  }, [dispatch]);

  // Resetar todo o onboarding
  const resetOnboarding = useCallback(async () => {
    try {
      Logger.log('useOnboardingPersistence - 🔄 Resetando onboarding...');
      
      // Resetar no Redux
      dispatch(resetOnboardingAction());
      
      // Limpar AsyncStorage
      await Promise.all([
        AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY),
        AsyncStorage.removeItem(ONBOARDING_PROGRESS_KEY)
      ]);
      
      Logger.log('useOnboardingPersistence - ✅ Onboarding resetado com sucesso');
      return { success: true };
    } catch (error) {
      Logger.error('useOnboardingPersistence - ❌ Erro ao resetar onboarding:', error);
      return { success: false, error };
    }
  }, [dispatch]);

  // Obter dados de um step específico
  const getStepData = useCallback((step) => {
    return (onboarding.stepData && onboarding.stepData[step]) || {};
  }, [onboarding.stepData]);

  // Verificar se um step está completo
  const isStepComplete = useCallback((step) => {
    return (onboarding.progress && onboarding.progress[step]) === true;
  }, [onboarding.progress]);

  // Obter o step atual
  const getCurrentStep = useCallback(() => {
    return onboarding.currentStep || 0;
  }, [onboarding.currentStep]);

  // Verificar se o onboarding foi carregado
  const isLoaded = useCallback(() => {
    return onboarding.isLoaded || false;
  }, [onboarding.isLoaded]);

  // Carregar dados automaticamente na inicialização
  useEffect(() => {
    if (!onboarding.isLoaded) {
      loadOnboardingData();
    }
  }, [loadOnboardingData, onboarding.isLoaded]);

  return {
    // Estado
    onboarding,
    
    // Ações
    loadOnboardingData,
    saveStepData,
    completeStep,
    setCurrentStep,
    resetOnboarding,
    
    // Getters
    getStepData,
    isStepComplete,
    getCurrentStep,
    isLoaded
  };
};
