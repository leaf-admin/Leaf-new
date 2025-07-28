// ErrorHandler.js - Sistema centralizado de tratamento de erros
import { Alert } from 'react-native';

// Tipos de erro
export const ERROR_TYPES = {
  NETWORK: 'NETWORK',
  AUTHENTICATION: 'AUTHENTICATION',
  VALIDATION: 'VALIDATION',
  SERVER: 'SERVER',
  UNKNOWN: 'UNKNOWN'
};

// Códigos de erro
export const ERROR_CODES = {
  // Erros de rede
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_UNREACHABLE: 'NETWORK_UNREACHABLE',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  
  // Erros de autenticação
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  
  // Erros de validação
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // Erros do servidor
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // Erros específicos do app
  LOCATION_PERMISSION_DENIED: 'LOCATION_PERMISSION_DENIED',
  CAMERA_PERMISSION_DENIED: 'CAMERA_PERMISSION_DENIED',
  STORAGE_PERMISSION_DENIED: 'STORAGE_PERMISSION_DENIED'
};

// Mensagens de erro amigáveis
const ERROR_MESSAGES = {
  [ERROR_CODES.NETWORK_TIMEOUT]: 'Conexão lenta. Verifique sua internet.',
  [ERROR_CODES.NETWORK_UNREACHABLE]: 'Sem conexão com a internet.',
  [ERROR_CODES.CONNECTION_REFUSED]: 'Servidor indisponível. Tente novamente.',
  [ERROR_CODES.UNAUTHORIZED]: 'Sessão expirada. Faça login novamente.',
  [ERROR_CODES.FORBIDDEN]: 'Acesso negado.',
  [ERROR_CODES.TOKEN_EXPIRED]: 'Token expirado. Faça login novamente.',
  [ERROR_CODES.INVALID_INPUT]: 'Dados inválidos. Verifique as informações.',
  [ERROR_CODES.MISSING_REQUIRED_FIELD]: 'Campo obrigatório não preenchido.',
  [ERROR_CODES.INTERNAL_SERVER_ERROR]: 'Erro interno do servidor.',
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 'Serviço temporariamente indisponível.',
  [ERROR_CODES.LOCATION_PERMISSION_DENIED]: 'Permissão de localização negada.',
  [ERROR_CODES.CAMERA_PERMISSION_DENIED]: 'Permissão da câmera negada.',
  [ERROR_CODES.STORAGE_PERMISSION_DENIED]: 'Permissão de armazenamento negada.',
  DEFAULT: 'Ocorreu um erro inesperado. Tente novamente.'
};

// Classe principal de tratamento de erros
class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 100;
  }

  // Analisar erro e determinar tipo
  analyzeError(error) {
    const errorInfo = {
      type: ERROR_TYPES.UNKNOWN,
      code: null,
      message: error.message || 'Erro desconhecido',
      originalError: error,
      timestamp: new Date().toISOString(),
      stack: error.stack
    };

    // Analisar por tipo de erro
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      errorInfo.type = ERROR_TYPES.NETWORK;
      errorInfo.code = ERROR_CODES.NETWORK_UNREACHABLE;
    } else if (error.message.includes('timeout')) {
      errorInfo.type = ERROR_TYPES.NETWORK;
      errorInfo.code = ERROR_CODES.NETWORK_TIMEOUT;
    } else if (error.message.includes('ECONNREFUSED')) {
      errorInfo.type = ERROR_TYPES.NETWORK;
      errorInfo.code = ERROR_CODES.CONNECTION_REFUSED;
    } else if (error.status === 401) {
      errorInfo.type = ERROR_TYPES.AUTHENTICATION;
      errorInfo.code = ERROR_CODES.UNAUTHORIZED;
    } else if (error.status === 403) {
      errorInfo.type = ERROR_TYPES.AUTHENTICATION;
      errorInfo.code = ERROR_CODES.FORBIDDEN;
    } else if (error.status === 400) {
      errorInfo.type = ERROR_TYPES.VALIDATION;
      errorInfo.code = ERROR_CODES.INVALID_INPUT;
    } else if (error.status >= 500) {
      errorInfo.type = ERROR_TYPES.SERVER;
      errorInfo.code = ERROR_CODES.INTERNAL_SERVER_ERROR;
    }

    return errorInfo;
  }

  // Obter mensagem amigável
  getFriendlyMessage(errorInfo) {
    if (errorInfo.code && ERROR_MESSAGES[errorInfo.code]) {
      return ERROR_MESSAGES[errorInfo.code];
    }
    return ERROR_MESSAGES.DEFAULT;
  }

  // Registrar erro no log
  logError(errorInfo) {
    this.errorLog.push(errorInfo);
    
    // Manter tamanho do log
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }

    // Log para desenvolvimento
    if (__DEV__) {
      console.error('🔴 ErrorHandler:', {
        type: errorInfo.type,
        code: errorInfo.code,
        message: errorInfo.message,
        timestamp: errorInfo.timestamp
      });
    }
  }

  // Tratar erro com UI
  handleError(error, showAlert = true) {
    const errorInfo = this.analyzeError(error);
    const friendlyMessage = this.getFriendlyMessage(errorInfo);
    
    this.logError(errorInfo);

    if (showAlert) {
      this.showErrorAlert(friendlyMessage, errorInfo);
    }

    return {
      errorInfo,
      friendlyMessage,
      shouldRetry: this.shouldRetry(errorInfo)
    };
  }

  // Mostrar alerta de erro
  showErrorAlert(message, errorInfo) {
    Alert.alert(
      'Erro',
      message,
      [
        {
          text: 'OK',
          onPress: () => {
            // Callback adicional se necessário
            if (errorInfo.type === ERROR_TYPES.AUTHENTICATION) {
              // Redirecionar para login
              this.handleAuthenticationError();
            }
          }
        }
      ]
    );
  }

  // Verificar se deve tentar novamente
  shouldRetry(errorInfo) {
    const retryableErrors = [
      ERROR_CODES.NETWORK_TIMEOUT,
      ERROR_CODES.NETWORK_UNREACHABLE,
      ERROR_CODES.CONNECTION_REFUSED,
      ERROR_CODES.SERVICE_UNAVAILABLE
    ];

    return retryableErrors.includes(errorInfo.code);
  }

  // Tratar erro de autenticação
  handleAuthenticationError() {
    console.log('🔐 Redirecionando para login...');
    
    try {
      // Importar navigation dinamicamente para evitar dependências circulares
      const { CommonActions } = require('@react-navigation/native');
      
      // Limpar dados de autenticação
      this.clearAuthData();
      
      // Redirecionar para tela de login
      if (global.navigationRef && global.navigationRef.current) {
        global.navigationRef.current.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              { name: 'Login' }
            ],
          })
        );
      } else {
        // Fallback: mostrar alerta e sugerir reiniciar app
        Alert.alert(
          'Sessão Expirada',
          'Sua sessão expirou. Por favor, faça login novamente.',
          [
            {
              text: 'OK',
              onPress: () => {
                // Tentar navegar para login se possível
                this.attemptLoginNavigation();
              }
            }
          ]
        );
      }
      
      console.log('✅ Redirecionamento para login concluído');
      
    } catch (error) {
      console.error('❌ Erro ao redirecionar para login:', error);
      
      // Fallback final: mostrar alerta
      Alert.alert(
        'Erro de Autenticação',
        'Ocorreu um erro de autenticação. Por favor, reinicie o aplicativo.',
        [
          {
            text: 'OK',
            onPress: () => {
              // Aqui poderia ter lógica para reiniciar o app
              console.log('🔄 Sugerindo reinicialização do app');
            }
          }
        ]
      );
    }
  }

  // Limpar dados de autenticação
  clearAuthData() {
    try {
      // Limpar dados do AsyncStorage
      const AsyncStorage = require('@react-native-async-storage/async-storage');
      
      const keysToRemove = [
        'userToken',
        'userData',
        'authState',
        'refreshToken'
      ];
      
      keysToRemove.forEach(key => {
        AsyncStorage.removeItem(key).catch(err => {
          console.log(`⚠️ Erro ao remover ${key}:`, err);
        });
      });
      
      // Limpar dados do Redux se disponível
      if (global.store) {
        global.store.dispatch({ type: 'LOGOUT' });
      }
      
      console.log('🧹 Dados de autenticação limpos');
      
    } catch (error) {
      console.error('❌ Erro ao limpar dados de auth:', error);
    }
  }

  // Tentar navegação para login
  attemptLoginNavigation() {
    try {
      // Verificar se temos acesso ao navigation
      if (global.navigationRef && global.navigationRef.current) {
        global.navigationRef.current.navigate('Login');
      } else {
        // Tentar importar e usar navigation
        const { NavigationContainer } = require('@react-navigation/native');
        console.log('📱 Tentando navegação alternativa...');
      }
    } catch (error) {
      console.error('❌ Erro na navegação alternativa:', error);
    }
  }

  // Obter estatísticas de erros
  getErrorStats() {
    const stats = {
      total: this.errorLog.length,
      byType: {},
      byCode: {},
      recent: this.errorLog.slice(-10) // Últimos 10 erros
    };

    this.errorLog.forEach(error => {
      // Contar por tipo
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
      
      // Contar por código
      if (error.code) {
        stats.byCode[error.code] = (stats.byCode[error.code] || 0) + 1;
      }
    });

    return stats;
  }

  // Limpar log de erros
  clearErrorLog() {
    this.errorLog = [];
  }

  // Exportar log para debug
  exportErrorLog() {
    return JSON.stringify(this.errorLog, null, 2);
  }
}

// Instância singleton
const errorHandler = new ErrorHandler();

// Funções utilitárias
export const handleError = (error, showAlert = true) => {
  return errorHandler.handleError(error, showAlert);
};

export const logError = (error) => {
  const errorInfo = errorHandler.analyzeError(error);
  errorHandler.logError(errorInfo);
  return errorInfo;
};

export const getErrorStats = () => {
  return errorHandler.getErrorStats();
};

export const showErrorAlert = (message) => {
  errorHandler.showErrorAlert(message);
};

export default errorHandler; 