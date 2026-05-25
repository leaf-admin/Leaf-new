import Logger from '../utils/Logger';
import WebSocketManager from './WebSocketManager';

const DEFAULT_AUTH_TIMEOUT_MS = 18000;
const DEFAULT_CONNECT_REASON = 'runtime';

function normalizeRealtimeRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['driver', 'motorista'].includes(normalized)) return 'driver';
  if (['customer', 'passenger', 'rider', 'passageiro'].includes(normalized)) {
    return 'customer';
  }
  return null;
}

function resolveSession(input = {}) {
  const profile = input?.profile || input || {};
  const userId = String(
    input?.userId ||
      input?.uid ||
      profile?.uid ||
      profile?.id ||
      profile?.userId ||
      '',
  ).trim();
  const userType =
    normalizeRealtimeRole(input?.userType) ||
    normalizeRealtimeRole(input?.role) ||
    normalizeRealtimeRole(profile?.usertype) ||
    normalizeRealtimeRole(profile?.userType) ||
    normalizeRealtimeRole(profile?.role) ||
    normalizeRealtimeRole(profile?.user_role) ||
    normalizeRealtimeRole(profile?.accountType);

  if (!userId || !userType) {
    return null;
  }

  return {
    userId,
    userType,
    key: `${userId}:${userType}`,
  };
}

class RealtimeConnectionOrchestrator {
  constructor(socketManager = WebSocketManager.getInstance()) {
    this.socketManager = socketManager;
    this.listeners = new Set();
    this.readyPromise = null;
    this.readyPromiseKey = null;
    this.connectPromise = null;
    this.activeSession = null;
    this.state = {
      phase: 'idle',
      ready: false,
      connecting: false,
      authenticated: false,
      userId: null,
      userType: null,
      socketId: null,
      error: null,
      reason: null,
      updatedAt: Date.now(),
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState() {
    const socketStatus = this.socketManager.getConnectionStatus?.() || {};
    return {
      ...this.state,
      connected: Boolean(socketStatus.connected),
      authenticated: Boolean(socketStatus.authenticated),
      socketId: socketStatus.socketId || this.state.socketId || null,
      userId: socketStatus.userId || this.state.userId || null,
      userType: socketStatus.userType || this.state.userType || null,
      socketStatus,
    };
  }

  _setState(patch = {}) {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: Date.now(),
    };
    const snapshot = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        Logger.warn(
          '⚠️ [RealtimeOrchestrator] Listener falhou:',
          error?.message || error,
        );
      }
    });
    return snapshot;
  }

  async bootstrap(options = {}) {
    return this.ensureConnected({
      reason: options.reason || 'app_boot',
      forceRefreshAuth: options.forceRefreshAuth === true,
    });
  }

  async ensureConnected(options = {}) {
    if (this.socketManager.isConnected?.()) {
      this._setState({
        phase: this.state.authenticated ? 'ready' : 'connected',
        ready: Boolean(this.state.ready && this.state.authenticated),
        connecting: false,
        error: null,
        reason: options.reason || DEFAULT_CONNECT_REASON,
      });
      return true;
    }

    if (this.connectPromise && options.forceRefreshAuth !== true) {
      return this.connectPromise;
    }

    this._setState({
      phase: 'connecting',
      ready: false,
      connecting: true,
      error: null,
      reason: options.reason || DEFAULT_CONNECT_REASON,
    });

    this.connectPromise = this.socketManager
      .connect({ forceRefreshAuth: options.forceRefreshAuth === true })
      .then(() => {
        this._setState({
          phase: 'connected',
          connecting: false,
          error: null,
          reason: options.reason || DEFAULT_CONNECT_REASON,
        });
        return true;
      })
      .catch((error) => {
        this._setState({
          phase: 'error',
          ready: false,
          connecting: false,
          error: error?.message || String(error),
          reason: options.reason || DEFAULT_CONNECT_REASON,
        });
        throw error;
      })
      .finally(() => {
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  async ensureReady(sessionInput = {}, options = {}) {
    const session = resolveSession(sessionInput);
    if (!session) {
      this._setState({
        phase: 'idle',
        ready: false,
        connecting: false,
        authenticated: false,
        userId: null,
        userType: null,
        error: 'Sessao ausente para autenticar o tempo real.',
        reason: options.reason || DEFAULT_CONNECT_REASON,
      });
      return false;
    }

    const socketStatus = this.socketManager.getConnectionStatus?.() || {};
    const alreadyReady =
      Boolean(socketStatus.connected) &&
      Boolean(socketStatus.authenticated) &&
      socketStatus.userId === session.userId &&
      (socketStatus.userType === session.userType || !socketStatus.userType);

    if (alreadyReady) {
      this.activeSession = session;
      this._setState({
        phase: 'ready',
        ready: true,
        connecting: false,
        authenticated: true,
        userId: session.userId,
        userType: session.userType,
        socketId: socketStatus.socketId || null,
        error: null,
        reason: options.reason || DEFAULT_CONNECT_REASON,
      });
      return true;
    }

    const promiseKey = `${session.key}:${options.forceRefreshToken === true ? 'refresh' : 'normal'}`;
    if (this.readyPromise && this.readyPromiseKey === promiseKey) {
      return this.readyPromise;
    }

    this.readyPromiseKey = promiseKey;
    this.readyPromise = this._runEnsureReady(session, options).finally(() => {
      if (this.readyPromiseKey === promiseKey) {
        this.readyPromise = null;
        this.readyPromiseKey = null;
      }
    });

    return this.readyPromise;
  }

  async syncSession(profile, options = {}) {
    const session = resolveSession(profile);
    if (!session) {
      this.clearSession({ disconnect: options.disconnect !== false });
      return false;
    }

    return this.ensureReady(session, {
      ...options,
      reason: options.reason || 'profile_session',
    });
  }

  clearSession(options = {}) {
    this.readyPromise = null;
    this.readyPromiseKey = null;
    this.connectPromise = null;
    this.activeSession = null;

    if (typeof this.socketManager.clearAuthenticationState === 'function') {
      this.socketManager.clearAuthenticationState({
        disconnect: options.disconnect !== false,
      });
    } else if (options.disconnect !== false) {
      this.socketManager.disconnect?.();
    }

    this._setState({
      phase: 'idle',
      ready: false,
      connecting: false,
      authenticated: false,
      userId: null,
      userType: null,
      socketId: null,
      error: null,
      reason: options.reason || 'session_cleared',
    });
  }

  async _runEnsureReady(session, options = {}) {
    this._setState({
      phase: 'authenticating',
      ready: false,
      connecting: true,
      authenticated: false,
      userId: session.userId,
      userType: session.userType,
      error: null,
      reason: options.reason || DEFAULT_CONNECT_REASON,
    });

    try {
      const currentStatus = this.socketManager.getConnectionStatus?.() || {};
      const authenticatedAsDifferentUser =
        Boolean(currentStatus.authenticated) &&
        currentStatus.userId &&
        (currentStatus.userId !== session.userId ||
          (currentStatus.userType &&
            currentStatus.userType !== session.userType));

      if (authenticatedAsDifferentUser) {
        this.socketManager.clearAuthenticationState?.({ disconnect: false });
      }

      await this.ensureConnected({
        reason: options.reason || DEFAULT_CONNECT_REASON,
        forceRefreshAuth: options.forceRefreshAuth === true,
      });

      await this.socketManager.authenticateWithAck(
        session.userId,
        session.userType,
        options.authTimeoutMs || DEFAULT_AUTH_TIMEOUT_MS,
        {
          maxRetries: options.maxAuthRetries,
          forceRefreshToken: options.forceRefreshToken === true,
        },
      );

      const finalStatus = this.socketManager.getConnectionStatus?.() || {};
      const isReady =
        Boolean(finalStatus.connected) &&
        Boolean(finalStatus.authenticated) &&
        finalStatus.userId === session.userId &&
        (finalStatus.userType === session.userType || !finalStatus.userType);

      if (!isReady) {
        throw new Error('Sessao em tempo real ainda nao autenticada.');
      }

      this.activeSession = session;
      this._setState({
        phase: 'ready',
        ready: true,
        connecting: false,
        authenticated: true,
        userId: session.userId,
        userType: session.userType,
        socketId: finalStatus.socketId || null,
        error: null,
        reason: options.reason || DEFAULT_CONNECT_REASON,
      });

      return true;
    } catch (error) {
      this._setState({
        phase: 'error',
        ready: false,
        connecting: false,
        authenticated: false,
        error: error?.message || String(error),
        reason: options.reason || DEFAULT_CONNECT_REASON,
      });
      throw error;
    }
  }
}

const realtimeConnectionOrchestrator = new RealtimeConnectionOrchestrator();

export { RealtimeConnectionOrchestrator, resolveSession };
export default realtimeConnectionOrchestrator;
