/**
 * Logger utilitário para produção
 * Remove logs em produção, mantém apenas em desenvolvimento
 */

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(?:authorization|api[_-]?(?:key|token)|access[_-]?token|refresh[_-]?token|fcm[_-]?token|id[_-]?token|token$|password|private[_-]?key|client[_-]?secret|credential|cookie)/i;

function sanitizeLogValue(value, key = '', seen = new WeakSet()) {
  if (SENSITIVE_KEY_PATTERN.test(String(key || '')) && !/fingerprint$/i.test(String(key || ''))) {
    return REDACTED_VALUE;
  }
  if (typeof value === 'string') {
    return value
      .replace(/(Authorization\s*:\s*)(?:Bearer\s+)?[^\s,;]+/gi, `$1${REDACTED_VALUE}`)
      .replace(/(Bearer\s+)[^\s,;]+/gi, `$1${REDACTED_VALUE}`)
      .replace(
        /((?:api[_ -]?(?:key|token)|access[_ -]?token|refresh[_ -]?token|fcm[_ -]?token|id[_ -]?token|password|private[_ -]?key|client[_ -]?secret|credential|cookie)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
        `$1${REDACTED_VALUE}`,
      );
  }
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeLogValue(item, '', seen));

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeLogValue(childValue, childKey, seen),
    ]),
  );
}

function sanitizeLogArgs(args) {
  return args.map(arg => sanitizeLogValue(arg));
}

class Logger {
  /**
   * Log de informação (apenas em desenvolvimento)
   */
  static log(...args) {
    if (__DEV__) {
      console.log(...sanitizeLogArgs(args));
    }
  }

  /**
   * Log de aviso (apenas em desenvolvimento)
   */
  static warn(...args) {
    if (__DEV__) {
      console.warn(...sanitizeLogArgs(args));
    }
  }

  /**
   * Log de erro
   * Em desenvolvimento: mostra no console
   * Em produção: pode enviar para serviço de monitoramento (sem dados sensíveis)
   */
  static error(...args) {
    if (__DEV__) {
      console.error(...sanitizeLogArgs(args));
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
      console.debug(...sanitizeLogArgs(args));
    }
  }

  /**
   * Log de informação (sempre, mas sem dados sensíveis)
   * Use apenas para logs críticos que precisam aparecer em produção
   */
  static info(...args) {
    if (__DEV__) {
      console.log('[INFO]', ...sanitizeLogArgs(args));
    }
    // Em produção: pode enviar para analytics sem dados sensíveis
  }
}

export default Logger;
