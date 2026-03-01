/**
 * Logger utilitário para produção
 * Remove logs em produção, mantém apenas em desenvolvimento
 */

class Logger {
  /**
   * Log de informação (apenas em desenvolvimento)
   */
  static log(...args) {
    if (__DEV__) {
      console.log(...args);
    }
  }

  /**
   * Log de aviso (apenas em desenvolvimento)
   */
  static warn(...args) {
    if (__DEV__) {
      console.warn(...args);
    }
  }

  /**
   * Log de erro
   * Em desenvolvimento: mostra no console
   * Em produção: pode enviar para serviço de monitoramento (sem dados sensíveis)
   */
  static error(...args) {
    if (__DEV__) {
      console.error(...args);
    } else {
      // Em produção: apenas logar erros críticos tratados
      // Não expor dados do usuário
      // Pode integrar com serviço de monitoramento (Sentry, etc)
      const errorMessage = args[0]?.message || args[0] || 'Erro desconhecido';
      // Apenas logar se for erro crítico tratado
      if (errorMessage.includes('CRITICAL') || errorMessage.includes('FATAL')) {
        // Enviar para monitoramento sem dados sensíveis
        // Exemplo: Sentry.captureException(new Error(errorMessage))
      }
    }
  }

  /**
   * Log de debug (apenas em desenvolvimento)
   */
  static debug(...args) {
    if (__DEV__) {
      console.debug(...args);
    }
  }

  /**
   * Log de informação (sempre, mas sem dados sensíveis)
   * Use apenas para logs críticos que precisam aparecer em produção
   */
  static info(...args) {
    if (__DEV__) {
      console.log('[INFO]', ...args);
    }
    // Em produção: pode enviar para analytics sem dados sensíveis
  }
}

export default Logger;


