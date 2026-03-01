import Logger from '../utils/Logger';
// ProfileToggleService.js - Serviço para toggle entre passageiro e motorista
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../common-local';

class ProfileToggleService {
  constructor() {
    this.currentMode = 'passenger'; // 'passenger' | 'driver'
    this.cacheTTL = {
      passenger: 5 * 60 * 1000, // 5 minutos
      driver: 2 * 60 * 1000,    // 2 minutos (mais dinâmico)
      shared: 10 * 60 * 1000    // 10 minutos
    };
  }

  // ===== GESTÃO DE MODO =====
  /**
   * Obter modo atual baseado no usertype do backend
   * ✅ CRÍTICO: Role sempre vem do backend, não permite escolha manual
   */
  async getCurrentMode(userProfile = null) {
    try {
      // ✅ SEMPRE usar usertype do backend como fonte da verdade
      if (userProfile) {
        const backendUserType = userProfile.usertype || userProfile.userType;
        if (backendUserType) {
          // Mapear usertype do backend para mode
          const mode = backendUserType === 'driver' ? 'driver' : 'passenger';
          // Salvar no AsyncStorage para cache
          await AsyncStorage.setItem('leaf_current_mode', mode);
          this.currentMode = mode;
          return mode;
        }
      }
      
      // Fallback: tentar obter do AsyncStorage (cache)
      const cachedMode = await AsyncStorage.getItem('leaf_current_mode');
      if (cachedMode) {
        return cachedMode;
      }
      
      // Fallback final: passenger
      return 'passenger';
    } catch (error) {
      Logger.error('❌ Erro ao obter modo atual:', error);
      return 'passenger';
    }
  }

  async setCurrentMode(mode) {
    try {
      await AsyncStorage.setItem('leaf_current_mode', mode);
      this.currentMode = mode;
      Logger.log(`🔄 ProfileToggle: Modo alterado para ${mode}`);
      return true;
    } catch (error) {
      Logger.error('❌ Erro ao definir modo:', error);
      return false;
    }
  }

  /**
   * Alternar modo - SEMPRE valida com backend antes
   * ✅ CRÍTICO: Não permite toggle sem validação de permissões do backend
   */
  async switchMode(userId, userProfile = null) {
    try {
      // ✅ 1. Obter modo atual do backend (fonte da verdade)
      const currentMode = await this.getCurrentMode(userProfile);
      const newMode = currentMode === 'passenger' ? 'driver' : 'passenger';
      
      Logger.log(`🔄 ProfileToggle: Tentando alternar de ${currentMode} para ${newMode}`);
      
      // ✅ 2. VALIDAR permissões com backend ANTES de alternar
      const canSwitch = await this.canSwitchToMode(userId, newMode);
      if (!canSwitch) {
        Logger.warn(`⚠️ ProfileToggle: Não tem permissão para alternar para ${newMode}`);
        return {
          success: false,
          error: `Você não tem permissão para usar o modo ${newMode === 'passenger' ? 'Passageiro' : 'Motorista'}. Verifique seu perfil no backend.`
        };
      }
      
      // ✅ 3. Atualizar modo no backend (fonte da verdade)
      const backendUpdated = await this.updateUserMode(userId, newMode);
      if (!backendUpdated) {
        Logger.warn('⚠️ ProfileToggle: Falha ao atualizar modo no backend, mas continuando...');
        // Não bloquear se backend não estiver disponível, mas logar aviso
      }
      
      // 4. Carregar dados específicos do modo
      const profileData = await this.loadProfileData(userId, newMode);
      
      // 5. Salvar modo atual (cache local)
      await this.setCurrentMode(newMode);
      
      // 6. Limpar cache do modo anterior
      await this.clearModeCache(currentMode);
      
      return {
        success: true,
        newMode,
        profileData,
        message: `Modo alterado para ${newMode === 'passenger' ? 'Passageiro' : 'Motorista'}`
      };
    } catch (error) {
      Logger.error('❌ Erro ao alternar modo:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ===== CARREGAMENTO DE DADOS =====
  async loadProfileData(userId, mode) {
    try {
      const cacheKey = `profile_${userId}_${mode}`;
      
      // Verificar cache primeiro
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        Logger.log(`📦 ProfileToggle: Dados de ${mode} carregados do cache`);
        return cached;
      }
      
      // Carregar do servidor
      Logger.log(`🌐 ProfileToggle: Carregando dados de ${mode} do servidor`);
      const data = await this.fetchProfileData(userId, mode);
      
      // Salvar no cache
      await this.saveToCache(cacheKey, data, this.cacheTTL[mode]);
      
      return data;
    } catch (error) {
      Logger.error(`❌ Erro ao carregar dados de ${mode}:`, error);
      return this.getDefaultProfileData(mode);
    }
  }

  async fetchProfileData(userId, mode) {
    try {
      const response = await api.get(`/user/profile/${mode}`, {
        params: { userId }
      });
      
      if (response.data.success) {
        return response.data.profile;
      } else {
        throw new Error(response.data.message || 'Erro ao carregar perfil');
      }
    } catch (error) {
      Logger.error(`❌ Erro na API para ${mode}:`, error);
      throw error;
    }
  }

  getDefaultProfileData(mode) {
    if (mode === 'passenger') {
      return {
        preferences: {
          paymentMethod: 'pix',
          favoriteRoutes: [],
          rating: 0
        },
        tripHistory: [],
        savedAddresses: []
      };
    } else {
      return {
        vehicle: {
          model: '',
          plate: '',
          year: '',
          color: ''
        },
        documents: {
          cnh: '',
          crlv: '',
          verified: false
        },
        status: 'offline',
        currentLocation: null,
        earnings: {
          total: 0,
          thisMonth: 0,
          thisWeek: 0
        },
        rating: 0,
        tripsCompleted: 0
      };
    }
  }

  // ===== CACHE MANAGEMENT =====
  async getFromCache(key) {
    try {
      const cached = await AsyncStorage.getItem(key);
      if (cached) {
        const data = JSON.parse(cached);
        if (data.expiry > Date.now()) {
          return data.value;
        } else {
          await AsyncStorage.removeItem(key);
        }
      }
      return null;
    } catch (error) {
      Logger.error('❌ Erro ao ler cache:', error);
      return null;
    }
  }

  async saveToCache(key, value, ttl) {
    try {
      const cacheData = {
        value,
        expiry: Date.now() + ttl
      };
      await AsyncStorage.setItem(key, JSON.stringify(cacheData));
    } catch (error) {
      Logger.error('❌ Erro ao salvar cache:', error);
    }
  }

  async clearModeCache(mode) {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const modeKeys = keys.filter(key => key.includes(`profile_${mode}`));
      await AsyncStorage.multiRemove(modeKeys);
      Logger.log(`🗑️ ProfileToggle: Cache de ${mode} limpo`);
    } catch (error) {
      Logger.error('❌ Erro ao limpar cache:', error);
    }
  }

  // ===== API CALLS =====
  async updateUserMode(userId, mode) {
    try {
      const response = await api.post('/user/mode', {
        userId,
        mode
      });
      
      if (response.data.success) {
        Logger.log(`✅ ProfileToggle: Modo atualizado no servidor`);
        return true;
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      Logger.error('❌ Erro ao atualizar modo no servidor:', error);
      // Não falhar se o servidor não estiver disponível
      return false;
    }
  }

  // ===== VALIDAÇÕES =====
  async canSwitchToMode(userId, mode) {
    try {
      const response = await api.get(`/user/permissions/${userId}`);
      
      if (response.data.success) {
        const permissions = response.data.permissions;
        
        if (mode === 'driver') {
          return permissions.canBeDriver && permissions.driverVerified;
        } else {
          return permissions.canBePassenger;
        }
      }
      
      return false;
    } catch (error) {
      Logger.error('❌ Erro ao verificar permissões:', error);
      // ✅ CRÍTICO: Não permitir por padrão se não conseguir verificar
      // Isso garante que só alterna se backend confirmar
      return false;
    }
  }

  // ===== UTILIDADES =====
  getModeDisplayName(mode) {
    return mode === 'passenger' ? 'Passageiro' : 'Motorista';
  }

  getModeIcon(mode) {
    return mode === 'passenger' ? 'person' : 'directions-car';
  }

  async getCacheStats() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const profileKeys = keys.filter(key => key.startsWith('profile_'));
      
      const stats = {
        total: profileKeys.length,
        passenger: profileKeys.filter(key => key.includes('passenger')).length,
        driver: profileKeys.filter(key => key.includes('driver')).length
      };
      
      return stats;
    } catch (error) {
      Logger.error('❌ Erro ao obter estatísticas de cache:', error);
      return { total: 0, passenger: 0, driver: 0 };
    }
  }

  async clearAllCache() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const profileKeys = keys.filter(key => key.startsWith('profile_'));
      await AsyncStorage.multiRemove(profileKeys);
      Logger.log('🗑️ ProfileToggle: Todo cache limpo');
      return true;
    } catch (error) {
      Logger.error('❌ Erro ao limpar todo cache:', error);
      return false;
    }
  }
}

const profileToggleService = new ProfileToggleService();
export default profileToggleService; 