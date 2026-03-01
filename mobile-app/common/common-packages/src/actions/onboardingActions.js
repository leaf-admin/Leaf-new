// Actions para gerenciar o estado do onboarding
import { createAction } from '@reduxjs/toolkit';

// Action types
export const ONBOARDING_SET_STEP = 'onboarding/setStep';
export const ONBOARDING_SAVE_STEP_DATA = 'onboarding/saveStepData';
export const ONBOARDING_COMPLETE_STEP = 'onboarding/completeStep';
export const ONBOARDING_RESET = 'onboarding/reset';
export const ONBOARDING_SET_PROGRESS = 'onboarding/setProgress';
export const ONBOARDING_LOAD_FROM_STORAGE = 'onboarding/loadFromStorage';

// Actions
export const setOnboardingStep = createAction(ONBOARDING_SET_STEP, (step) => ({
  payload: { step }
}));

export const saveOnboardingStepData = createAction(ONBOARDING_SAVE_STEP_DATA, (step, data) => ({
  payload: { step, data }
}));

export const completeOnboardingStep = createAction(ONBOARDING_COMPLETE_STEP, (step) => ({
  payload: { step }
}));

export const resetOnboarding = createAction(ONBOARDING_RESET);

export const setOnboardingProgress = createAction(ONBOARDING_SET_PROGRESS, (progress) => ({
  payload: { progress }
}));

export const loadOnboardingFromStorage = createAction(ONBOARDING_LOAD_FROM_STORAGE, (data) => ({
  payload: { data }
}));

// Thunk actions para persistência
export const saveOnboardingData = (step, data) => async (dispatch, getState) => {
  try {
    // Salvar no Redux
    dispatch(saveOnboardingStepData(step, data));
    
    // Salvar no AsyncStorage (será implementado no componente)
    return { success: true };
  } catch (error) {
    console.error('Erro ao salvar dados do onboarding:', error);
    return { success: false, error };
  }
};

export const completeOnboardingStepAction = (step) => async (dispatch, getState) => {
  try {
    // Marcar step como completo no Redux
    dispatch(completeOnboardingStep(step));
    
    // Salvar progresso no AsyncStorage (será implementado no componente)
    return { success: true };
  } catch (error) {
    console.error('Erro ao completar step do onboarding:', error);
    return { success: false, error };
  }
};

export const resetOnboardingAction = () => async (dispatch) => {
  try {
    dispatch(resetOnboarding());
    // Limpar AsyncStorage (será implementado no componente)
    return { success: true };
  } catch (error) {
    console.error('Erro ao resetar onboarding:', error);
    return { success: false, error };
  }
};



