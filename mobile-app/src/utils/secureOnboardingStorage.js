import Logger from './Logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';


const STORAGE_KEYS = {
  // Dados criptografados
  ENCRYPTED_DATA: '@onboarding_encrypted_data',
  
  // Dados não sensíveis
  PROGRESS: '@onboarding_progress',
  CURRENT_STEP: '@onboarding_current_step'
};

// Chave de criptografia (em produção, deve vir de um serviço seguro)
const ENCRYPTION_KEY = 'leaf-onboarding-secure-key-2024';

// Estrutura para dados sensíveis
const SENSITIVE_FIELDS = {
  PROFILE_DATA: ['firstName', 'lastName', 'dateOfBirth', 'gender'],
  DOCUMENT_DATA: ['cpf', 'email'],
  CREDENTIALS: ['password', 'confirmPassword']
};

// Função para verificar se dados estão criptografados
const isDataEncrypted = (data) => {
  if (!data || typeof data !== 'string') return false;
  
  try {
    // Tentar decodificar base64
    const decoded = atob(data);
    // Verificar se tem o formato esperado (dados|hash)
    return decoded.includes('|') && decoded.split('|').length === 2;
  } catch {
    return false;
  }
};

// Função para criptografar dados
const encryptData = async (data) => {
  try {
    const dataString = JSON.stringify(data);
    
    // Gerar hash de integridade
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      dataString + ENCRYPTION_KEY
    );
    
    // Combinar dados com hash e codificar em base64
    const combined = dataString + '|' + hash;
    
    // Verificar se btoa está disponível (React Native)
    if (typeof btoa !== 'undefined') {
      return btoa(combined);
    } else {
      // Fallback para React Native
      return Buffer.from(combined, 'utf8').toString('base64');
    }
  } catch (error) {
    Logger.error('❌ Erro ao criptografar dados:', error);
    // Fallback: retornar dados como JSON simples
    return JSON.stringify(data);
  }
};

// Função para descriptografar dados
const decryptData = async (encryptedData) => {
  try {
    // Verificar se os dados estão realmente criptografados
    if (!encryptedData || typeof encryptedData !== 'string') {
      return null;
    }

    // Tentar decodificar base64
    try {
      const decoded = atob(encryptedData);
      const parts = decoded.split('|');
      
      // Verificar se tem o formato esperado (dados|hash)
      if (parts.length !== 2) {
        Logger.log('ℹ️ Dados não estão no formato criptografado, retornando como texto simples');
        // Tentar parsear como JSON direto (dados antigos não criptografados)
        try {
          return JSON.parse(encryptedData);
        } catch {
          return null;
        }
      }
      
      const [dataString, hash] = parts;
      
      // Verificar integridade
      const expectedHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        dataString + ENCRYPTION_KEY
      );
      
      if (hash === expectedHash) {
        return JSON.parse(dataString);
      } else {
        Logger.warn('⚠️ Hash não confere, dados podem estar corrompidos');
        return null;
      }
    } catch (base64Error) {
      Logger.log('ℹ️ Erro na decodificação base64, tentando parsear como JSON simples');
      // Fallback: tentar parsear como JSON direto
      try {
        return JSON.parse(encryptedData);
      } catch (jsonError) {
        Logger.error('❌ Dados não são JSON válido nem base64 válido');
        return null;
      }
    }
  } catch (error) {
    Logger.error('❌ Erro ao descriptografar dados:', error);
    return null;
  }
};

// Salvar dados sensíveis de forma criptografada
export const saveSensitiveData = async (step, data) => {
  try {
    Logger.log(`🔒 Salvando dados sensíveis do step ${step}:`, data);
    
    // Carregar dados existentes
    const existingData = await AsyncStorage.getItem(STORAGE_KEYS.ENCRYPTED_DATA);
    let parsedData = {};
    
    // Tentar parsear dados existentes de forma segura
    if (existingData) {
      try {
        parsedData = JSON.parse(existingData);
      } catch (parseError) {
        Logger.warn(`⚠️ Dados existentes corrompidos para ${step}, criando novo:`, parseError);
        parsedData = {};
      }
    }

    // Filtrar apenas campos sensíveis
    const sensitiveData = {};
    Object.keys(data).forEach(key => {
      if (SENSITIVE_FIELDS[step] && SENSITIVE_FIELDS[step].includes(key)) {
        sensitiveData[key] = data[key];
      }
    });

    // Atualizar dados sensíveis
    const updatedData = {
      ...parsedData,
      [step]: {
        ...parsedData[step],
        ...sensitiveData,
        timestamp: new Date().toISOString()
      }
    };

    // Criptografar e salvar
    const encryptedData = await encryptData(updatedData);
    await AsyncStorage.setItem(STORAGE_KEYS.ENCRYPTED_DATA, encryptedData);
    
    Logger.log(`🔒 Dados sensíveis do step ${step} salvos com criptografia:`, sensitiveData);
    return true;
  } catch (error) {
    Logger.error(`❌ Erro ao salvar dados sensíveis do step ${step}:`, error);
    return false;
  }
};

// Carregar dados sensíveis criptografados
export const loadSensitiveData = async (step) => {
  try {
    const encryptedData = await AsyncStorage.getItem(STORAGE_KEYS.ENCRYPTED_DATA);
    if (encryptedData) {
      // Verificar se os dados estão criptografados
      if (isDataEncrypted(encryptedData)) {
        const decryptedData = await decryptData(encryptedData);
        if (decryptedData) {
          return decryptedData[step] || {};
        }
      } else {
        // Dados antigos não criptografados
        Logger.log('ℹ️ Dados antigos não criptografados encontrados, convertendo...');
        try {
          const parsedData = JSON.parse(encryptedData);
          return parsedData[step] || {};
        } catch {
          Logger.warn('⚠️ Dados antigos corrompidos, retornando vazio');
          return {};
        }
      }
    }
    return {};
  } catch (error) {
    Logger.error(`❌ Erro ao carregar dados sensíveis do step ${step}:`, error);
    return {};
  }
};

// Salvar dados não sensíveis
export const saveNonSensitiveData = async (key, value) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    Logger.error(`❌ Erro ao salvar dados não sensíveis ${key}:`, error);
    return false;
  }
};

// Carregar dados não sensíveis
export const loadNonSensitiveData = async (key) => {
  try {
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    Logger.error(`❌ Erro ao carregar dados não sensíveis ${key}:`, error);
    return null;
  }
};

// Marcar step como completo
export const completeStep = async (step) => {
  try {
    const currentProgress = await loadNonSensitiveData(STORAGE_KEYS.PROGRESS);
    const parsedProgress = currentProgress || {};

    const updatedProgress = {
      ...parsedProgress,
      [step]: true
    };

    await saveNonSensitiveData(STORAGE_KEYS.PROGRESS, updatedProgress);
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
    await saveNonSensitiveData(STORAGE_KEYS.CURRENT_STEP, step);
    return true;
  } catch (error) {
    Logger.error('❌ Erro ao salvar step atual:', error);
    return false;
  }
};

// Carregar progresso
export const loadProgress = async () => {
  try {
    const progress = await loadNonSensitiveData(STORAGE_KEYS.PROGRESS);
    return progress || {};
  } catch (error) {
    Logger.error('❌ Erro ao carregar progresso:', error);
    return {};
  }
};

// Carregar step atual
export const loadCurrentStep = async () => {
  try {
    const step = await loadNonSensitiveData(STORAGE_KEYS.CURRENT_STEP);
    return step || 0;
  } catch (error) {
    Logger.error('❌ Erro ao carregar step atual:', error);
    return null;
  }
};

// Limpar todos os dados
export const clearAllOnboardingData = async () => {
  try {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.ENCRYPTED_DATA),
      AsyncStorage.removeItem(STORAGE_KEYS.PROGRESS),
      AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_STEP)
    ]);
    Logger.log('✅ Todos os dados do onboarding limpos');
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

// Função para salvar dados mistos (sensíveis + não sensíveis)
export const saveStepData = async (step, data) => {
  try {
    Logger.log(`💾 Salvando dados do step ${step}:`, data);
    
    // Verificar se o step tem campos sensíveis
    const hasSensitiveFields = SENSITIVE_FIELDS[step] && SENSITIVE_FIELDS[step].length > 0;
    
    if (hasSensitiveFields) {
      // Salvar dados sensíveis criptografados
      await saveSensitiveData(step, data);
    }
    
    // Salvar dados não sensíveis (sempre)
    const nonSensitiveData = {};
    Object.keys(data).forEach(key => {
      if (!hasSensitiveFields || !SENSITIVE_FIELDS[step].includes(key)) {
        nonSensitiveData[key] = data[key];
      }
    });
    
    if (Object.keys(nonSensitiveData).length > 0) {
      Logger.log(`📝 Salvando dados não sensíveis do step ${step}:`, nonSensitiveData);
      await saveNonSensitiveData(`onboarding_${step}`, nonSensitiveData);
    }
    
    Logger.log(`✅ Dados do step ${step} salvos com sucesso`);
    return true;
  } catch (error) {
    Logger.error(`❌ Erro ao salvar dados do step ${step}:`, error);
    return false;
  }
};

// Função para carregar dados completos de um step
export const loadStepData = async (step) => {
  try {
    Logger.log(`📖 Carregando dados do step ${step}...`);
    
    // Carregar dados sensíveis
    const sensitiveData = await loadSensitiveData(step);
    Logger.log(`🔒 Dados sensíveis carregados para ${step}:`, sensitiveData);
    
    // Carregar dados não sensíveis
    const nonSensitiveData = await loadNonSensitiveData(`onboarding_${step}`);
    Logger.log(`📝 Dados não sensíveis carregados para ${step}:`, nonSensitiveData);
    
    // Combinar dados
    const combinedData = {
      ...nonSensitiveData,
      ...sensitiveData
    };
    
    Logger.log(`✅ Dados combinados para ${step}:`, combinedData);
    return combinedData;
  } catch (error) {
    Logger.error(`❌ Erro ao carregar dados do step ${step}:`, error);
    return {};
  }
};

