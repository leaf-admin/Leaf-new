import Logger from '../../utils/Logger';
/**
 * LanguageProvider - Provider React para sistema de i18n
 * 
 * Context Provider que gerencia estado de idioma e fornece
 * funções de tradução para componentes React.
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import languageManager from '../../locales';


const LanguageContext = createContext();

export const LanguageProvider = ({ children }) => {
  const [currentLang, setCurrentLang] = useState('en');
  const [isLoading, setIsLoading] = useState(true);
  const [supportedLanguages, setSupportedLanguages] = useState([]);

  useEffect(() => {
    // Inicializar sistema de idiomas
    const initLanguage = async () => {
      try {
        const detectedLang = await languageManager.init();
        setCurrentLang(detectedLang);
        setSupportedLanguages(languageManager.getSupportedLanguages());
        setIsLoading(false);
        
        Logger.log(`🌍 Idioma inicializado: ${detectedLang}`);
      } catch (error) {
        Logger.error('Erro ao inicializar sistema de idiomas:', error);
        setIsLoading(false);
      }
    };

    initLanguage();

    // Adicionar listener para mudanças de idioma
    const handleLanguageChange = (newLang) => {
      setCurrentLang(newLang);
    };

    languageManager.addLanguageChangeListener(handleLanguageChange);

    // Cleanup
    return () => {
      languageManager.removeLanguageChangeListener(handleLanguageChange);
    };
  }, []);

  /**
   * Mudar idioma (memoizado)
   */
  const changeLanguage = useCallback((lang) => {
    try {
      languageManager.setLanguage(lang);
      Logger.log(`🌍 Idioma alterado para: ${lang}`);
    } catch (error) {
      Logger.error('Erro ao alterar idioma:', error);
    }
  }, []);

  /**
   * Função de tradução (memoizada)
   */
  const t = useCallback((key, params = {}) => {
    try {
      return languageManager.t(key, params);
    } catch (error) {
      Logger.error(`Erro ao traduzir chave "${key}":`, error);
      return key;
    }
  }, []);

  /**
   * Formatar moeda (memoizado)
   */
  const formatCurrency = useCallback((amount, currency = 'USD') => {
    try {
      return languageManager.formatCurrency(amount, currency);
    } catch (error) {
      Logger.error('Erro ao formatar moeda:', error);
      return `$${amount.toFixed(2)}`;
    }
  }, []);

  /**
   * Formatar tempo (memoizado)
   */
  const formatTime = useCallback((count, unit) => {
    try {
      return languageManager.formatTime(count, unit);
    } catch (error) {
      Logger.error('Erro ao formatar tempo:', error);
      return `${count} ${unit}`;
    }
  }, []);

  /**
   * Obter informações de debug (memoizado)
   */
  const getDebugInfo = useCallback(() => {
    return languageManager.getDebugInfo();
  }, []);

  // ✅ Otimização: Memoizar contextValue para evitar re-renders desnecessários
  const contextValue = useMemo(() => ({
    // Estado
    currentLang,
    supportedLanguages,
    isLoading,
    
    // Funções
    changeLanguage,
    t,
    formatCurrency,
    formatTime,
    getDebugInfo
  }), [currentLang, supportedLanguages, isLoading, changeLanguage, t, formatCurrency, formatTime, getDebugInfo]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1A330E" />
        <Text style={styles.loadingText}>
          🌍 Loading translations...
        </Text>
      </View>
    );
  }

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
    </LanguageContext.Provider>
  );
};

/**
 * Hook para usar traduções
 */
export const useTranslation = () => {
  const context = useContext(LanguageContext);
  
  if (!context) {
    throw new Error('useTranslation must be used within LanguageProvider');
  }
  
  return context;
};

/**
 * Hook para mudança de idioma
 */
export const useLanguage = () => {
  const { currentLang, changeLanguage, supportedLanguages } = useTranslation();
  
  return {
    currentLang,
    changeLanguage,
    supportedLanguages
  };
};

/**
 * Componente de seletor de idioma
 */
export const LanguageSelector = ({ style = {} }) => {
  const { currentLang, changeLanguage, supportedLanguages } = useLanguage();

  const defaultStyle = {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #ddd',
    backgroundColor: '#fff',
    fontSize: '14px',
    cursor: 'pointer',
    ...style
  };

  return (
    <select
      value={currentLang}
      onChange={(e) => changeLanguage(e.target.value)}
      style={defaultStyle}
    >
      {supportedLanguages.map(lang => (
        <option key={lang.code} value={lang.code}>
          {lang.nativeName}
        </option>
      ))}
    </select>
  );
};

/**
 * Componente de debug para desenvolvimento
 */
export const LanguageDebug = () => {
  const { getDebugInfo } = useTranslation();
  const [showDebug, setShowDebug] = useState(false);
  const debugInfo = getDebugInfo();

  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <div style={{ position: 'fixed', bottom: '10px', right: '10px', zIndex: 9999 }}>
      <button
        onClick={() => setShowDebug(!showDebug)}
        style={{
          padding: '8px',
          borderRadius: '50%',
          border: 'none',
          backgroundColor: '#007bff',
          color: 'white',
          cursor: 'pointer',
          fontSize: '12px'
        }}
      >
        🌍
      </button>
      
      {showDebug && (
        <div style={{
          position: 'absolute',
          bottom: '50px',
          right: '0',
          backgroundColor: '#fff',
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '12px',
          fontSize: '12px',
          maxWidth: '300px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Language Debug</h4>
          <pre style={{ margin: 0, fontSize: '10px' }}>
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
          <button
            onClick={() => setShowDebug(false)}
            style={{
              marginTop: '8px',
              padding: '4px 8px',
              fontSize: '10px',
              border: 'none',
              backgroundColor: '#f8f9fa',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

// ✅ Otimização: StyleSheet para estilos de loading
const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff'
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666'
  }
});

export default LanguageProvider;
