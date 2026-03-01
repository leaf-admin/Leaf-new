import Logger from '../utils/Logger';
/**
 * LanguageAnalytics - Sistema de monitoramento de uso de idiomas
 * 
 * Coleta métricas de uso de idiomas para análise e otimização
 * do sistema de internacionalização.
 */

class LanguageAnalytics {
  constructor() {
    this.analytics = {
      languageUsage: {},
      translationRequests: {},
      missingTranslations: {},
      userPreferences: {},
      performanceMetrics: {
        loadTime: 0,
        cacheHitRate: 0,
        fallbackUsage: 0
      }
    };
    this.isEnabled = true;
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();
  }

  /**
   * Gerar ID único para sessão
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Registrar uso de idioma
   */
  trackLanguageUsage(language) {
    if (!this.isEnabled) return;

    const key = `lang_${language}`;
    this.analytics.languageUsage[key] = (this.analytics.languageUsage[key] || 0) + 1;
    
    // Registrar timestamp
    if (!this.analytics.userPreferences[language]) {
      this.analytics.userPreferences[language] = {
        firstUsed: Date.now(),
        lastUsed: Date.now(),
        usageCount: 0
      };
    }
    
    this.analytics.userPreferences[language].lastUsed = Date.now();
    this.analytics.userPreferences[language].usageCount++;
    
    Logger.log(`📊 Language usage tracked: ${language}`);
  }

  /**
   * Registrar requisição de tradução
   */
  trackTranslationRequest(key, language, found = true) {
    if (!this.isEnabled) return;

    const requestKey = `${language}_${key}`;
    this.analytics.translationRequests[requestKey] = 
      (this.analytics.translationRequests[requestKey] || 0) + 1;

    if (!found) {
      this.trackMissingTranslation(key, language);
    }
  }

  /**
   * Registrar tradução não encontrada
   */
  trackMissingTranslation(key, language) {
    if (!this.isEnabled) return;

    const missingKey = `${language}_${key}`;
    this.analytics.missingTranslations[missingKey] = 
      (this.analytics.missingTranslations[missingKey] || 0) + 1;

    Logger.warn(`⚠️ Missing translation: ${key} for ${language}`);
  }

  /**
   * Registrar métricas de performance
   */
  trackPerformanceMetrics(metrics) {
    if (!this.isEnabled) return;

    this.analytics.performanceMetrics = {
      ...this.analytics.performanceMetrics,
      ...metrics
    };
  }

  /**
   * Registrar tempo de carregamento
   */
  trackLoadTime(loadTime) {
    if (!this.isEnabled) return;

    this.analytics.performanceMetrics.loadTime = loadTime;
    Logger.log(`⚡ Language system loaded in ${loadTime}ms`);
  }

  /**
   * Registrar taxa de cache hit
   */
  trackCacheHit(hit) {
    if (!this.isEnabled) return;

    const currentRate = this.analytics.performanceMetrics.cacheHitRate;
    const totalRequests = Object.values(this.analytics.translationRequests).reduce((a, b) => a + b, 0);
    
    if (totalRequests > 0) {
      this.analytics.performanceMetrics.cacheHitRate = 
        ((currentRate * (totalRequests - 1)) + (hit ? 1 : 0)) / totalRequests;
    }
  }

  /**
   * Registrar uso de fallback
   */
  trackFallbackUsage(key, language) {
    if (!this.isEnabled) return;

    this.analytics.performanceMetrics.fallbackUsage++;
    Logger.log(`🔄 Fallback used for: ${key} in ${language}`);
  }

  /**
   * Obter estatísticas de uso
   */
  getUsageStats() {
    const totalLanguageUsage = Object.values(this.analytics.languageUsage).reduce((a, b) => a + b, 0);
    const totalTranslationRequests = Object.values(this.analytics.translationRequests).reduce((a, b) => a + b, 0);
    const totalMissingTranslations = Object.values(this.analytics.missingTranslations).reduce((a, b) => a + b, 0);
    
    const sessionDuration = Date.now() - this.startTime;

    return {
      session: {
        id: this.sessionId,
        duration: sessionDuration,
        startTime: this.startTime
      },
      usage: {
        totalLanguageUsage,
        totalTranslationRequests,
        totalMissingTranslations,
        languageBreakdown: this.analytics.languageUsage,
        topLanguages: this.getTopLanguages(),
        missingTranslations: this.analytics.missingTranslations
      },
      performance: this.analytics.performanceMetrics,
      userPreferences: this.analytics.userPreferences
    };
  }

  /**
   * Obter idiomas mais usados
   */
  getTopLanguages(limit = 5) {
    return Object.entries(this.analytics.languageUsage)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([key, count]) => ({
        language: key.replace('lang_', ''),
        count,
        percentage: (count / Object.values(this.analytics.languageUsage).reduce((a, b) => a + b, 0)) * 100
      }));
  }

  /**
   * Obter traduções mais solicitadas
   */
  getTopTranslationRequests(limit = 10) {
    return Object.entries(this.analytics.translationRequests)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([key, count]) => {
        const [language, translationKey] = key.split('_', 2);
        return {
          language,
          key: translationKey,
          count
        };
      });
  }

  /**
   * Obter traduções mais faltantes
   */
  getTopMissingTranslations(limit = 10) {
    return Object.entries(this.analytics.missingTranslations)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([key, count]) => {
        const [language, translationKey] = key.split('_', 2);
        return {
          language,
          key: translationKey,
          count
        };
      });
  }

  /**
   * Gerar relatório de analytics
   */
  generateReport() {
    const stats = this.getUsageStats();
    
    const report = {
      summary: {
        sessionDuration: `${Math.round(stats.session.duration / 1000)}s`,
        totalRequests: stats.usage.totalTranslationRequests,
        cacheHitRate: `${Math.round(stats.performance.cacheHitRate * 100)}%`,
        fallbackUsage: stats.performance.fallbackUsage,
        missingTranslations: stats.usage.totalMissingTranslations
      },
      topLanguages: this.getTopLanguages(),
      topRequests: this.getTopTranslationRequests(),
      topMissing: this.getTopMissingTranslations(),
      recommendations: this.generateRecommendations(stats)
    };

    return report;
  }

  /**
   * Gerar recomendações baseadas nos dados
   */
  generateRecommendations(stats) {
    const recommendations = [];

    // Recomendação de idiomas populares
    const topLanguages = this.getTopLanguages(3);
    if (topLanguages.length > 0) {
      recommendations.push({
        type: 'language_priority',
        message: `Focus on optimizing ${topLanguages[0].language} translations (${topLanguages[0].percentage.toFixed(1)}% usage)`,
        priority: 'high'
      });
    }

    // Recomendação de traduções faltantes
    const topMissing = this.getTopMissingTranslations(5);
    if (topMissing.length > 0) {
      recommendations.push({
        type: 'missing_translations',
        message: `Add translations for: ${topMissing.map(m => m.key).join(', ')}`,
        priority: 'medium'
      });
    }

    // Recomendação de performance
    if (stats.performance.cacheHitRate < 0.8) {
      recommendations.push({
        type: 'performance',
        message: 'Cache hit rate is low. Consider optimizing translation loading.',
        priority: 'medium'
      });
    }

    // Recomendação de fallback
    if (stats.performance.fallbackUsage > stats.usage.totalTranslationRequests * 0.1) {
      recommendations.push({
        type: 'fallback_usage',
        message: 'High fallback usage detected. Review missing translations.',
        priority: 'high'
      });
    }

    return recommendations;
  }

  /**
   * Exportar dados para análise externa
   */
  exportData() {
    return {
      analytics: this.analytics,
      report: this.generateReport(),
      timestamp: Date.now(),
      version: '1.0.0'
    };
  }

  /**
   * Limpar dados de analytics
   */
  clearData() {
    this.analytics = {
      languageUsage: {},
      translationRequests: {},
      missingTranslations: {},
      userPreferences: {},
      performanceMetrics: {
        loadTime: 0,
        cacheHitRate: 0,
        fallbackUsage: 0
      }
    };
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();
  }

  /**
   * Habilitar/desabilitar analytics
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    Logger.log(`📊 Language analytics ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Verificar se analytics está habilitado
   */
  isAnalyticsEnabled() {
    return this.isEnabled;
  }
}

// Instância global
const languageAnalytics = new LanguageAnalytics();

export default languageAnalytics;
