import { createReducer } from '@reduxjs/toolkit';
import {
  ONBOARDING_SET_STEP,
  ONBOARDING_SAVE_STEP_DATA,
  ONBOARDING_COMPLETE_STEP,
  ONBOARDING_RESET,
  ONBOARDING_SET_PROGRESS,
  ONBOARDING_LOAD_FROM_STORAGE
} from '../actions/onboardingActions';

// Estado inicial
const initialState = {
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

// Reducer
const onboardingReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(ONBOARDING_SET_STEP, (state, action) => {
      state.currentStep = action.payload.step;
    })
    .addCase(ONBOARDING_SAVE_STEP_DATA, (state, action) => {
      const { step, data } = action.payload;
      state.stepData[step] = {
        ...state.stepData[step],
        ...data,
        timestamp: new Date().toISOString()
      };
    })
    .addCase(ONBOARDING_COMPLETE_STEP, (state, action) => {
      const step = action.payload.step;
      if (!state.completedSteps.includes(step)) {
        state.completedSteps.push(step);
      }
      
      // Atualizar progresso
      switch (step) {
        case 'phone_validation':
          state.progress.phone_validation = true;
          break;
        case 'profile_selection':
          state.progress.profile_selection = true;
          break;
        case 'profile_data':
          state.progress.profile_data = true;
          break;
        case 'document_data':
          state.progress.document_data = true;
          break;
        case 'credentials':
          state.progress.credentials = true;
          break;
      }
    })
    .addCase(ONBOARDING_RESET, (state) => {
      return initialState;
    })
    .addCase(ONBOARDING_SET_PROGRESS, (state, action) => {
      state.progress = {
        ...state.progress,
        ...action.payload.progress
      };
    })
    .addCase(ONBOARDING_LOAD_FROM_STORAGE, (state, action) => {
      const { data } = action.payload;
      if (data) {
        state.currentStep = data.currentStep || 0;
        state.completedSteps = data.completedSteps || [];
        state.stepData = data.stepData || {};
        state.progress = data.progress || initialState.progress;
        state.isLoaded = true;
      }
    });
});

export default onboardingReducer;



