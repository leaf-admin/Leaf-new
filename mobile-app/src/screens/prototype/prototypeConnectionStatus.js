function sanitizeText(value) {
  return String(value || '').trim();
}

function isTruthyRouteParam(value) {
  if (value === true) {
    return true;
  }

  const normalized = sanitizeText(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeBookingStatus(value) {
  return sanitizeText(value).toLowerCase();
}

function normalizeConnectionScenario(value) {
  const normalized = sanitizeText(value).toLowerCase();

  if (
    normalized === 'drop_and_recover' ||
    normalized === 'drop-and-recover' ||
    normalized === 'disconnect_once' ||
    normalized === 'disconnect-once'
  ) {
    return 'drop_and_recover';
  }

  if (
    normalized === 'disconnect_only' ||
    normalized === 'disconnect-only' ||
    normalized === 'drop_only' ||
    normalized === 'drop-only'
  ) {
    return 'disconnect_only';
  }

  return '';
}

function normalizeConnectionTriggerState(value) {
  const normalized = sanitizeText(value).toLowerCase();

  if (!normalized) {
    return 'any';
  }

  if (normalized === 'driver_online' || normalized === 'driver-online') {
    return 'driver_online';
  }

  if (normalized === 'any') {
    return 'any';
  }

  return normalizeBookingStatus(normalized);
}

function normalizeAutomationRole(value) {
  const normalized = sanitizeText(value).toLowerCase();

  if (normalized === 'driver' || normalized === 'motorista') {
    return 'driver';
  }

  if (
    normalized === 'customer' ||
    normalized === 'passenger' ||
    normalized === 'rider' ||
    normalized === 'passageiro'
  ) {
    return 'customer';
  }

  if (normalized === 'both' || normalized === 'all') {
    return 'both';
  }

  return '';
}

function toPositiveMs(value, fallbackMs) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackMs;
  }
  return parsed;
}

function shouldSurfacePrototypeConnectionIndicator({
  activeRole,
  bookingStatus,
  driverOnline,
  driverOnlinePending,
}) {
  const normalizedStatus = normalizeBookingStatus(bookingStatus);

  if (
    [
      'requesting',
      'searching',
      'accepted',
      'arrived',
      'started',
      'operational_interrupted',
      'searching_replacement',
      'searching_replacement_driver',
    ].includes(normalizedStatus)
  ) {
    return true;
  }

  return activeRole === 'driver' && (driverOnline || driverOnlinePending);
}

function buildPrototypeConnectionIndicatorModel({
  activeRole,
  bookingStatus,
  driverOnline,
  driverOnlinePending,
  connecting,
  isSocketConnected,
  isSocketAuthenticated,
  requiresAuthentication = true,
  recentlyRecovered = false,
  forceVisible = false,
}) {
  const shouldSurface = shouldSurfacePrototypeConnectionIndicator({
    activeRole,
    bookingStatus,
    driverOnline,
    driverOnlinePending,
  });

  if (!forceVisible && !shouldSurface) {
    return null;
  }

  const normalizedStatus = normalizeBookingStatus(bookingStatus);
  const rideInSearch =
    normalizedStatus === 'requesting' || normalizedStatus === 'searching';
  const rideInProgress = ['accepted', 'arrived', 'started'].includes(
    normalizedStatus,
  );
  const authPending = requiresAuthentication && !isSocketAuthenticated;

  if (connecting || (isSocketConnected && authPending)) {
    return {
      tone: 'warning',
      icon: 'sync-outline',
      title: 'Reconectando',
      message: rideInSearch
        ? 'Retomando a busca em tempo real.'
        : rideInProgress
          ? 'Sincronizando sua corrida novamente.'
          : activeRole === 'driver'
            ? 'Restabelecendo sua sessão de motorista.'
            : 'Restabelecendo sua sessão.',
    };
  }

  if (!isSocketConnected) {
    return {
      tone: 'danger',
      icon: 'cloud-offline-outline',
      title: 'Conexão perdida',
      message: rideInSearch
        ? 'Mantendo a busca aberta enquanto tentamos reconectar.'
        : rideInProgress
          ? 'Tentando recuperar as atualizações da corrida.'
          : activeRole === 'driver'
            ? 'Tentando recuperar corridas e status do motorista.'
            : 'Tentando recuperar sua sessão em tempo real.',
    };
  }

  if (recentlyRecovered) {
    return {
      tone: 'success',
      icon: 'checkmark-circle-outline',
      title: 'Conexão restabelecida',
      message: rideInSearch
        ? 'A busca voltou a sincronizar normalmente.'
        : rideInProgress
          ? 'As atualizações da corrida foram retomadas.'
          : 'Sessão em tempo real normalizada.',
    };
  }

  return null;
}

function resolvePrototypeConnectionAutomationConfig(
  routeParams = {},
  { activeRole = '', isDev = false, isE2E = false } = {},
) {
  const automationRequested =
    isTruthyRouteParam(routeParams?.e2e) ||
    isTruthyRouteParam(routeParams?.automation) ||
    isTruthyRouteParam(routeParams?.qaAutomation);

  const allowAutomationParams = (isDev || isE2E) && automationRequested;
  const scenario = allowAutomationParams
    ? normalizeConnectionScenario(
        routeParams?.qaConnectionScenario || routeParams?.connectionScenario,
      )
    : '';

  return {
    enabled: Boolean(allowAutomationParams && scenario),
    scenario,
    triggerState: allowAutomationParams
      ? normalizeConnectionTriggerState(
          routeParams?.qaConnectionTriggerState ||
            routeParams?.connectionTriggerState,
        )
      : 'any',
    role: allowAutomationParams
      ? normalizeAutomationRole(
          routeParams?.qaConnectionRole || routeParams?.connectionRole,
        ) || activeRole
      : '',
    delayMs: allowAutomationParams
      ? toPositiveMs(
          routeParams?.qaConnectionDelayMs || routeParams?.connectionDelayMs,
          600,
        )
      : 600,
    recoveryMs: allowAutomationParams
      ? toPositiveMs(
          routeParams?.qaConnectionRecoveryMs ||
            routeParams?.connectionRecoveryMs,
          5000,
        )
      : 5000,
    nonce: allowAutomationParams
      ? sanitizeText(routeParams?.qaNonce || routeParams?.nonce)
      : '',
  };
}

function shouldRunPrototypeConnectionAutomation(
  config,
  { activeRole, bookingStatus, driverOnline },
) {
  if (!config?.enabled) {
    return false;
  }

  if (config.role && config.role !== 'both' && config.role !== activeRole) {
    return false;
  }

  if (config.triggerState === 'any') {
    return true;
  }

  if (config.triggerState === 'driver_online') {
    return activeRole === 'driver' && driverOnline === true;
  }

  return normalizeBookingStatus(bookingStatus) === config.triggerState;
}

module.exports = {
  buildPrototypeConnectionIndicatorModel,
  normalizeBookingStatus,
  normalizeConnectionScenario,
  normalizeConnectionTriggerState,
  resolvePrototypeConnectionAutomationConfig,
  shouldRunPrototypeConnectionAutomation,
  shouldSurfacePrototypeConnectionIndicator,
};
