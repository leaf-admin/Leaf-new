import Logger from '../utils/Logger';
// profileToggleReducer.js - Reducer para toggle de perfil
import { createSlice } from '@reduxjs/toolkit';


const initialState = {
  currentMode: 'passenger', // 'passenger' | 'driver'
  isLoading: false,
  error: null,
  profileData: {
    passenger: null,
    driver: null
  },
  permissions: {
    canBeDriver: true,
    canBePassenger: true,
    driverVerified: false,
    driverApproved: false
  },
  cacheStats: {
    total: 0,
    passenger: 0,
    driver: 0
  }
};

const profileToggleSlice = createSlice({
  name: 'profileToggle',
  initialState,
  reducers: {
    // ===== AÇÕES DE MODO =====
    setCurrentMode: (state, action) => {
      state.currentMode = action.payload;
      state.error = null;
    },
    
    setModeLoading: (state, action) => {
      state.isLoading = action.payload;
    },
    
    setModeError: (state, action) => {
      state.error = action.payload;
      state.isLoading = false;
    },
    
    // ===== AÇÕES DE DADOS DE PERFIL =====
    setProfileData: (state, action) => {
      const { mode, data } = action.payload;
      state.profileData[mode] = data;
    },
    
    updateProfileData: (state, action) => {
      const { mode, updates } = action.payload;
      if (state.profileData[mode]) {
        state.profileData[mode] = {
          ...state.profileData[mode],
          ...updates
        };
      }
    },
    
    clearProfileData: (state, action) => {
      const mode = action.payload;
      state.profileData[mode] = null;
    },
    
    // ===== AÇÕES DE PERMISSÕES =====
    setPermissions: (state, action) => {
      state.permissions = {
        ...state.permissions,
        ...action.payload
      };
    },
    
    // ===== AÇÕES DE CACHE =====
    setCacheStats: (state, action) => {
      state.cacheStats = action.payload;
    },
    
    // ===== AÇÕES DE RESET =====
    resetProfileToggle: (state) => {
      return initialState;
    },
    
    // ===== AÇÕES DE TOGGLE COMPLETO =====
    toggleModeStart: (state) => {
      state.isLoading = true;
      state.error = null;
    },
    
    toggleModeSuccess: (state, action) => {
      const { newMode, profileData } = action.payload;
      state.currentMode = newMode;
      state.profileData[newMode] = profileData;
      state.isLoading = false;
      state.error = null;
    },
    
    toggleModeFailure: (state, action) => {
      state.isLoading = false;
      state.error = action.payload;
    }
  }
});

// ===== EXPORTAR AÇÕES =====
export const {
  setCurrentMode,
  setModeLoading,
  setModeError,
  setProfileData,
  updateProfileData,
  clearProfileData,
  setPermissions,
  setCacheStats,
  resetProfileToggle,
  toggleModeStart,
  toggleModeSuccess,
  toggleModeFailure
} = profileToggleSlice.actions;

// ===== SELECTORS =====
export const selectCurrentMode = (state) => state.profileToggle.currentMode;
export const selectIsLoading = (state) => state.profileToggle.isLoading;
export const selectError = (state) => state.profileToggle.error;
export const selectProfileData = (state) => state.profileToggle.profileData;
export const selectCurrentProfileData = (state) => {
  const currentMode = state.profileToggle.currentMode;
  return state.profileToggle.profileData[currentMode];
};
export const selectPermissions = (state) => state.profileToggle.permissions;
export const selectCacheStats = (state) => state.profileToggle.cacheStats;

// ===== THUNK ACTIONS =====
export const toggleMode = (userId) => async (dispatch, getState) => {
  try {
    dispatch(toggleModeStart());
    
    // Importar serviço dinamicamente para evitar problemas de import
    const profileToggleService = require('../../src/services/ProfileToggleService').default;
    
    const result = await profileToggleService.switchMode(userId);
    
    if (result.success) {
      dispatch(toggleModeSuccess({
        newMode: result.newMode,
        profileData: result.profileData
      }));
      
      // Atualizar cache stats
      const cacheStats = await profileToggleService.getCacheStats();
      dispatch(setCacheStats(cacheStats));
      
      return result;
    } else {
      dispatch(toggleModeFailure(result.error));
      throw new Error(result.error);
    }
  } catch (error) {
    dispatch(toggleModeFailure(error.message));
    throw error;
  }
};

export const loadProfileData = (userId, mode) => async (dispatch, getState) => {
  try {
    dispatch(setModeLoading(true));
    
    const profileToggleService = require('../../src/services/ProfileToggleService').default;
    const data = await profileToggleService.loadProfileData(userId, mode);
    
    dispatch(setProfileData({ mode, data }));
    dispatch(setModeLoading(false));
    
    return data;
  } catch (error) {
    dispatch(setModeError(error.message));
    throw error;
  }
};

export const loadPermissions = (userId) => async (dispatch, getState) => {
  try {
    const profileToggleService = require('../../src/services/ProfileToggleService').default;
    const response = await profileToggleService.canSwitchToMode(userId, 'driver');
    
    // Mock permissions para teste
    const permissions = {
      canBeDriver: true,
      canBePassenger: true,
      driverVerified: response,
      driverApproved: response
    };
    
    dispatch(setPermissions(permissions));
    return permissions;
  } catch (error) {
    Logger.error('❌ Erro ao carregar permissões:', error);
    return null;
  }
};

export const updateCacheStats = () => async (dispatch, getState) => {
  try {
    const profileToggleService = require('../../src/services/ProfileToggleService').default;
    const stats = await profileToggleService.getCacheStats();
    dispatch(setCacheStats(stats));
    return stats;
  } catch (error) {
    Logger.error('❌ Erro ao atualizar cache stats:', error);
    return null;
  }
};

export default profileToggleSlice.reducer; 