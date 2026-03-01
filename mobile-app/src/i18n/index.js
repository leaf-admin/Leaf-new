/**
 * i18n Configuration - Configuração centralizada do sistema i18n
 * 
 * Arquivo de configuração para facilitar o uso do sistema
 * de internacionalização em toda a aplicação.
 */

import languageManager from '../locales';

// Configurações do sistema i18n
export const i18nConfig = {
  // Idiomas suportados
  supportedLanguages: ['en', 'pt', 'es', 'fr', 'de'],
  
  // Idioma padrão
  defaultLanguage: 'en',
  
  // Configurações de cache
  cache: {
    enabled: true,
    duration: 24 * 60 * 60 * 1000, // 24 horas
    key: 'leaf_translations'
  },
  
  // Configurações de detecção
  detection: {
    enabled: true,
    fallbackToDefault: true,
    localStorageKey: 'leaf_language'
  }
};

// Funções utilitárias para uso em componentes
export const i18nUtils = {
  /**
   * Obter tradução com fallback
   */
  t: (key, params = {}) => {
    return languageManager.t(key, params);
  },

  /**
   * Formatar moeda baseada no idioma
   */
  formatCurrency: (amount, currency = 'USD') => {
    return languageManager.formatCurrency(amount, currency);
  },

  /**
   * Formatar tempo baseado no idioma
   */
  formatTime: (count, unit) => {
    return languageManager.formatTime(count, unit);
  },

  /**
   * Obter idioma atual
   */
  getCurrentLanguage: () => {
    return languageManager.getCurrentLanguage();
  },

  /**
   * Mudar idioma
   */
  setLanguage: (lang) => {
    return languageManager.setLanguage(lang);
  },

  /**
   * Obter idiomas suportados
   */
  getSupportedLanguages: () => {
    return languageManager.getSupportedLanguages();
  }
};

// Constantes de chaves de tradução para evitar erros de digitação
export const TranslationKeys = {
  // App
  APP_NAME: 'app.name',
  APP_TAGLINE: 'app.tagline',
  APP_VERSION: 'app.version',
  
  // Auth
  AUTH_LOGIN: 'auth.login',
  AUTH_REGISTER: 'auth.register',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_EMAIL: 'auth.email',
  AUTH_PASSWORD: 'auth.password',
  AUTH_FORGOT_PASSWORD: 'auth.forgotPassword',
  
  // Ride
  RIDE_REQUEST: 'ride.request',
  RIDE_CANCEL: 'ride.cancel',
  RIDE_STATUS: 'ride.status',
  RIDE_CONFIRM: 'ride.confirm',
  RIDE_SCHEDULE: 'ride.schedule',
  RIDE_FROM: 'ride.from',
  RIDE_TO: 'ride.to',
  
  // Driver
  DRIVER_FIND: 'driver.find',
  DRIVER_ARRIVING: 'driver.arriving',
  DRIVER_CONTACT: 'driver.contact',
  DRIVER_CALL: 'driver.call',
  DRIVER_RATING: 'driver.rating',
  DRIVER_ETA: 'driver.eta',
  
  // Payment
  PAYMENT_METHOD: 'payment.method',
  PAYMENT_TOTAL: 'payment.total',
  PAYMENT_TIP: 'payment.tip',
  PAYMENT_CASH: 'payment.cash',
  PAYMENT_CARD: 'payment.card',
  
  // Navigation
  NAV_HOME: 'navigation.home',
  NAV_RIDES: 'navigation.rides',
  NAV_PROFILE: 'navigation.profile',
  NAV_SETTINGS: 'navigation.settings',
  NAV_HISTORY: 'navigation.history',
  
  // Status
  STATUS_SEARCHING: 'status.searching',
  STATUS_FOUND: 'status.found',
  STATUS_ARRIVING: 'status.arriving',
  STATUS_COMPLETED: 'status.completed',
  STATUS_CANCELLED: 'status.cancelled',
  
  // Messages
  MSG_SUCCESS: 'messages.success',
  MSG_ERROR: 'messages.error',
  MSG_LOADING: 'messages.loading',
  MSG_CONFIRM: 'messages.confirm',
  MSG_CANCEL: 'messages.cancel',
  
  // Errors
  ERR_NETWORK: 'errors.networkError',
  ERR_LOCATION: 'errors.locationError',
  ERR_PAYMENT: 'errors.paymentError',
  ERR_DRIVER_NOT_FOUND: 'errors.driverNotFound',
  
  // Time
  TIME_NOW: 'time.now',
  TIME_MINUTES: 'time.minutes',
  TIME_HOURS: 'time.hours',
  
  // Currency
  CURRENCY_SYMBOL: 'currency.symbol',
  CURRENCY_FORMAT: 'currency.format'
};

// Hook personalizado para uso fácil em componentes
export const useI18n = () => {
  return {
    t: i18nUtils.t,
    formatCurrency: i18nUtils.formatCurrency,
    formatTime: i18nUtils.formatTime,
    currentLang: i18nUtils.getCurrentLanguage(),
    setLanguage: i18nUtils.setLanguage,
    supportedLanguages: i18nUtils.getSupportedLanguages(),
    keys: TranslationKeys
  };
};

// Inicializar sistema
export const initI18n = () => {
  return languageManager.init();
};

export default {
  config: i18nConfig,
  utils: i18nUtils,
  keys: TranslationKeys,
  useI18n,
  init: initI18n
};