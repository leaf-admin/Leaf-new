// Wrapper para ignorar erros do Reanimated e Worklets em development client
import { useEffect } from 'react';

// Interceptar erros GLOBALMENTE antes de qualquer coisa
const originalError = console.error;
const originalWarn = console.warn;
const originalLog = console.log;

// Função para verificar se é erro de módulo nativo
const isNativeModuleError = (message) => {
  return (
    message.includes('ReanimatedError') ||
    message.includes('WorkletsError') ||
    message.includes('Native part of Reanimated doesn\'t seem to be initialized') ||
    message.includes('Native part of Worklets doesn\'t seem to be initialized') ||
    message.includes('__reanimatedLoggerConfig') ||
    message.includes('Worklets] Native part of Worklets doesn\'t seem to be initialized') ||
    message.includes('[Reanimated] Reading from `value` during component render') ||
    message.includes('Please ensure that you do not access the `value` property') ||
    message.includes('use `get` method of a shared value while React is rendering')
  );
};

// ✅ SILENCIAR COMPLETAMENTE - não logar nada
console.error = (...args) => {
  const errorMessage = args.join(' ');
  if (isNativeModuleError(errorMessage)) {
    return; // Silenciar completamente
  }
  originalError.apply(console, args);
};

console.warn = (...args) => {
  const warnMessage = args.join(' ');
  if (isNativeModuleError(warnMessage)) {
    return; // Silenciar completamente
  }
  originalWarn.apply(console, args);
};

console.log = (...args) => {
  const logMessage = args.join(' ');
  if (isNativeModuleError(logMessage)) {
    return; // Silenciar completamente
  }
  // ✅ Filtrar logs desnecessários - manter apenas conexão WebSocket e erros críticos
  const message = logMessage.toLowerCase();
  const shouldSilence = (
    message.includes('nativemodulewarning') ||
    message.includes('newmapscreen') ||
    message.includes('renderizando mapview') ||
    message.includes('driverui render') ||
    message.includes('tipo do retorno') ||
    message.includes('renderui retornou') ||
    message.includes('auth reducer') ||
    message.includes('getting database ref') ||
    message.includes('firebase config') ||
    message.includes('dynamicpricingservice') ||
    message.includes('use dynamic pricing') ||
    message.includes('carregando motoristas') ||
    message.includes('gerando clusters') ||
    message.includes('tarifa calculada') ||
    message.includes('análise de demanda') ||
    message.includes('routepolyline atualizado') ||
    message.includes('booking criado') ||
    message.includes('corrida aceita') ||
    message.includes('corrida rejeitada') ||
    message.includes('viagem iniciada') ||
    message.includes('viagem finalizada') ||
    message.includes('pagamento confirmado') ||
    message.includes('motoristas encontrados') ||
    message.includes('localização do motorista') ||
    message.includes('solicitação de corrida') ||
    message.includes('status do driver') ||
    message.includes('criando grade permanente') ||
    message.includes('renderizando clusters') ||
    message.includes('ganhos carregados') ||
    message.includes('calculando valor líquido') ||
    message.includes('detalhamento do cálculo') ||
    message.includes('enviando localização imediatamente') ||
    message.includes('região do mapa mudou') ||
    message.includes('centralizando mapa') ||
    message.includes('mapa centralizado') ||
    message.includes('tentando obter endereço') ||
    message.includes('endereço obtido') ||
    message.includes('endereço final definido') ||
    message.includes('webview heat map') ||
    message.includes('useeffect cartypes') ||
    message.includes('definindo allcartypes') ||
    message.includes('redux') ||
    message.includes('firebase database initialized') ||
    message.includes('firebase configured') ||
    message.includes('language usage tracked') ||
    message.includes('language system loaded') ||
    message.includes('idioma inicializado') ||
    message.includes('language manager inicializado') ||
    message.includes('token fcm') ||
    message.includes('fcm notification service') ||
    message.includes('handler registrado') ||
    message.includes('configurando listeners automáticos') ||
    message.includes('listeners automáticos configurados') ||
    message.includes('listener de servidor registrado') ||
    message.includes('use driver clustering') ||
    message.includes('use dynamic pricing') ||
    message.includes('recebida atualização de preços') ||
    message.includes('iniciando atualizações em tempo real') ||
    message.includes('atualizando todas as regiões') ||
    message.includes('fallback used') ||
    message.includes('estimativa de pedidos') ||
    message.includes('fator dinâmico calculado') ||
    message.includes('tarifa dinâmica calculada') ||
    message.includes('estado online salvo') ||
    message.includes('motorista ficou') ||
    message.includes('bypass:') ||
    message.includes('fetching profile image') ||
    message.includes('no profile image found') ||
    message.includes('kyc verification') ||
    message.includes('enviando autenticação') ||
    message.includes('status persistido')
  );
  
  // ✅ SEMPRE mostrar logs de WebSocket - não filtrar
  const isWebSocketLog = (
    message.includes('websocket') ||
    message.includes('conectando') ||
    message.includes('conectado') ||
    message.includes('desconectado') ||
    message.includes('reconectado') ||
    message.includes('erro ao conectar') ||
    message.includes('autenticando motorista') ||
    message.includes('motorista autenticado')
  );
  
  // ✅ Se for log de WebSocket, SEMPRE mostrar
  if (isWebSocketLog) {
    originalLog.apply(console, args);
    return;
  }
  
  if (shouldSilence) {
    return; // Silenciar logs de debug/renderização
  }
  originalLog.apply(console, args);
};

// Função para suprimir erros do Reanimated e Worklets
export const suppressReanimatedErrors = () => {
  useEffect(() => {
    // Já está configurado globalmente, não precisa fazer nada aqui
    return () => {
      // Não restaurar para não quebrar outros usos
    };
  }, []);
};

// Hook para usar em componentes que usam Reanimated/Worklets
export const useReanimatedErrorSuppression = () => {
  suppressReanimatedErrors();
};
