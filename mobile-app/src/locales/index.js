import Logger from '../utils/Logger';
/**
 * LanguageManager - Sistema de tradução JSON dinâmico
 * 
 * Sistema simples e eficiente para internacionalização
 * com detecção automática de idioma e fallback inteligente.
 */

// Importar traduções estáticas
import enTranslations from './en.json';
import ptTranslations from './pt.json';
import esTranslations from './es.json';
import frTranslations from './fr.json';
import deTranslations from './de.json';
import languageAnalytics from '../services/LanguageAnalytics';


class LanguageManager {
  constructor() {
    this.currentLanguage = 'en';
    this.translations = {
      en: enTranslations,
      pt: ptTranslations,
      es: esTranslations,
      fr: frTranslations,
      de: deTranslations
    };
    this.fallbackLanguage = 'en';
    this.supportedLanguages = ['en', 'pt', 'es', 'fr', 'de'];
    this.listeners = [];
  }

  /**
   * Detectar idioma do usuário automaticamente
   */
  async detectLanguage() {
    // Em React Native, usar AsyncStorage ao invés de localStorage
    try {
      // Importar AsyncStorage dinamicamente para evitar erros
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      
      // Tentar detectar do AsyncStorage primeiro
      const savedLang = await AsyncStorage.getItem('leaf_language');
      if (savedLang && this.supportedLanguages.includes(savedLang)) {
        return savedLang;
      }
    } catch (error) {
      // AsyncStorage não disponível, continuar com detecção padrão
    }

    // Detectar do dispositivo (React Native)
    try {
      const { NativeModules } = require('react-native');
      const deviceLang = NativeModules.I18nManager?.localeIdentifier || 'en';
      const detectedLang = this.supportedLanguages.find(lang => 
        deviceLang.startsWith(lang)
      );
      
      if (detectedLang) {
        return detectedLang;
      }
    } catch (error) {
      // Fallback para inglês se não conseguir detectar
    }

    return this.fallbackLanguage;
  }

  /**
   * Função de tradução principal
   */
  t(key, params = {}) {
    const translation = this.getTranslation(key);
    
    // Registrar analytics
    languageAnalytics.trackTranslationRequest(key, this.currentLanguage, !!translation);
    
    return this.replaceParams(translation, params);
  }

  /**
   * Buscar tradução com fallback automático
   */
  getTranslation(key) {
    const keys = key.split('.');
    let translation = this.translations[this.currentLanguage];

    // Navegar pela estrutura aninhada
    for (const k of keys) {
      translation = translation?.[k];
    }

    // Se não encontrou, tentar fallback
    if (!translation && this.currentLanguage !== this.fallbackLanguage) {
      translation = this.translations[this.fallbackLanguage];
      for (const k of keys) {
        translation = translation?.[k];
      }
      
      // Registrar uso de fallback
      if (translation) {
        languageAnalytics.trackFallbackUsage(key, this.currentLanguage);
      }
    }

    // Se ainda não encontrou, registrar tradução faltante
    if (!translation) {
      languageAnalytics.trackMissingTranslation(key, this.currentLanguage);
    }

    // Retornar tradução ou chave formatada
    return translation || this.formatKey(key);
  }

  /**
   * Substituir parâmetros dinâmicos na tradução
   */
  replaceParams(text, params) {
    if (typeof text !== 'string') return text;

    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return params[key] !== undefined ? params[key] : match;
    });
  }

  /**
   * Formatar chave quando tradução não encontrada
   */
  formatKey(key) {
    return key.split('.').pop().replace(/([A-Z])/g, ' $1').trim();
  }

  /**
   * Mudar idioma
   */
  setLanguage(lang) {
    if (!this.supportedLanguages.includes(lang)) {
      Logger.warn(`Idioma ${lang} não suportado`);
      return;
    }

    this.currentLanguage = lang;
    
    // Salvar no AsyncStorage (React Native)
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      AsyncStorage.setItem('leaf_language', lang).catch(() => {
        // Ignorar erro de AsyncStorage
      });
    } catch (error) {
      // AsyncStorage não disponível, continuar sem salvar
    }
    
    // Registrar uso de idioma
    languageAnalytics.trackLanguageUsage(lang);
    
    // Notificar listeners
    this.notifyListeners();
  }

  /**
   * Obter idioma atual
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  /**
   * Obter idiomas suportados
   */
  getSupportedLanguages() {
    return this.supportedLanguages.map(lang => ({
      code: lang,
      name: this.getLanguageName(lang),
      nativeName: this.getNativeLanguageName(lang)
    }));
  }

  /**
   * Obter nome do idioma em inglês
   */
  getLanguageName(lang) {
    const names = {
      en: 'English',
      pt: 'Portuguese',
      es: 'Spanish',
      fr: 'French',
      de: 'German'
    };
    return names[lang] || lang;
  }

  /**
   * Obter nome nativo do idioma
   */
  getNativeLanguageName(lang) {
    const names = {
      en: 'English',
      pt: 'Português',
      es: 'Español',
      fr: 'Français',
      de: 'Deutsch'
    };
    return names[lang] || lang;
  }

  /**
   * Adicionar listener para mudanças de idioma
   */
  addLanguageChangeListener(callback) {
    this.listeners.push(callback);
  }

  /**
   * Remover listener
   */
  removeLanguageChangeListener(callback) {
    this.listeners = this.listeners.filter(listener => listener !== callback);
  }

  /**
   * Notificar listeners sobre mudança de idioma
   */
  notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.currentLanguage);
      } catch (error) {
        Logger.error('Erro ao notificar listener de idioma:', error);
      }
    });
  }

  /**
   * Inicializar sistema de idiomas
   */
  async init() {
    const startTime = Date.now();
    const detectedLang = await this.detectLanguage();
    this.setLanguage(detectedLang);
    
    // Registrar tempo de carregamento
    const loadTime = Date.now() - startTime;
    languageAnalytics.trackLoadTime(loadTime);
    
    Logger.log(`🌍 LanguageManager inicializado com idioma: ${detectedLang} (${loadTime}ms)`);
    return this.currentLanguage;
  }

  /**
   * Obter informações de debug
   */
  getDebugInfo() {
    return {
      currentLanguage: this.currentLanguage,
      supportedLanguages: this.supportedLanguages,
      translationsLoaded: Object.keys(this.translations),
      listenersCount: this.listeners.length
    };
  }

  /**
   * Formatar moeda baseado no idioma
   */
  formatCurrency(amount, currency = 'USD') {
    const currencyConfig = this.getTranslation('currency');
    const symbol = currencyConfig?.symbol || '$';
    const format = currencyConfig?.format || '{{symbol}} {{amount}}';
    
    return format
      .replace('{{symbol}}', symbol)
      .replace('{{amount}}', amount.toFixed(2));
  }

  /**
   * Formatar tempo baseado no idioma
   */
  formatTime(count, unit) {
    const timeKey = `time.${unit}`;
    const translation = this.getTranslation(timeKey);
    
    if (translation) {
      return translation.replace('{{count}}', count);
    }
    
    return `${count} ${unit}`;
  }
}

// Instância global
const languageManager = new LanguageManager();

export default languageManager;
