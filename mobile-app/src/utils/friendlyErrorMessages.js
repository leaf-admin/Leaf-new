import Logger from './Logger';

const DEFAULT_FALLBACK = 'Nao foi possivel concluir agora. Tente novamente em instantes.';

const FRIENDLY_BY_CODE = {
  ECONNABORTED: 'A conexao demorou mais que o esperado. Tente novamente.',
  NETWORK_ERROR: 'Sem conexao com a internet. Verifique sua rede e tente novamente.',
  'AUTH/NETWORK-REQUEST-FAILED': 'Sem conexao com a internet. Verifique sua rede e tente novamente.',
  BOOKING_TIMEOUT: 'Estamos com alta demanda no momento. Tente solicitar a viagem novamente.',
  RATE_LIMIT_EXCEEDED: 'Voce fez muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.',
  'AUTH/TOO-MANY-REQUESTS': 'Voce fez muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.',
  '17010': 'Voce fez muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.',
  NO_DRIVERS_AVAILABLE: 'Nao encontramos motoristas disponiveis agora. Tente novamente em instantes.',
  OUT_OF_COVERAGE: 'A Leaf ainda nao esta disponivel nessa regiao.',
  GEOFENCE_OUT_OF_COVERAGE: 'A Leaf ainda nao esta disponivel nessa regiao.',
  PAYMENT_REQUIRED: 'Para continuar, confirme o pagamento via Pix.',
  PAYMENT_NOT_CONFIRMED: 'Ainda nao confirmamos seu pagamento. Assim que confirmar, seguimos com a viagem.',
  INVALID_OTP: 'Codigo invalido. Confira o SMS e tente novamente.',
  'AUTH/INVALID-VERIFICATION-CODE': 'Codigo invalido. Confira o SMS e tente novamente.',
  'AUTH/INVALID-PHONE-NUMBER': 'Numero de telefone invalido. Verifique se o numero esta correto e tente novamente.',
  'AUTH/QUOTA-EXCEEDED': 'Limite de SMS atingido. Tente novamente mais tarde.',
  UNAUTHORIZED: 'Sua sessao expirou. Entre novamente para continuar.',
  TOKEN_EXPIRED: 'Sua sessao expirou. Entre novamente para continuar.',
  FORBIDDEN: 'Voce nao tem permissao para esta acao.',
  PERMISSION_DENIED: 'Voce nao tem permissao para concluir essa acao.',
  VALIDATION_ERROR: 'Alguns dados estao incompletos ou invalidos. Revise e tente novamente.',
  INVALID_INPUT: 'Alguns dados estao invalidos. Revise e tente novamente.',
  SERVICE_UNAVAILABLE: 'Servico temporariamente indisponivel. Tente novamente em alguns minutos.',
  INTERNAL_SERVER_ERROR: 'Estamos com instabilidade no servidor. Tente novamente em instantes.'
};

const CONTEXT_FALLBACKS = {
  websocket: 'Conexao com o servidor instavel. Tente novamente.',
  api: 'Nao foi possivel processar sua solicitacao agora.',
  auth: 'Nao foi possivel concluir a autenticacao agora.',
  payment: 'Nao foi possivel processar o pagamento agora.',
  booking: 'Nao foi possivel solicitar a viagem agora.',
  trip: 'Nao foi possivel concluir esta etapa da viagem.',
  document_upload: 'Nao foi possivel processar o documento enviado. Tente novamente.'
};

const PATTERN_RULES = [
  [/network request failed|failed to fetch|network error|internet|conexao|connection/i, FRIENDLY_BY_CODE.NETWORK_ERROR],
  [/timeout|timed out|tempo limite/i, FRIENDLY_BY_CODE.ECONNABORTED],
  [/socket|websocket|not connected|nao conectado|desconectado/i, 'Estamos com instabilidade de conexao. Tente novamente em instantes.'],
  [/failed|falha|erro interno|exception|unhandled/i, 'Nao foi possivel concluir esta acao agora. Tente novamente.'],
  [/booking_timeout|create booking timeout/i, FRIENDLY_BY_CODE.BOOKING_TIMEOUT],
  [/no[_\s-]?drivers|nenhum motorista disponivel/i, FRIENDLY_BY_CODE.NO_DRIVERS_AVAILABLE],
  [/rate[_\s-]?limit|muitas tentativas|too many requests/i, FRIENDLY_BY_CODE.RATE_LIMIT_EXCEEDED],
  [/geofence|fora da area|nao opera nesta regiao|out of coverage/i, FRIENDLY_BY_CODE.OUT_OF_COVERAGE],
  [/payment not confirmed|pagamento nao confirmado/i, FRIENDLY_BY_CODE.PAYMENT_NOT_CONFIRMED],
  [/pix|payment|pagamento/i, 'Nao foi possivel processar o pagamento via Pix. Tente novamente.'],
  [/otp|codigo invalido|invalid code|verification code/i, FRIENDLY_BY_CODE.INVALID_OTP],
  [/unauthorized|token expired|sessao expirada|401/i, FRIENDLY_BY_CODE.UNAUTHORIZED],
  [/forbidden|403|permission denied|sem permissao/i, FRIENDLY_BY_CODE.PERMISSION_DENIED],
  [/pdf invalido|invalid pdf|multipart|unsupported media/i, 'Envie um arquivo PDF valido para continuar.'],
  [/cnh sem ear/i, 'Sua CNH precisa ter EAR (Exerce Atividade Remunerada).'],
  [/cnh vencida/i, 'Sua CNH esta vencida. Envie uma CNH-e valida.'],
  [/crlv invalido/i, 'CRLV invalido. Envie o CRLV digital em PDF.'],
  [/licenciamento pendente/i, 'O licenciamento do veiculo esta pendente.'],
  [/vehicle year not allowed|ano do veiculo nao permitido/i, 'Aceitamos veiculos com no maximo 10 anos de fabricacao.']
];

const TECHNICAL_HINTS_REGEX =
  /axios|websocket|socket|stack|trace|exception|promise|undefined|null|json|payload|abort|econn|http\s*\d{3}|status\s*\d{3}|failed|falha/i;

function asString(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function extractStatus(error) {
  return (
    error?.status ||
    error?.response?.status ||
    error?.payload?.status ||
    null
  );
}

function extractCode(error) {
  return asString(
    error?.code ||
      error?.nativeErrorCode ||
      error?.userInfo?.code ||
      error?.userInfo?.nativeErrorCode ||
      error?.response?.data?.code ||
      error?.response?.data?.error?.code ||
      error?.payload?.code ||
      error?.data?.code ||
      ''
  ).toUpperCase();
}

function extractRawMessage(errorOrMessage) {
  if (typeof errorOrMessage === 'string') return asString(errorOrMessage);
  if (!errorOrMessage) return '';
  return asString(
    errorOrMessage?.friendlyMessage ||
      errorOrMessage?.message ||
      errorOrMessage?.response?.data?.message ||
      errorOrMessage?.response?.data?.error ||
      errorOrMessage?.payload?.message ||
      errorOrMessage?.payload?.error ||
      errorOrMessage?.error ||
      ''
  );
}

function resolveByCode(code, status) {
  if (code && FRIENDLY_BY_CODE[code]) {
    return FRIENDLY_BY_CODE[code];
  }

  if (status === 401) return FRIENDLY_BY_CODE.UNAUTHORIZED;
  if (status === 403) return FRIENDLY_BY_CODE.FORBIDDEN;
  if (status === 429) return FRIENDLY_BY_CODE.RATE_LIMIT_EXCEEDED;
  if (status === 503) return FRIENDLY_BY_CODE.SERVICE_UNAVAILABLE;
  if (status >= 500) return FRIENDLY_BY_CODE.INTERNAL_SERVER_ERROR;

  return '';
}

function resolveByPattern(rawMessage) {
  if (!rawMessage) return '';
  const found = PATTERN_RULES.find(([pattern]) => pattern.test(rawMessage));
  return found ? found[1] : '';
}

function resolveContextFallback(context, fallbackMessage) {
  const normalizedContext = asString(context).toLowerCase();
  if (fallbackMessage) return fallbackMessage;
  if (normalizedContext && CONTEXT_FALLBACKS[normalizedContext]) {
    return CONTEXT_FALLBACKS[normalizedContext];
  }
  return DEFAULT_FALLBACK;
}

export function toUserFriendlyMessage(errorOrMessage, options = {}) {
  const { context = '', fallbackMessage = '' } = options;
  const rawMessage = extractRawMessage(errorOrMessage);
  const status = extractStatus(errorOrMessage);
  const code = extractCode(errorOrMessage);

  const byCode = resolveByCode(code, status);
  if (byCode) return byCode;

  const byPattern = resolveByPattern(rawMessage);
  if (byPattern) return byPattern;

  // Se a mensagem ja for amigavel e curta, mantem.
  if (
    rawMessage &&
    rawMessage.length < 180 &&
    !/[{}[\]<>]/.test(rawMessage) &&
    !TECHNICAL_HINTS_REGEX.test(rawMessage)
  ) {
    return rawMessage;
  }

  return resolveContextFallback(context, fallbackMessage);
}

export function toUserFriendlyError(errorOrMessage, options = {}) {
  const friendlyMessage = toUserFriendlyMessage(errorOrMessage, options);
  const rawMessage = extractRawMessage(errorOrMessage);
  const status = extractStatus(errorOrMessage);
  const code = extractCode(errorOrMessage);

  const normalized = new Error(friendlyMessage);
  normalized.name = 'UserFriendlyError';
  normalized.friendlyMessage = friendlyMessage;
  normalized.rawMessage = rawMessage || friendlyMessage;
  if (status) normalized.status = status;
  if (code) normalized.code = code;
  normalized.originalError = errorOrMessage;
  return normalized;
}

export function sanitizeAlertMessage(message, options = {}) {
  return toUserFriendlyMessage(message, options);
}

export function logFriendlyError(scope, errorOrMessage, options = {}) {
  const friendly = toUserFriendlyMessage(errorOrMessage, options);
  const raw = extractRawMessage(errorOrMessage);
  Logger.error(`❌ [${scope}]`, {
    friendly,
    raw,
    code: extractCode(errorOrMessage),
    status: extractStatus(errorOrMessage)
  });
}
