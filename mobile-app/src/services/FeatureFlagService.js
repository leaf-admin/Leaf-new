import Logger from '../utils/Logger';
/**
 * 🚩 Feature Flag Service
 * 
 * Gerencia feature flags da aplicação com suporte a:
 * - Configuração local (valores padrão)
 * - Cache em AsyncStorage
 * - Firebase Remote Config (opcional, preparado para futuro)
 * - Atualização em tempo real
 */

import AsyncStorage from '@react-native-async-storage/async-storage';


class FeatureFlagService {
  constructor() {
    this.flags = new Map();
    this.listeners = new Map();
    this.initialized = false;
    
    // 🚩 Feature Flags padrão
    this.defaultFlags = {
      // KYC (Know Your Customer)
      KYC_ENABLED: true,
      
      // Adicione outras feature flags aqui conforme necessário
      // EXEMPLO:
      // NEW_PAYMENT_METHOD: false,
      // ADVANCED_TRACKING: true,
      // BETA_FEATURES: false,
    };
    
    // Chave para AsyncStorage
    this.STORAGE_KEY = '@feature_flags';
  }

  /**
   * Inicializa o serviço de feature flags
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Carregar flags do AsyncStorage
      const storedFlags = await AsyncStorage.getItem(this.STORAGE_KEY);
      
      if (storedFlags) {
        const parsedFlags = JSON.parse(storedFlags);
        this.flags = new Map(Object.entries(parsedFlags));
        Logger.log('✅ [FeatureFlags] Flags carregadas do cache:', Array.from(this.flags.entries()));
      } else {
        // Usar flags padrão
        this.flags = new Map(Object.entries(this.defaultFlags));
        await this.saveFlags();
        Logger.log('✅ [FeatureFlags] Usando flags padrão');
      }

      // TODO: Integrar com Firebase Remote Config no futuro
      // await this.fetchRemoteFlags();

      this.initialized = true;
      Logger.log('✅ [FeatureFlags] Serviço inicializado');
    } catch (error) {
      Logger.error('❌ [FeatureFlags] Erro ao inicializar:', error);
      // Em caso de erro, usar flags padrão
      this.flags = new Map(Object.entries(this.defaultFlags));
      this.initialized = true;
    }
  }

  /**
   * Salva flags no AsyncStorage
   */
  async saveFlags() {
    try {
      const flagsObject = Object.fromEntries(this.flags);
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(flagsObject));
    } catch (error) {
      Logger.error('❌ [FeatureFlags] Erro ao salvar flags:', error);
    }
  }

  /**
   * Obtém o valor de uma feature flag
   * @param {string} flagName - Nome da feature flag
   * @param {boolean} defaultValue - Valor padrão se a flag não existir
   * @returns {boolean} Valor da flag
   */
  async getFlag(flagName, defaultValue = false) {
    // Garantir que o serviço está inicializado
    if (!this.initialized) {
      await this.initialize();
    }

    // Verificar se a flag existe
    if (this.flags.has(flagName)) {
      return this.flags.get(flagName);
    }

    // Se não existir, usar valor padrão e salvar
    this.flags.set(flagName, defaultValue);
    await this.saveFlags();
    
    Logger.log(`⚠️ [FeatureFlags] Flag "${flagName}" não encontrada, usando valor padrão: ${defaultValue}`);
    return defaultValue;
  }

  /**
   * Define o valor de uma feature flag
   * @param {string} flagName - Nome da feature flag
   * @param {boolean} value - Novo valor da flag
   */
  async setFlag(flagName, value) {
    if (!this.initialized) {
      await this.initialize();
    }

    const oldValue = this.flags.get(flagName);
    this.flags.set(flagName, value);
    await this.saveFlags();

    // Notificar listeners
    this.notifyListeners(flagName, value, oldValue);

    Logger.log(`✅ [FeatureFlags] Flag "${flagName}" atualizada: ${oldValue} → ${value}`);
  }

  /**
   * Obtém todas as flags
   * @returns {Object} Objeto com todas as flags
   */
  async getAllFlags() {
    if (!this.initialized) {
      await this.initialize();
    }

    return Object.fromEntries(this.flags);
  }

  /**
   * Reseta todas as flags para os valores padrão
   */
  async resetFlags() {
    this.flags = new Map(Object.entries(this.defaultFlags));
    await this.saveFlags();
    Logger.log('✅ [FeatureFlags] Flags resetadas para valores padrão');
  }

  /**
   * Adiciona um listener para mudanças em uma flag específica
   * @param {string} flagName - Nome da flag
   * @param {Function} callback - Função a ser chamada quando a flag mudar
   * @returns {Function} Função para remover o listener
   */
  addListener(flagName, callback) {
    if (!this.listeners.has(flagName)) {
      this.listeners.set(flagName, []);
    }

    this.listeners.get(flagName).push(callback);

    // Retornar função para remover o listener
    return () => {
      const callbacks = this.listeners.get(flagName);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  /**
   * Notifica listeners sobre mudança em uma flag
   * @param {string} flagName - Nome da flag
   * @param {boolean} newValue - Novo valor
   * @param {boolean} oldValue - Valor antigo
   */
  notifyListeners(flagName, newValue, oldValue) {
    const callbacks = this.listeners.get(flagName);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(newValue, oldValue);
        } catch (error) {
          Logger.error(`❌ [FeatureFlags] Erro ao executar listener para "${flagName}":`, error);
        }
      });
    }
  }

  /**
   * TODO: Integrar com Firebase Remote Config no futuro
   * Busca flags do Firebase Remote Config
   */
  async fetchRemoteFlags() {
    try {
      // TODO: Implementar quando necessário
      // const remoteConfig = require('@react-native-firebase/remote-config').default();
      // await remoteConfig().fetchAndActivate();
      // const flags = remoteConfig().getAll();
      
      Logger.log('ℹ️ [FeatureFlags] Remote Config não implementado ainda');
    } catch (error) {
      Logger.error('❌ [FeatureFlags] Erro ao buscar flags remotas:', error);
    }
  }

  /**
   * Sincroniza flags com servidor (opcional)
   */
  async syncFlags() {
    try {
      // TODO: Implementar sincronização com backend se necessário
      Logger.log('ℹ️ [FeatureFlags] Sincronização com servidor não implementada ainda');
    } catch (error) {
      Logger.error('❌ [FeatureFlags] Erro ao sincronizar flags:', error);
    }
  }
}

// Exportar instância singleton
const featureFlagService = new FeatureFlagService();

export default featureFlagService;

