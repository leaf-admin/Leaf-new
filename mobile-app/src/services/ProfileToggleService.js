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
  async getCurrentMode() {
    try {
      const mode = await AsyncStorage.getItem('leaf_current_mode');
      return mode || 'passenger';
    } catch (error) {
      console.error('❌ Erro ao obter modo atual:', error);
      return 'passenger';
    }
  }

  async setCurrentMode(mode) {
    try {
      await AsyncStorage.setItem('leaf_current_mode', mode);
      this.currentMode = mode;
      console.log(`🔄 ProfileToggle: Modo alterado para ${mode}`);
      return true;
    } catch (error) {
      console.error('❌ Erro ao definir modo:', error);
      return false;
    }
  }

  async switchMode(userId) {
    try {
      const currentMode = await this.getCurrentMode();
      const newMode = currentMode === 'passenger' ? 'driver' : 'passenger';
      
      console.log(`🔄 ProfileToggle: Alternando de ${currentMode} para ${newMode}`);
      
      // 1. Atualizar modo no usuário base
      await this.updateUserMode(userId, newMode);
      
      // 2. Carregar dados específicos do modo
      const profileData = await this.loadProfileData(userId, newMode);
      
      // 3. Salvar modo atual
      await this.setCurrentMode(newMode);
      
      // 4. Limpar cache do modo anterior
      await this.clearModeCache(currentMode);
      
      return {
        success: true,
        newMode,
        profileData,
        message: `Modo alterado para ${newMode === 'passenger' ? 'Passageiro' : 'Motorista'}`
      };
    } catch (error) {
      console.error('❌ Erro ao alternar modo:', error);
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
        console.log(`📦 ProfileToggle: Dados de ${mode} carregados do cache`);
        return cached;
      }
      
      // Carregar do servidor
      console.log(`🌐 ProfileToggle: Carregando dados de ${mode} do servidor`);
      const data = await this.fetchProfileData(userId, mode);
      
      // Salvar no cache
      await this.saveToCache(cacheKey, data, this.cacheTTL[mode]);
      
      return data;
    } catch (error) {
      console.error(`❌ Erro ao carregar dados de ${mode}:`, error);
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
      console.error(`❌ Erro na API para ${mode}:`, error);
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
      console.error('❌ Erro ao ler cache:', error);
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
      console.error('❌ Erro ao salvar cache:', error);
    }
  }

  async clearModeCache(mode) {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const modeKeys = keys.filter(key => key.includes(`profile_${mode}`));
      await AsyncStorage.multiRemove(modeKeys);
      console.log(`🗑️ ProfileToggle: Cache de ${mode} limpo`);
    } catch (error) {
      console.error('❌ Erro ao limpar cache:', error);
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
        console.log(`✅ ProfileToggle: Modo atualizado no servidor`);
        return true;
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      console.error('❌ Erro ao atualizar modo no servidor:', error);
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
      console.error('❌ Erro ao verificar permissões:', error);
      return true; // Permitir por padrão se não conseguir verificar
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
      console.error('❌ Erro ao obter estatísticas de cache:', error);
      return { total: 0, passenger: 0, driver: 0 };
    }
  }

  async clearAllCache() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const profileKeys = keys.filter(key => key.startsWith('profile_'));
      await AsyncStorage.multiRemove(profileKeys);
      console.log('🗑️ ProfileToggle: Todo cache limpo');
      return true;
    } catch (error) {
      console.error('❌ Erro ao limpar todo cache:', error);
      return false;
    }
  }
}

const profileToggleService = new ProfileToggleService();
export default profileToggleService; 