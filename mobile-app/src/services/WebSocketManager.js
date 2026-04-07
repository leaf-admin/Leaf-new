import Logger from '../utils/Logger';
import io from 'socket.io-client';
import { getWebSocketURL } from '../config/NetworkConfig';
import auth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { toUserFriendlyError } from '../utils/friendlyErrorMessages';

const CREATE_BOOKING_TIMEOUT_MS = 120000; // 2 minutos mínimo para evitar timeout prematuro em cenários de alta latência
const CREATE_BOOKING_MAX_RETRIES = 4;
const CREATE_BOOKING_RETRY_BASE_DELAY_MS = 800;
const CREATE_BOOKING_RETRY_JITTER_MS = 350;
const WS_CONNECT_TIMEOUT_MS = 30000;
const AUTH_ACK_DEFAULT_TIMEOUT_MS = 18000;
const AUTH_BUSY_MAX_RETRIES = 4;
const AUTH_BUSY_JITTER_MS = 250;
const ACTIVE_RIDE_SYNC_TIMEOUT_MS = 8000;
const TRANSIENT_CONNECT_ERROR_LOG_WINDOW_MS = 15000;
const TEST_MODE_STORAGE_KEY = '@test_mode';
const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';
const QA_SOCKET_ID_TOKEN_STORAGE_KEY = '@qa_socket_id_token';

// ✅ CORREÇÃO: Calcular URL dinamicamente para evitar problemas em builds de release
// Não armazenar como constante, calcular sempre que necessário

const buildSocketError = (payload, fallbackMessage = 'Erro desconhecido', context = 'websocket') => {
    let message = fallbackMessage;

    if (typeof payload === 'string' && payload.trim()) {
        message = payload;
    } else if (payload && typeof payload === 'object') {
        message = payload.message || payload.error || fallbackMessage;
    }

    const error = toUserFriendlyError(
        payload && typeof payload === 'object' ? { ...payload, message } : message,
        { context, fallbackMessage }
    );

    if (payload && typeof payload === 'object') {
        if (payload.code) error.code = payload.code;
        if (payload.details) error.details = payload.details;
        error.payload = payload;
    }

    return error;
};

const sleepMs = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const CREATE_BOOKING_RETRYABLE_CODES = new Set([
    'BOOKING_TIMEOUT',
    'WS_DISCONNECTED',
    'WS_CONNECT_TIMEOUT',
    'DUPLICATE_REQUEST',
    'QUEUE_BACKPRESSURE',
    'AUTH_BUSY',
    'AUTH_TIMEOUT',
    'PAYMENT_NOT_CONFIRMED'
]);

function createSocketRequestId(prefix = 'req') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ✅ FASE 2: EventEmitter interno simples (compatível com React Native)
class SimpleEventEmitter {
    constructor() {
        this.events = new Map();
    }

    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(callback);
    }

    off(event, callback) {
        if (!this.events.has(event)) return;

        if (callback) {
            const listeners = this.events.get(event);
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
            if (listeners.length === 0) {
                this.events.delete(event);
            }
        } else {
            this.events.delete(event);
        }
    }

    emit(event, ...args) {
        if (!this.events.has(event)) return;

        const listeners = [...this.events.get(event)]; // Cópia para evitar problemas
        listeners.forEach(callback => {
            try {
                callback(...args);
            } catch (error) {
                Logger.error(`❌ Erro em listener de ${event}:`, error);
            }
        });
    }

    removeAllListeners(event) {
        if (event) {
            this.events.delete(event);
        } else {
            this.events.clear();
        }
    }
}

class WebSocketManager {
    static instance = null;

    constructor() {
        if (!WebSocketManager.instance) {
            this.socket = null;
            this.isConnecting = false;
            this.connectionPromise = null;
            this.connectionAttempts = 0;
            this.maxConnectionAttempts = 20; // manter sessão persistente mesmo com oscilação de rede
            this.eventListeners = new Map(); // ✅ Manter para compatibilidade temporária
            this.pendingListeners = []; // ✅ Inicializar pendingListeners
            this._connectHandlers = new Set(); // ✅ FASE 1: Rastrear handlers de conexão para evitar duplicação
            this.isAuthenticated = false; // ✅ Rastrear estado de autenticação
            this.authenticatedUserId = null; // ✅ ID do usuário autenticado
            this.authenticatedUserType = null; // ✅ Tipo do usuário autenticado
            this.authCredentials = null; // ✅ Armazenar credenciais para auto-reautenticação
            this.isAuthenticating = false; // ✅ Flag para evitar autenticação duplicada
            this.reconnectTimer = null; // Evitar agendamento duplicado de reconexão manual
            this.lastActiveRideSnapshot = null; // Snapshot de corrida ativa para reidratação pós-reconexão
            this._lastActiveRideSyncAt = 0;
            this.authAckInFlight = null;
            this.authAckInFlightKey = null;
            this.lastSocketUrl = null;
            this.lastConnectErrorSignature = null;
            this.lastConnectErrorLoggedAt = 0;
            this.suppressedConnectErrorCount = 0;
            this.qaSocketBypassState = { enabled: false, uid: null };
            this.lastSocketAuthPayload = null;

            // ✅ FASE 2: EventEmitter interno - única fonte de distribuição de eventos
            this.eventEmitter = new SimpleEventEmitter();
            this.socketListeners = new Set(); // Rastrear quais eventos do servidor estão sendo capturados

            // Configurações de retry
            this.retryConfig = {
                maxAttempts: 5,           // Máximo de tentativas (infinito se < 0)
                initialDelay: 1000,      // Delay inicial: 1s
                maxDelay: 30000,         // Delay máximo: 30s
                multiplier: 1.5          // Multiplicador exponencial
            };

            WebSocketManager.instance = this;
        }
        return WebSocketManager.instance;
    }

    static getInstance() {
        if (!WebSocketManager.instance) {
            WebSocketManager.instance = new WebSocketManager();
        }
        return WebSocketManager.instance;
    }

    async _buildSocketAuthPayload() {
        let userToken = null;
        try {
            const currentUser = auth().currentUser;
            if (currentUser) {
                userToken = await currentUser.getIdToken();
            }
        } catch (tokenError) {
            Logger.warn('⚠️ [WebSocketManager] Erro ao obter token do Firebase:', tokenError);
        }

        if (userToken) {
            this.qaSocketBypassState = { enabled: false, uid: null };
            this.lastSocketAuthPayload = { token: userToken };
            return this.lastSocketAuthPayload;
        }

        const qaSocketIdToken = await this._resolveQaSocketIdToken();
        if (qaSocketIdToken) {
            this.qaSocketBypassState = { enabled: false, uid: null };
            this.lastSocketAuthPayload = { token: qaSocketIdToken };
            return this.lastSocketAuthPayload;
        }

        const qaBypassPayload = await this._resolveQaSocketBypassPayload();
        if (qaBypassPayload) {
            this.qaSocketBypassState = { enabled: true, uid: qaBypassPayload.uid };
            this.lastSocketAuthPayload = {
                token: null,
                uid: qaBypassPayload.uid,
                qaAuthBypass: true,
                qaAutomation: true
            };
            return this.lastSocketAuthPayload;
        }

        this.qaSocketBypassState = { enabled: false, uid: null };
        this.lastSocketAuthPayload = { token: null };
        return this.lastSocketAuthPayload;
    }

    async _resolveQaSocketIdToken() {
        try {
            const [testModeRaw, qaSocketIdTokenRaw] = await Promise.all([
                AsyncStorage.getItem(TEST_MODE_STORAGE_KEY),
                AsyncStorage.getItem(QA_SOCKET_ID_TOKEN_STORAGE_KEY),
            ]);

            const qaSocketTokenEnabled = String(testModeRaw || '').trim().toLowerCase() === 'true';
            const qaSocketIdToken = String(qaSocketIdTokenRaw || '').trim();
            if (qaSocketTokenEnabled && qaSocketIdToken) {
                return qaSocketIdToken;
            }
        } catch (qaTokenError) {
            Logger.warn('⚠️ [WebSocketManager] Erro ao recuperar idToken QA do socket:', qaTokenError);
        }

        return null;
    }

    async _resolveQaSocketBypassPayload(preferredUserId = '') {
        try {
            const [testModeRaw, persistedUidRaw, storedUserDataRaw] = await Promise.all([
                AsyncStorage.getItem(TEST_MODE_STORAGE_KEY),
                AsyncStorage.getItem(AUTH_UID_STORAGE_KEY),
                AsyncStorage.getItem(USER_DATA_STORAGE_KEY)
            ]);
            const qaSocketBypassEnabled = String(testModeRaw || '').trim().toLowerCase() === 'true';
            let storedUserData = null;
            if (storedUserDataRaw) {
                try {
                    storedUserData = JSON.parse(storedUserDataRaw);
                } catch (_error) {
                    storedUserData = null;
                }
            }
            const qaSocketBypassUid = String(
                preferredUserId ||
                this.authCredentials?.userId ||
                this.authenticatedUserId ||
                storedUserData?.uid ||
                persistedUidRaw ||
                ''
            ).trim();

            if (qaSocketBypassEnabled && qaSocketBypassUid) {
                return {
                    uid: qaSocketBypassUid,
                    qaAuthBypass: true,
                    qaAutomation: true
                };
            }
        } catch (qaBypassError) {
            Logger.warn('⚠️ [WebSocketManager] Erro ao montar bypass QA do socket:', qaBypassError);
        }

        return null;
    }

    _buildSocketQueryPayload(socketAuth = null) {
        if (socketAuth?.qaAuthBypass && socketAuth?.uid) {
            return {
                uid: socketAuth.uid,
                qaAuthBypass: 'true',
                qaAutomation: 'true'
            };
        }
        return {};
    }

    async connect() {
        if (this.socket?.connected) {
            Logger.log('✅ [WebSocketManager] Já conectado, ignorando nova conexão');
            return true;
        }

        if (this.connectionPromise) {
            Logger.log('⏳ [WebSocketManager] Conexão já em andamento, aguardando...');
            return this.connectionPromise;
        }

        try {
            this.isConnecting = true;
            if (this.socket) {
                Logger.log('🔁 [WebSocketManager] Reutilizando socket existente');
                const socketAuth = await this._buildSocketAuthPayload();
                this.socket.auth = socketAuth;
                if (this.socket.io?.opts) {
                    this.socket.io.opts.query = this._buildSocketQueryPayload(socketAuth);
                }
                this.connectionPromise = this._waitForConnection();
                if (!this.socket.active) {
                    this.socket.connect();
                }
                return this.connectionPromise;
            }

            this.connectionAttempts = 0;

            // ✅ CORREÇÃO: Calcular URL dinamicamente para garantir que está correta
            const WEBSOCKET_URL = getWebSocketURL();
            this.lastSocketUrl = WEBSOCKET_URL;
            Logger.log('🔌 [WebSocketManager] Conectando ao WebSocket:', WEBSOCKET_URL);

            // ✅ CORREÇÃO: Tentar websocket primeiro, polling como fallback
            // Polling pode ter problemas em React Native, websocket é mais confiável
            const transports = ['websocket', 'polling'];

            Logger.log('🔌 [WebSocketManager] Configuração de transporte:', {
                transports,
                url: WEBSOCKET_URL,
                isDev: __DEV__
            });

            // ✅ Buscar token do Firebase para autenticação segura
            const socketAuth = await this._buildSocketAuthPayload();
            const socketQuery = this._buildSocketQueryPayload(socketAuth);

            this.socket = io(WEBSOCKET_URL, {
                // ✅ Passar token JWT na conexão (handshake)
                auth: socketAuth,
                query: socketQuery,
                // ✅ Ignorar verificação de certificado SSL para IP direto (se usar HTTPS)
                rejectUnauthorized: false,
                // ✅ Permitir certificados auto-assinados
                transports: transports,
                reconnection: true,
                reconnectionDelay: 3000,
                reconnectionDelayMax: 10000,
                reconnectionAttempts: 20,
                timeout: WS_CONNECT_TIMEOUT_MS,
                upgrade: true,
                rememberUpgrade: false, // ✅ Não lembrar upgrade para evitar problemas
                // ✅ Configurações adicionais para React Native
                autoConnect: false,
                forceNew: false,
                // ✅ Headers extras para React Native
                extraHeaders: {},
                // ✅ Configurações de ping
                pingTimeout: 60000,
                pingInterval: 25000,
                // ✅ Permitir EIO3 e EIO4
                allowEIO3: true,
                allowEIO4: true,
            });

            this.socketListeners.clear();
            this.setupListeners();
            this.connectionPromise = this._waitForConnection();
            this.socket.connect();
            return this.connectionPromise;

        } catch (error) {
            Logger.error('❌ [WebSocketManager] Erro ao inicializar WebSocket:', error.message);
            Logger.error('❌ [WebSocketManager] Stack:', error.stack);
            this.isConnecting = false;
            this.connectionPromise = null;
            throw error; // ✅ Re-throw para que o chamador possa tratar
        }
    }

    _serializeConnectErrorDescription(description) {
        if (!description) return 'N/A';
        if (typeof description === 'string') return description;
        if (typeof description === 'object') {
            return description._type || description.type || description.message || 'N/A';
        }
        return String(description);
    }

    _isTransientConnectError(error) {
        const errorMessage = String(error?.message || '').toLowerCase();
        const errorType = String(error?.type || '').toLowerCase();
        const descriptionType = String(error?.description?._type || error?.description?.type || '').toLowerCase();

        if (errorType === 'transporterror' && errorMessage.includes('websocket error')) {
            return true;
        }

        if (errorMessage.includes('xhr poll error')) {
            return true;
        }

        return descriptionType === 'error' && (errorMessage.includes('websocket') || errorMessage.includes('network'));
    }

    _logConnectError(error) {
        const errorMessage = error?.message || 'Erro desconhecido';
        const errorType = error?.type || 'N/A';
        const description = this._serializeConnectErrorDescription(error?.description);
        const signature = `${errorType}:${errorMessage}:${description}`;
        const now = Date.now();
        const isTransient = this._isTransientConnectError(error);

        if (isTransient) {
            const shouldLogNow = (
                this.lastConnectErrorSignature !== signature ||
                now - this.lastConnectErrorLoggedAt >= TRANSIENT_CONNECT_ERROR_LOG_WINDOW_MS
            );

            if (shouldLogNow) {
                const suppressedSinceLastLog = this.suppressedConnectErrorCount;
                this.suppressedConnectErrorCount = 0;
                this.lastConnectErrorSignature = signature;
                this.lastConnectErrorLoggedAt = now;
                Logger.log('🔄 [WebSocketManager] Conexão instável detectada. Retry automático ativo.', {
                    message: errorMessage,
                    type: errorType,
                    url: this.lastSocketUrl || 'N/A',
                    suppressedSinceLastLog
                });
            } else {
                this.suppressedConnectErrorCount += 1;
            }

            return;
        }

        this.lastConnectErrorSignature = signature;
        this.lastConnectErrorLoggedAt = now;
        this.suppressedConnectErrorCount = 0;
        Logger.error('❌ [WebSocketManager] Erro de conexão WebSocket:', errorMessage);
        Logger.error('❌ [WebSocketManager] Tipo de erro:', errorType);
        Logger.error('❌ [WebSocketManager] URL:', this.lastSocketUrl || 'N/A');
        Logger.error('❌ [WebSocketManager] Descrição:', description);
    }

    _waitForConnection(timeoutMs = WS_CONNECT_TIMEOUT_MS) {
        if (!this.socket) {
            this.isConnecting = false;
            this.connectionPromise = null;
            return Promise.reject(
                buildSocketError(
                    { code: 'WS_NOT_INITIALIZED', message: 'Socket nao inicializado' },
                    'Nao foi possivel iniciar a conexao com o servidor agora.',
                    'websocket'
                )
            );
        }

        if (this.socket.connected) {
            this.isConnecting = false;
            this.connectionPromise = null;
            return Promise.resolve(true);
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            let lastError = null;

            const cleanup = () => {
                this.socket?.off('connect', onConnect);
                this.socket?.off('connect_error', onConnectError);
            };

            const finalize = (handler) => (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                this.isConnecting = false;
                this.connectionPromise = null;
                handler(value);
            };

            const onConnect = finalize(() => resolve(true));
            const onConnectError = (error) => {
                lastError = error;
            };

            this.socket.on('connect', onConnect);
            this.socket.on('connect_error', onConnectError);

            setTimeout(() => {
                finalize(() =>
                    reject(
                        buildSocketError(
                            lastError || { code: 'WS_CONNECT_TIMEOUT', message: 'Timeout ao conectar WebSocket' },
                            'A conexao com o servidor demorou mais que o esperado. Tente novamente.',
                            'websocket'
                        )
                    )
                )();
            }, timeoutMs);
        });
    }

    setupListeners() {
        if (!this.socket) return;

        // ✅ FASE 2: Registrar eventos do servidor APENAS UMA VEZ
        // Lista de eventos que o servidor pode enviar
        const serverEvents = [
            'rideRequest',
            'newBookingAvailable',
            'newRideRequest', // ✅ Evento do DriverNotificationDispatcher 
            'bookingCreated',
            'bookingError',
            'driversFound',
            'noDriversFound',
            'rideAccepted',
            'driverAccepted',
            'rideRejected',
            'rideCancelled',
            'tripStarted',
            'tripCompleted',
            'paymentConfirmed',
            'paymentRefunded',
            'rideExtensionRequestAccepted',
            'rideExtensionApprovalRequested',
            'rideExtensionPaymentRequired',
            'rideExtensionPendingPayment',
            'rideExtensionRejected',
            'rideExtensionExpired',
            'rideExtensionConfirmed',
            'rideExtensionError',
            'rideExtensionResponseError',
            'rideOperationalInterruption',
            'rideOperationalInterrupted',
            'rideOperationalContinuationSearching',
            'rideOperationalReleased',
            'rideOperationalInterruptionError',
            'rideOperationalContinuationError',
            'ratingReceived',
            'authenticated', // ✅ Evento de autenticação confirmada
            'auth_error',
            'authentication_error',
            'driverStatusChanged',
            'driverStatusUpdated',
            'driverStatusError',
            'driverSearchResumed',
            'driver_status_updated',
            'nearbyDrivers',
            'driverLocation',
            'driverArrived',
            'arrivedAtPickup',
            'notificationActionSuccess',
            'notificationActionError',
            'passengerLocationUpdated',
            'passengerLocationError',
            'tripIntegrityCheckRequired',
            'tripIntegrityCancelled',
            'boardingStatusConfirmed',
            'boardingStatusError',
            'activeRideSync',
            'locationUpdated',
            'mapH3Refresh',
            'map_h3_refresh',
            'error'
        ];

        // ✅ Registrar listener para evento 'authenticated' do servidor
        if (!this.socketListeners.has('authenticated')) {
            this.socket.on('authenticated', (data) => {
                Logger.log('✅ [WebSocketManager] Autenticação confirmada pelo servidor:', data);
                this.isAuthenticated = true;
                this.isAuthenticating = false; // Resetar flag
                if (data.uid) this.authenticatedUserId = data.uid;
                // ✅ Atualizar userType se vier do servidor, senão manter o que já foi definido
                if (data.userType) {
                    this.authenticatedUserType = data.userType;
                } else if (!this.authenticatedUserType && data.uid) {
                    // Se não veio userType mas temos UID, tentar inferir do contexto
                    // (isso é um fallback, o ideal é sempre enviar userType)
                    Logger.warn('⚠️ [WebSocketManager] Servidor não retornou userType no evento authenticated');
                }
                // ✅ FASE 2: Retransmitir através do EventEmitter
                this.eventEmitter.emit('authenticated', data);

                const now = Date.now();
                if (now - this._lastActiveRideSyncAt > 1000) {
                    this._lastActiveRideSyncAt = now;
                    this.syncActiveRideWithAck(ACTIVE_RIDE_SYNC_TIMEOUT_MS).catch((syncError) => {
                        Logger.warn('⚠️ [WebSocketManager] Falha ao sincronizar corrida ativa após autenticação:', syncError?.message || syncError);
                    });
                }
            });
            this.socketListeners.add('authenticated');
        }

        if (!this.socketListeners.has('activeRideSync')) {
            this.socket.on('activeRideSync', (snapshot) => {
                if (snapshot?.success) {
                    this.lastActiveRideSnapshot = snapshot;
                    this._rehydrateRideEventsFromSync(snapshot);
                }
                this.eventEmitter.emit('activeRideSync', snapshot);
            });
            this.socketListeners.add('activeRideSync');
        }

        // ✅ FASE 2: Registrar cada evento do servidor apenas uma vez
        serverEvents.forEach(eventName => {
            if (!this.socketListeners.has(eventName)) {
                try {
                    this.socket.on(eventName, (data) => {
                        // ✅ FASE 2: Retransmitir APENAS através do EventEmitter interno
                        // Nunca usar socket.io diretamente nos componentes
                        this.eventEmitter.emit(eventName, data);
                        // Logger.log(`📡 Evento ${eventName} recebido e distribuído`); // Desabilitado para reduzir spam
                    });
                    this.socketListeners.add(eventName);
                    // Logger.log(`✅ Listener de servidor registrado: ${eventName}`); // Desabilitado para reduzir spam
                } catch (error) {
                    Logger.warn(`⚠️ Erro ao registrar listener de servidor (${eventName}):`, error.message);
                }
            }
        });

        this.socket.on('connect', () => {
            Logger.log('✅ [WebSocketManager] Conectado ao servidor WebSocket');
            Logger.log('📡 [WebSocketManager] Transport:', this.socket.io.engine.transport.name);
            Logger.log('📡 [WebSocketManager] Socket ID:', this.socket.id);
            this.isConnecting = false;
            this.connectionAttempts = 0;
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            // ✅ AUTO-REAUTENTICAÇÃO: Se já tínhamos credenciais, re-autenticar automaticamente
            if (this.authCredentials) {
                Logger.log('🔐 [WebSocketManager] Reconectado. Iniciando auto-reautenticação...');
                this.authenticateWithAck(
                    this.authCredentials.userId,
                    this.authCredentials.userType,
                    AUTH_ACK_DEFAULT_TIMEOUT_MS,
                    { maxRetries: AUTH_BUSY_MAX_RETRIES }
                ).catch((authError) => {
                    Logger.warn('⚠️ [WebSocketManager] Auto-reautenticação com ACK falhou, fallback para emissão simples:', authError?.message || authError);
                    this.authenticate(this.authCredentials.userId, this.authCredentials.userType, { force: true });
                });
            } else {
                // Se não temos credenciais salvas, resetar estado
                this.isAuthenticated = false;
                this.authenticatedUserId = null;
                this.authenticatedUserType = null;
            }
            this.isAuthenticating = false;

            // ✅ FASE 2: Emitir evento de conexão através do EventEmitter
            this.eventEmitter.emit('connect');
        });

        this.socket.on('disconnect', (reason) => {
            Logger.log(`🔌 [WebSocketManager] Desconectado do servidor WebSocket: ${reason}`);
            Logger.log(`🔌 [WebSocketManager] Motivo da desconexão:`, reason);
            this.isConnecting = false;
            // Resetar estado de autenticação (mas MANTER authCredentials para reconexão)
            this.isAuthenticated = false;
            this.isAuthenticating = false;

            // ✅ FASE 2: Emitir através do EventEmitter
            this.eventEmitter.emit('disconnect', reason);
        });

        this.socket.on('connect_error', (error) => {
            this._logConnectError(error);

            this.isConnecting = false;
            this.connectionAttempts++;

            // ✅ Emitir erro através do EventEmitter
            this.eventEmitter.emit('connect_error', error);

            // Deixar o reconnect automático do socket.io atuar primeiro.
            // Se esgotar tentativas, agenda uma nova janela única com jitter.
            if (this.connectionAttempts >= this.maxConnectionAttempts && !this.reconnectTimer) {
                const delay = 25000 + Math.floor(Math.random() * 10000);
                Logger.log(`🔌 [WebSocketManager] Janela extra de reconexão em ${delay}ms`);
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectTimer = null;
                    this.connectionAttempts = 0;
                    if (!this.socket?.connected) {
                        this.connect();
                    }
                }, delay);
            }
        });

        this.socket.on('reconnect', (attemptNumber) => {
            Logger.log(`🔌 Reconectado ao WebSocket após ${attemptNumber} tentativas`);
            this.connectionAttempts = 0;
            // ✅ FASE 2: Emitir através do EventEmitter
            this.eventEmitter.emit('reconnect', attemptNumber);
        });
    }

    disconnect() {
        if (this.socket?.connected) {
            this.socket.disconnect();
        }
        this.isConnecting = false;
    }

    // Método para enviar eventos ao servidor via WebSocket
    emitToServer(event, data) {
        if (this.socket?.connected) {
            this.socket.emit(event, data);
        } else {
            Logger.warn(`⚠️ WebSocket não conectado. Evento '${event}' não enviado.`);
        }
    }

    // ✅ FASE 2: Método on() simplificado - usa apenas EventEmitter interno
    // NUNCA mais acessa socket.io diretamente - elimina completamente race conditions
    on(event, callback) {
        // ✅ FASE 2: Guard 1 - Validar parâmetros
        if (!event || typeof event !== 'string') {
            Logger.error('⚠️ WebSocketManager.on() requer event como string');
            return;
        }

        if (typeof callback !== 'function') {
            Logger.error('⚠️ WebSocketManager.on() requer callback como function');
            return;
        }

        // ✅ FASE 2: Inicializar EventEmitter se necessário
        if (!this.eventEmitter) {
            this.eventEmitter = new SimpleEventEmitter();
        }

        // ✅ FASE 2: Registrar APENAS no EventEmitter interno
        // NUNCA mais registra diretamente no socket.io!
        this.eventEmitter.on(event, callback);
        // Logger.log(`📡 Listener registrado via EventEmitter: ${event}`); // Desabilitado para reduzir spam

        // ✅ FASE 2: Garantir que o evento do servidor está sendo capturado
        // Se o socket já existe, garantir que o listener do servidor está ativo
        if (this.socket && !this.socketListeners.has(event)) {
            // Tentar registrar o listener do servidor
            this._registerServerEventListener(event);
        }
    }

    once(event, callback) {
        if (!event || typeof event !== 'string') {
            Logger.warn('⚠️ WebSocketManager.once() requer event como string');
            return;
        }

        if (typeof callback !== 'function') {
            Logger.warn('⚠️ WebSocketManager.once() requer callback como function');
            return;
        }

        const onceCallback = (...args) => {
            this.off(event, onceCallback);
            callback(...args);
        };

        this.on(event, onceCallback);
    }

    // ✅ FASE 2: Método privado para registrar listener do servidor
    _registerServerEventListener(eventName) {
        if (!this.socket || !this.socket.connected) {
            return; // Será registrado quando conectar
        }

        if (this.socketListeners.has(eventName)) {
            return; // Já registrado
        }

        try {
            this.socket.on(eventName, (data) => {
                this.eventEmitter.emit(eventName, data);
            });
            this.socketListeners.add(eventName);
            // Logger.log(`✅ Listener de servidor registrado: ${eventName}`); // Desabilitado para reduzir spam
        } catch (error) {
            Logger.warn(`⚠️ Erro ao registrar listener de servidor (${eventName}):`, error.message);
        }
    }

    // ✅ FASE 2: Método off() simplificado - usa apenas EventEmitter interno
    off(event, callback = null) {
        // ✅ FASE 2: Guard 1 - Validar parâmetros
        if (!event || typeof event !== 'string') {
            Logger.warn('⚠️ WebSocketManager.off() requer event como string');
            return;
        }

        // ✅ FASE 2: Inicializar EventEmitter se necessário
        if (!this.eventEmitter) {
            this.eventEmitter = new SimpleEventEmitter();
            return;
        }

        // ✅ FASE 2: Remover APENAS do EventEmitter interno
        // NUNCA mais remove do socket.io diretamente - não é necessário!
        this.eventEmitter.off(event, callback);

        // Nota: Não removemos do socketListeners porque outros componentes podem estar usando
        // O listener do servidor permanece ativo e distribui para todos via EventEmitter
    }

    // ✅ FASE 2: Método emit() - usar EventEmitter interno
    emit(event, ...args) {
        // ✅ FASE 2: Guard - Validar parâmetros
        if (!event || typeof event !== 'string') {
            Logger.warn('⚠️ WebSocketManager.emit() requer event como string');
            return;
        }

        // ✅ FASE 2: Inicializar EventEmitter se necessário
        if (!this.eventEmitter) {
            this.eventEmitter = new SimpleEventEmitter();
            return;
        }

        // ✅ FASE 2: Emitir através do EventEmitter interno
        this.eventEmitter.emit(event, ...args);
    }

    // Verificar se está conectado
    isConnected() {
        return this.socket?.connected || false;
    }

    // Obter status completo da conexão
    getConnectionStatus() {
        return {
            connected: this.isConnected(),
            authenticated: this.isAuthenticated,
            socketId: this.socket?.id || null,
            userId: this.authenticatedUserId,
            userType: this.authenticatedUserType,
            isConnecting: this.isConnecting
        };
    }

    // Verificar se pode receber solicitações de corrida
    canReceiveRideRequests() {
        const isConnected = this.isConnected();
        const isAuthenticated = this.isAuthenticated;
        const userType = this.authenticatedUserType;

        // Log para debug (apenas quando houver problema)
        if (isConnected && isAuthenticated && userType !== 'driver') {
            Logger.log('⚠️ [canReceiveRideRequests] Status:', {
                connected: isConnected,
                authenticated: isAuthenticated,
                userType: userType,
                userId: this.authenticatedUserId
            });
        }

        // Para drivers: precisa estar conectado, autenticado e ser do tipo 'driver'
        // Se userType não estiver definido mas estiver autenticado, assumir que é driver
        // (caso o servidor não retorne userType no evento authenticated)
        if (userType === 'driver' || (isAuthenticated && !userType)) {
            return isConnected && isAuthenticated;
        }
        // Para outros tipos de usuário, retorna false
        return false;
    }

    // Expor socket para autenticação
    getSocket() {
        return this.socket;
    }

    // Método para autenticar usuário
    async authenticate(userId, userType, options = {}) {
        if (!this.socket?.connected) {
            Logger.warn('⚠️ [WebSocketManager] WebSocket não conectado. Não é possível autenticar.');
            return;
        }

        const force = options?.force === true;

        // ✅ Evitar autenticação duplicada se já está autenticado com os mesmos dados
        if (this.isAuthenticated &&
            this.authenticatedUserId === userId &&
            this.authenticatedUserType === userType) {
            Logger.log('✅ [WebSocketManager] Já autenticado com esses dados, ignorando');
            return;
        }

        // ✅ Evitar múltiplas tentativas simultâneas
        if (this.isAuthenticating && !force) {
            Logger.log('⚠️ [WebSocketManager] Autenticação já em andamento, ignorando chamada duplicada');
            return;
        }

        this.isAuthenticating = true;
        Logger.log(`🔐 [WebSocketManager] Autenticando usuário: ${userId} como ${userType}`);

        // ✅ Salvar credenciais para auto-reautenticação em caso de queda
        this.authCredentials = { userId, userType };

        // ✅ Definir dados locais
        this.authenticatedUserType = userType;
        this.authenticatedUserId = userId;

        const qaBypassPayload = await this._resolveQaSocketBypassPayload(userId);
        const shouldUseQaSocketBypass = Boolean(
            qaBypassPayload?.qaAuthBypass &&
            String(qaBypassPayload?.uid || '') === String(userId || '')
        );
        const socketAuthPayload = await this._buildSocketAuthPayload();

        if (shouldUseQaSocketBypass) {
            this.qaSocketBypassState = { enabled: true, uid: String(userId || '').trim() };
        }

        const authenticatePayload = {
            uid: userId,
            userType: userType,
            ...(shouldUseQaSocketBypass ? {
                qaAuthBypass: true,
                qaAutomation: true
            } : {})
        };

        if (socketAuthPayload?.token) {
            authenticatePayload.token = socketAuthPayload.token;
        }

        this.socket.emit('authenticate', authenticatePayload);

        // Resetar flag após 3 segundos (tempo suficiente para resposta)
        setTimeout(() => {
            this.isAuthenticating = false;
        }, 3000);

        // O listener 'authenticated' já está registrado em setupListeners()
        // e atualizará automaticamente isAuthenticated quando o servidor confirmar
    }

    async authenticateWithAck(
        userId,
        userType,
        timeoutMs = AUTH_ACK_DEFAULT_TIMEOUT_MS,
        options = {}
    ) {
        const requestKey = `${userId || ''}:${userType || ''}`;
        if (this.authAckInFlight && this.authAckInFlightKey === requestKey) {
            return this.authAckInFlight;
        }

        const maxRetries = Number.isFinite(options?.maxRetries)
            ? Math.max(0, options.maxRetries)
            : AUTH_BUSY_MAX_RETRIES;

        const runAuth = async () => {
            let attempt = 0;
            let lastError = null;

            while (attempt <= maxRetries) {
                attempt += 1;
                try {
                    const authData = await this._authenticateSingleAttempt(userId, userType, timeoutMs);
                    return authData;
                } catch (error) {
                    lastError = error;
                    const errorCode = error?.code || error?.payload?.code || null;
                    const retryAfterSec = Number(error?.retryAfterSec || error?.payload?.retryAfterSec || 0);
                    const canRetry = errorCode === 'AUTH_BUSY' && attempt <= maxRetries;

                    if (!canRetry) {
                        throw error;
                    }

                    const retryDelayMs = Math.max(
                        250,
                        (retryAfterSec > 0 ? retryAfterSec * 1000 : 1000) + Math.floor(Math.random() * AUTH_BUSY_JITTER_MS)
                    );

                    Logger.warn(`⚠️ [WebSocketManager] Auth em alta carga (AUTH_BUSY). Retry ${attempt}/${maxRetries} em ${retryDelayMs}ms`);
                    await sleepMs(retryDelayMs);
                }
            }

            throw lastError || buildSocketError(
                { code: 'AUTH_RETRY_EXHAUSTED', message: 'Falha ao autenticar após retries' },
                'Nao foi possivel validar sua sessao agora. Tente novamente.',
                'auth'
            );
        };

        this.authAckInFlightKey = requestKey;
        this.authAckInFlight = runAuth().finally(() => {
            if (this.authAckInFlightKey === requestKey) {
                this.authAckInFlight = null;
                this.authAckInFlightKey = null;
            }
        });
        return this.authAckInFlight;
    }

    _authenticateSingleAttempt(userId, userType, timeoutMs) {
        return new Promise((resolve, reject) => {
            if (!this.socket?.connected) {
                reject(
                    buildSocketError(
                        { code: 'WS_DISCONNECTED', message: 'WebSocket nao conectado' },
                        'Sem conexao com o servidor agora. Verifique sua internet e tente novamente.',
                        'auth'
                    )
                );
                return;
            }

            const cleanup = () => {
                this.off('authenticated', onAuthenticated);
                this.off('auth_error', onAuthError);
                this.off('authentication_error', onAuthenticationError);
                clearTimeout(timeout);
            };

            const completeWithError = (payload, fallbackMessage = 'Nao foi possivel validar sua sessao agora. Tente novamente.') => {
                cleanup();
                const error = buildSocketError(payload, fallbackMessage, 'auth');
                if (payload?.retryAfterSec) {
                    error.retryAfterSec = payload.retryAfterSec;
                }
                reject(error);
            };

            const onAuthenticated = (data) => {
                if (data?.uid && data.uid !== userId) {
                    return;
                }

                if (!data?.success) {
                    completeWithError(data);
                    return;
                }

                cleanup();
                resolve(data);
            };

            const onAuthError = (payload) => {
                completeWithError(payload);
            };

            const onAuthenticationError = (payload) => {
                completeWithError(payload);
            };

            const timeout = setTimeout(() => {
                completeWithError(
                    { code: 'AUTH_TIMEOUT', message: `Timeout de autenticacao (${Math.floor(timeoutMs / 1000)}s)` },
                    'A validacao da sessao demorou mais que o esperado. Tente novamente.'
                );
            }, timeoutMs);

            this.on('authenticated', onAuthenticated);
            this.on('auth_error', onAuthError);
            this.on('authentication_error', onAuthenticationError);
            Promise.resolve(
                this.authenticate(userId, userType, { force: true })
            ).catch((error) => {
                completeWithError(
                    {
                        code: 'AUTH_EMIT_ERROR',
                        message: error?.message || 'Falha ao iniciar autenticacao'
                    },
                    'Nao foi possivel iniciar a validacao da sua sessao.'
                );
            });
        });
    }

    _buildCreateBookingIdempotencyKey(bookingData = {}, requestId = '') {
        const customerId =
            bookingData?.customerId ||
            this.authenticatedUserId ||
            this.authCredentials?.userId ||
            'anonymous';
        const stablePaymentReference = String(
            bookingData?.paymentId ||
            bookingData?.paymentData?.chargeId ||
            bookingData?.paymentData?.paymentId ||
            ''
        ).trim();

        if (stablePaymentReference) {
            return `mobile_${customerId}_payment_${stablePaymentReference}`;
        }

        const pickupLat = Number(bookingData?.pickupLocation?.lat || 0).toFixed(5);
        const pickupLng = Number(bookingData?.pickupLocation?.lng || 0).toFixed(5);
        const destinationLat = Number(bookingData?.destinationLocation?.lat || 0).toFixed(5);
        const destinationLng = Number(bookingData?.destinationLocation?.lng || 0).toFixed(5);
        const fare = Number(bookingData?.estimatedFare || 0).toFixed(2);
        const carType = String(bookingData?.carType || 'standard').toLowerCase();

        const digestSource = `${customerId}|${pickupLat}|${pickupLng}|${destinationLat}|${destinationLng}|${carType}|${fare}|${requestId}`;
        let digest = 0;
        for (let i = 0; i < digestSource.length; i += 1) {
            digest = ((digest << 5) - digest) + digestSource.charCodeAt(i);
            digest |= 0;
        }

        return `mobile_${customerId}_${requestId}_${Math.abs(digest).toString(36)}`;
    }

    _isCreateBookingRetryable(error) {
        const code = String(error?.code || error?.payload?.code || '').toUpperCase();
        if (CREATE_BOOKING_RETRYABLE_CODES.has(code)) {
            return true;
        }

        const rawMessage = String(
            error?.message ||
            error?.rawMessage ||
            error?.payload?.message ||
            ''
        ).toLowerCase();

        return (
            rawMessage.includes('timeout ao criar booking') ||
            rawMessage.includes('create booking timeout') ||
            rawMessage.includes('websocket') ||
            rawMessage.includes('desconect')
        );
    }

    _extractCreateBookingRetryDelayMs(error, attempt) {
        const retryAfterSec = Number(error?.retryAfterSec || error?.payload?.retryAfterSec || 0);
        const retryAfterDelayMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 0;
        const progressiveDelayMs = Math.min(
            CREATE_BOOKING_RETRY_BASE_DELAY_MS * Math.max(1, attempt),
            5000
        );
        const baseDelayMs = Math.max(retryAfterDelayMs, progressiveDelayMs);
        return baseDelayMs + Math.floor(Math.random() * CREATE_BOOKING_RETRY_JITTER_MS);
    }

    async _recoverCreateBookingFromSync(idempotencyKey) {
        if (!this.socket?.connected || !this.authenticatedUserId || !this.authenticatedUserType) {
            return null;
        }

        try {
            const syncSnapshot = await this.syncActiveRideWithAck(
                Math.max(ACTIVE_RIDE_SYNC_TIMEOUT_MS, 12000)
            );

            if (!syncSnapshot?.success || !syncSnapshot?.hasActiveRide || !syncSnapshot?.bookingId) {
                return null;
            }

            Logger.warn('⚠️ [WebSocketManager] createBooking reconciliado via syncActiveRide', {
                bookingId: syncSnapshot.bookingId,
                idempotencyKey
            });

            return {
                success: true,
                bookingId: syncSnapshot.bookingId,
                idempotencyKey,
                rehydrated: true,
                message: 'Corrida recuperada após reconexão',
                data: {
                    bookingId: syncSnapshot.bookingId,
                    customerId: syncSnapshot.customerId || this.authenticatedUserId,
                    status: String(syncSnapshot.status || 'SEARCHING').toLowerCase(),
                    rehydrated: true
                }
            };
        } catch (syncError) {
            Logger.warn('⚠️ [WebSocketManager] Falha ao reconciliar createBooking via syncActiveRide:', syncError?.message || syncError);
            return null;
        }
    }

    _createBookingSingleAttempt(bookingData) {
        return new Promise((resolve, reject) => {
            let timeout = null;

            const cleanup = () => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                this.off('bookingCreated', onBookingCreated);
                this.off('bookingError', onBookingError);
            };

            const onBookingCreated = (data) => {
                const responseCustomerId =
                    data?.customerId ||
                    data?.data?.customerId ||
                    data?.booking?.customerId;
                if (
                    bookingData?.customerId &&
                    responseCustomerId &&
                    responseCustomerId !== bookingData.customerId
                ) {
                    return;
                }

                Logger.log('✅ [WebSocketManager] Resposta bookingCreated recebida:', data);
                cleanup();
                if (data?.success) {
                    resolve(data);
                    return;
                }

                const error = buildSocketError(data, 'Nao foi possivel solicitar a viagem agora.', 'booking');
                Logger.error('❌ [WebSocketManager] Erro na resposta:', error.message, error.code || 'SEM_CODE');
                reject(error);
            };

            const onBookingError = (errorPayload) => {
                Logger.error('❌ [WebSocketManager] Erro do servidor:', errorPayload);
                cleanup();
                const error = buildSocketError(errorPayload, 'Nao foi possivel solicitar a viagem agora.', 'booking');
                if (errorPayload?.retryAfterSec) {
                    error.retryAfterSec = errorPayload.retryAfterSec;
                }
                reject(error);
            };

            timeout = setTimeout(() => {
                Logger.error(`❌ [WebSocketManager] Timeout ao criar booking (${CREATE_BOOKING_TIMEOUT_MS}ms)`);
                cleanup();
                reject(
                    buildSocketError(
                        { code: 'BOOKING_TIMEOUT', message: 'Create booking timeout' },
                        'Estamos com alta demanda no momento. Tente solicitar a viagem novamente.',
                        'booking'
                    )
                );
            }, CREATE_BOOKING_TIMEOUT_MS);

            this.on('bookingCreated', onBookingCreated);
            this.on('bookingError', onBookingError);

            Logger.log('📤 [WebSocketManager] Emitindo evento createBooking...');
            this.socket.emit('createBooking', bookingData);
        });
    }

    // Métodos específicos para eventos de viagem
    async createBooking(bookingData, options = {}) {
        const maxRetries = Number.isFinite(options?.maxRetries)
            ? Math.max(0, options.maxRetries)
            : CREATE_BOOKING_MAX_RETRIES;
        const requestId = options?.requestId || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const idempotencyKey = options?.idempotencyKey
            || bookingData?.idempotencyKey
            || this._buildCreateBookingIdempotencyKey(bookingData, requestId);
        const payload = {
            ...bookingData,
            idempotencyKey,
            clientRequestId: requestId
        };

        Logger.log('📤 [WebSocketManager] Criando booking...', {
            connected: this.socket?.connected,
            socketId: this.socket?.id,
            idempotencyKey,
            bookingData: {
                customerId: payload.customerId,
                carType: payload.carType,
                estimatedFare: payload.estimatedFare
            }
        });

        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
            try {
                if (!this.socket?.connected) {
                    await this.connect();
                }

                if (!this.isAuthenticated) {
                    const authUserId =
                        this.authCredentials?.userId ||
                        payload.customerId ||
                        this.authenticatedUserId;
                    const authUserType =
                        this.authCredentials?.userType ||
                        this.authenticatedUserType ||
                        'customer';

                    if (authUserId) {
                        await this.authenticateWithAck(
                            authUserId,
                            authUserType,
                            AUTH_ACK_DEFAULT_TIMEOUT_MS,
                            { maxRetries: AUTH_BUSY_MAX_RETRIES }
                        );
                    }
                }

                if (attempt > 1) {
                    Logger.warn(`🔁 [WebSocketManager] Retry createBooking (${attempt}/${maxRetries + 1})`, {
                        idempotencyKey
                    });
                }

                const response = await this._createBookingSingleAttempt(payload);
                return {
                    ...response,
                    idempotencyKey: response?.idempotencyKey || idempotencyKey
                };
            } catch (error) {
                lastError = error;
                const retryable = this._isCreateBookingRetryable(error);

                if (retryable) {
                    const recovered = await this._recoverCreateBookingFromSync(idempotencyKey);
                    if (recovered) {
                        return recovered;
                    }
                }

                const hasMoreAttempts = attempt <= maxRetries;
                if (!retryable || !hasMoreAttempts) {
                    throw error;
                }

                const retryDelayMs = this._extractCreateBookingRetryDelayMs(error, attempt);
                Logger.warn(
                    `⚠️ [WebSocketManager] createBooking falhou (${error?.code || 'SEM_CODE'}). Nova tentativa em ${retryDelayMs}ms`,
                    { idempotencyKey }
                );
                await sleepMs(retryDelayMs);
            }
        }

        throw lastError || buildSocketError(
            { code: 'BOOKING_RETRY_EXHAUSTED', message: 'Falha ao criar booking apos retries' },
            'Nao foi possivel solicitar a viagem agora. Tente novamente em instantes.',
            'booking'
        );
    }

    async checkRideAvailability(payload = {}, options = {}) {
        const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : 12000;
        const requestId =
            String(options?.requestId || payload?.requestId || '').trim() ||
            createSocketRequestId('availability');

        if (!this.socket?.connected) {
            await this.connect();
        }

        if (!this.isAuthenticated) {
            const authUserId =
                this.authCredentials?.userId ||
                payload.customerId ||
                this.authenticatedUserId;
            const authUserType =
                this.authCredentials?.userType ||
                this.authenticatedUserType ||
                'customer';

            if (authUserId) {
                await this.authenticateWithAck(
                    authUserId,
                    authUserType,
                    AUTH_ACK_DEFAULT_TIMEOUT_MS,
                    { maxRetries: AUTH_BUSY_MAX_RETRIES }
                );
            }
        }

        return new Promise((resolve, reject) => {
            let timeout = null;

            const cleanup = () => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                this.off('rideAvailabilityResult', onSuccess);
                this.off('rideAvailabilityError', onError);
            };

            const onSuccess = (data) => {
                if (data?.requestId && data.requestId !== requestId) {
                    return;
                }
                cleanup();
                if (data?.success) {
                    resolve(data);
                    return;
                }
                reject(
                    buildSocketError(
                        data,
                        'Nao foi possivel validar a disponibilidade agora.',
                        'availability'
                    )
                );
            };

            const onError = (errorPayload) => {
                if (errorPayload?.requestId && errorPayload.requestId !== requestId) {
                    return;
                }
                cleanup();
                reject(
                    buildSocketError(
                        errorPayload,
                        'Nao foi possivel validar a disponibilidade agora.',
                        'availability'
                    )
                );
            };

            timeout = setTimeout(() => {
                cleanup();
                reject(
                    buildSocketError(
                        { code: 'AVAILABILITY_TIMEOUT', message: 'Ride availability timeout' },
                        'Nao foi possivel validar a disponibilidade agora.',
                        'availability'
                    )
                );
            }, timeoutMs);

            this.on('rideAvailabilityResult', onSuccess);
            this.on('rideAvailabilityError', onError);
            this.socket.emit('checkRideAvailability', {
                ...payload,
                requestId
            });
        });
    }

    async driverResponse(bookingId, accepted, reason = null) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Driver response timeout'));
            }, 10000);

            if (accepted) {
                // ✅ NOVO: Listener para erro
                const errorHandler = (error) => {
                    clearTimeout(timeout);
                    this.socket.off('rideAccepted', successHandler);
                    this.socket.off('acceptRideError', errorHandler);
                    reject(new Error(error.error || error.message || 'Driver response failed'));
                };

                // ✅ Listener para sucesso
                const successHandler = (data) => {
                    clearTimeout(timeout);
                    this.socket.off('rideAccepted', successHandler);
                    this.socket.off('acceptRideError', errorHandler);
                    if (data.success !== false && !data.error) {
                        resolve(data);
                    } else {
                        reject(new Error(data.error || 'Driver response failed'));
                    }
                };

                // Configurar listeners ANTES de emitir
                this.socket.on('rideAccepted', successHandler);
                this.socket.on('acceptRideError', errorHandler); // ✅ NOVO
            } else {
                // ✅ NOVO: Listener para erro
                const errorHandler = (error) => {
                    clearTimeout(timeout);
                    this.socket.off('rideRejected', successHandler);
                    this.socket.off('rejectRideError', errorHandler);
                    reject(new Error(error.error || error.message || 'Driver response failed'));
                };

                // ✅ Listener para sucesso
                const successHandler = (data) => {
                    clearTimeout(timeout);
                    this.socket.off('rideRejected', successHandler);
                    this.socket.off('rejectRideError', errorHandler);
                    if (data.success !== false && !data.error) {
                        resolve(data);
                    } else {
                        reject(new Error(data.error || 'Driver response failed'));
                    }
                };

                // Configurar listeners ANTES de emitir
                this.socket.on('rideRejected', successHandler);
                this.socket.on('rejectRideError', errorHandler); // ✅ NOVO
            }

            // Emitir após configurar listeners
            this.socket.emit('driverResponse', { bookingId, accepted, reason });
        });
    }

    // Motorista aceitar corrida (método direto)
    async acceptRide(rideId, driverData = {}) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const expectedRideId = String(rideId || '').trim();
            const expectedDriverId = String(
                driverData?.driver?.id ||
                driverData?.driverId ||
                this.authenticatedUserId ||
                ''
            ).trim();
            const timeout = setTimeout(() => {
                this.socket.off('rideAccepted', successHandler);
                this.socket.off('acceptRideError', errorHandler);
                reject(new Error('Accept ride timeout'));
            }, 15000);

            // ✅ NOVO: Listener para erro (se validação falhar no servidor)
            const errorHandler = (error) => {
                clearTimeout(timeout);
                this.socket.off('rideAccepted', successHandler);
                this.socket.off('acceptRideError', errorHandler);
                reject(new Error(error.error || error.message || 'Accept ride failed'));
            };

            // ✅ Listener para sucesso
            const successHandler = (data) => {
                const payloadRideId = String(data?.bookingId || data?.rideId || '').trim();
                const payloadDriverId = String(data?.driver?.id || data?.driverId || '').trim();

                if (expectedRideId && payloadRideId && payloadRideId !== expectedRideId) {
                    return;
                }

                if (
                    expectedDriverId &&
                    payloadDriverId &&
                    payloadDriverId !== expectedDriverId
                ) {
                    return;
                }

                clearTimeout(timeout);
                this.socket.off('rideAccepted', successHandler);
                this.socket.off('acceptRideError', errorHandler);
                if (data.success !== false && !data.error) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Accept ride failed'));
                }
            };

            // Configurar listeners ANTES de emitir (evita race condition)
            this.socket.on('rideAccepted', successHandler);
            this.socket.on('acceptRideError', errorHandler); // ✅ NOVO

            // Emitir após configurar listeners
            this.socket.emit('acceptRide', { rideId, ...driverData });
        });
    }

    // Motorista rejeitar corrida (método direto)
    async rejectRide(rideId, reason = 'Motorista indisponível') {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Reject ride timeout'));
            }, 10000);

            // ✅ NOVO: Listener para erro (se validação falhar no servidor)
            const errorHandler = (error) => {
                clearTimeout(timeout);
                this.socket.off('rideRejected', successHandler);
                this.socket.off('rejectRideError', errorHandler);
                reject(new Error(error.error || error.message || 'Reject ride failed'));
            };

            // ✅ Listener para sucesso
            const successHandler = (data) => {
                clearTimeout(timeout);
                this.socket.off('rideRejected', successHandler);
                this.socket.off('rejectRideError', errorHandler);
                if (data.success !== false && !data.error) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Reject ride failed'));
                }
            };

            // Configurar listeners ANTES de emitir (evita race condition)
            this.socket.on('rideRejected', successHandler);
            this.socket.on('rejectRideError', errorHandler); // ✅ NOVO

            // Emitir após configurar listeners
            this.socket.emit('rejectRide', { rideId, reason });
        });
    }

    // Motorista chegou ao pickup
    async arriveAtPickup(rideId, location) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Arrive at pickup timeout'));
            }, 10000);

            const bookingId = rideId;

            const cleanup = () => {
                clearTimeout(timeout);
                this.off('arrivedAtPickup', onArrivedAtPickup);
                this.off('notificationActionSuccess', onNotificationSuccess);
                this.off('notificationActionError', onNotificationError);
            };

            const onArrivedAtPickup = (data) => {
                if (data?.bookingId && bookingId && data.bookingId !== bookingId) {
                    return;
                }
                cleanup();
                if (data?.success === false || data?.error) {
                    reject(new Error(data?.error || 'Arrive at pickup failed'));
                    return;
                }
                resolve(data || { success: true, bookingId });
            };

            const onNotificationSuccess = (data) => {
                if (String(data?.action || '').toLowerCase() !== 'arrived_at_pickup') {
                    return;
                }
                if (data?.bookingId && bookingId && data.bookingId !== bookingId) {
                    return;
                }
                cleanup();
                resolve({
                    success: true,
                    bookingId,
                    ...data
                });
            };

            const onNotificationError = (error) => {
                cleanup();
                reject(new Error(error?.error || error?.message || 'Arrive at pickup failed'));
            };

            this.on('arrivedAtPickup', onArrivedAtPickup);
            this.on('notificationActionSuccess', onNotificationSuccess);
            this.on('notificationActionError', onNotificationError);
            this.socket.emit('notificationAction', {
                action: 'arrived_at_pickup',
                bookingId,
                location
            });
        });
    }

    async confirmBoardingStatus(bookingId, boarded = true) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }
        if (!bookingId) {
            throw new Error('bookingId obrigatório para confirmar embarque');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Confirm boarding status timeout'));
            }, 10000);

            const cleanup = () => {
                clearTimeout(timeout);
                this.off('boardingStatusConfirmed', onSuccess);
                this.off('boardingStatusError', onError);
            };

            const onSuccess = (data) => {
                if (data?.bookingId && String(data.bookingId) !== String(bookingId)) {
                    return;
                }
                cleanup();
                if (data?.success === false || data?.error) {
                    reject(new Error(data?.error || 'Boarding confirmation failed'));
                    return;
                }
                resolve(data || { success: true, bookingId, boarded: Boolean(boarded) });
            };

            const onError = (error) => {
                cleanup();
                reject(new Error(error?.error || error?.message || 'Boarding confirmation failed'));
            };

            this.on('boardingStatusConfirmed', onSuccess);
            this.on('boardingStatusError', onError);
            this.socket.emit('confirmBoardingStatus', {
                bookingId,
                boarded: Boolean(boarded)
            });
        });
    }

    async startTrip(bookingId, startLocation) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Start trip timeout'));
            }, 10000);

            this.socket.emit('startTrip', { bookingId, startLocation });

            this.socket.once('tripStarted', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Start trip failed'));
                }
            });
        });
    }

    // Atualizar localização durante corrida
    async updateTripLocation(bookingId, lat, lng, heading = 0, speed = 0) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        this.socket.emit('updateTripLocation', {
            bookingId,
            lat,
            lng,
            heading,
            speed
        });
    }

    async completeTrip(bookingId, endLocation, distance, fare) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Complete trip timeout'));
            }, 10000);

            this.socket.emit('completeTrip', {
                bookingId,
                endLocation,
                distance,
                fare
            });

            this.socket.once('tripCompleted', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Complete trip failed'));
                }
            });
        });
    }

    async confirmPayment(bookingId, paymentMethod, paymentId, amount) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Confirm payment timeout'));
            }, 10000);

            this.socket.emit('confirmPayment', {
                bookingId,
                paymentMethod,
                paymentId,
                amount
            });

            this.socket.once('paymentConfirmed', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Confirm payment failed'));
                }
            });
        });
    }

    // Submeter avaliação
    async submitRating(ratingData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Submit rating timeout'));
            }, 15000);

            this.socket.emit('submitRating', ratingData);
            this.socket.once('ratingSubmitted', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Submit rating failed'));
                }
            });
        });
    }

    // Buscar avaliações de uma viagem
    async getTripRatings(tripId) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Get trip ratings timeout'));
            }, 10000);

            this.socket.emit('getTripRatings', { tripId });
            this.socket.once('tripRatings', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Get trip ratings failed'));
                }
            });
        });
    }

    // Buscar avaliações de um usuário
    async getUserRatings(targetUserId, userType) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Get user ratings timeout'));
            }, 10000);

            this.socket.emit('getUserRatings', { targetUserId, userType });
            this.socket.once('userRatings', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Get user ratings failed'));
                }
            });
        });
    }

    // Verificar se usuário já avaliou uma viagem
    async hasUserRatedTrip(tripId, userType) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Has user rated trip timeout'));
            }, 10000);

            this.socket.emit('hasUserRatedTrip', { tripId, userType });
            this.socket.once('userRatedTrip', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Has user rated trip failed'));
                }
            });
        });
    }

    // ===== MÉTODOS DE CHAT =====

    // Criar ou buscar chat
    async createChat(chatData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Create chat timeout'));
            }, 10000);

            const onSuccess = (data) => {
                clearTimeout(timeout);
                this.socket.off('chat_created', onSuccess);
                this.socket.off('chatCreated', onSuccess);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Create chat failed'));
                }
            };

            this.socket.emit('createChat', chatData);
            this.socket.once('chatCreated', onSuccess);
            // Compatibilidade com payload/evento legado
            this.socket.once('chat_created', onSuccess);
        });
    }

    // Enviar mensagem
    async sendMessage(messageData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Send message timeout'));
            }, 10000);

            const onSuccess = (data) => {
                clearTimeout(timeout);
                this.socket.off('message_sent', onSuccess);
                this.socket.off('messageSent', onSuccess);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Send message failed'));
                }
            };

            this.socket.emit('sendMessage', messageData);
            this.socket.once('messageSent', onSuccess);
            // Compatibilidade com payload/evento legado
            this.socket.once('message_sent', onSuccess);
        });
    }

    // Carregar mensagens do chat
    async loadChatMessages(chatId, page = 0, limit = 20) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Load messages timeout'));
            }, 10000);

            this.socket.emit('load_messages', { chatId, page, limit });
            this.socket.once('messages_loaded', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Load messages failed'));
                }
            });
        });
    }

    // Marcar mensagens como lidas
    async markMessagesAsRead(chatId, messageIds) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Mark messages read timeout'));
            }, 10000);

            this.socket.emit('mark_messages_read', { chatId, messageIds });
            this.socket.once('messages_marked_read', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Mark messages read failed'));
                }
            });
        });
    }

    // Definir status de digitação
    async setTypingStatus(chatId, isTyping) {
        if (!this.socket?.connected) {
            return;
        }

        if (isTyping) {
            this.socket.emit('typing_start', { chatId });
        } else {
            this.socket.emit('typing_stop', { chatId });
        }
    }

    // Buscar chats do usuário
    async getUserChats(limit = 20) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Get user chats timeout'));
            }, 10000);

            this.socket.emit('get_user_chats', { limit });
            this.socket.once('user_chats_loaded', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Get user chats failed'));
                }
            });
        });
    }

    // ===== MÉTODOS DE PROMOÇÕES =====

    // Buscar promoções disponíveis
    async getPromos(filters = {}, page = 0, limit = 20) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Get promos timeout'));
            }, 10000);

            this.socket.emit('get_promos', { filters, page, limit });
            this.socket.once('promos_loaded', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error));
                }
            });
        });
    }

    // Buscar promoções do usuário
    async getUserPromos(filters = {}) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Get user promos timeout'));
            }, 10000);

            this.socket.emit('get_user_promos', { filters });
            this.socket.once('user_promos_loaded', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error));
                }
            });
        });
    }

    // Validar código promocional
    async validatePromoCode(code, orderValue = 0) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Validate promo code timeout'));
            }, 10000);

            this.socket.emit('validate_promo_code', { code, orderValue });
            this.socket.once('promo_code_validated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error));
                }
            });
        });
    }

    // Aplicar promoção
    async applyPromo(promoId, orderData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Apply promo timeout'));
            }, 10000);

            this.socket.emit('apply_promo', { promoId, orderData });
            this.socket.once('promo_applied', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error));
                }
            });
        });
    }

    // Buscar promoção por código
    async getPromoByCode(code) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Get promo by code timeout'));
            }, 10000);

            this.socket.emit('get_promo_by_code', { code });
            this.socket.once('promo_by_code_loaded', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error));
                }
            });
        });
    }

    // ==================== NOVOS MÉTODOS - GERENCIAMENTO DE STATUS DO DRIVER ====================

    // Definir status do driver
    async setDriverStatus(driverId, status, isOnline = true, options = {}) {
        if (!this.socket?.connected) {
            throw buildSocketError(
                { code: 'WS_DISCONNECTED', message: 'WebSocket nao conectado' },
                'Sem conexão com o servidor agora. Verifique sua internet e tente novamente.',
                'driver_status'
            );
        }

        const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : 12000;
        const location = options?.location || null;
        const heading = Number.isFinite(options?.heading) ? options.heading : 0;
        const speed = Number.isFinite(options?.speed) ? options.speed : 0;
        const payload = {
            driverId,
            status,
            isOnline
        };

        if (location && Number.isFinite(location?.lat) && Number.isFinite(location?.lng)) {
            payload.lat = Number(location.lat);
            payload.lng = Number(location.lng);
            payload.heading = Number.isFinite(location?.heading) ? Number(location.heading) : heading;
            payload.speed = Number.isFinite(location?.speed) ? Number(location.speed) : speed;
        }

        return new Promise((resolve, reject) => {
            const buildDriverStatusError = (payload, fallbackCode = 'SET_DRIVER_STATUS_FAILED', fallbackMessage = 'Falha ao atualizar status do motorista.') => {
                const normalizedPayload =
                    payload && typeof payload === 'object'
                        ? payload
                        : { code: fallbackCode, message: String(payload || fallbackMessage) };
                const error = buildSocketError(
                    {
                        ...normalizedPayload,
                        code: normalizedPayload?.code || fallbackCode,
                        message:
                            normalizedPayload?.message ||
                            normalizedPayload?.error ||
                            normalizedPayload?.reason ||
                            fallbackMessage
                    },
                    fallbackMessage,
                    'driver_status'
                );
                if (normalizedPayload?.retryAfterSec) {
                    error.retryAfterSec = normalizedPayload.retryAfterSec;
                }
                return error;
            };

            const matchesDriverStatusPayload = (data) => {
                if (!data || typeof data !== 'object') {
                    return true;
                }

                const payloadDriverId = String(
                    data.driverId ||
                    data.uid ||
                    data.userId ||
                    ''
                ).trim();

                return !payloadDriverId || payloadDriverId === String(driverId || '').trim();
            };

            const cleanup = () => {
                clearTimeout(timeout);
                this.socket.off('driverStatusError', onError);
                this.socket.off('driverStatusUpdated', onSuccess);
                this.socket.off('driver_status_updated', onSuccess);
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(
                    buildDriverStatusError(
                        { code: 'SET_DRIVER_STATUS_TIMEOUT', message: 'Set driver status timeout' },
                        'SET_DRIVER_STATUS_TIMEOUT',
                        'O servidor demorou para responder ao atualizar seu status. Tente novamente.'
                    )
                );
            }, timeoutMs);

            const onSuccess = (data) => {
                if (!matchesDriverStatusPayload(data)) {
                    return;
                }
                cleanup();
                if (data.success) {
                    resolve(data);
                } else {
                    reject(buildDriverStatusError(data));
                }
            };

            const onError = (data) => {
                if (!matchesDriverStatusPayload(data)) {
                    return;
                }
                cleanup();
                reject(buildDriverStatusError(data));
            };

            this.socket.on('driverStatusUpdated', onSuccess);
            this.socket.on('driver_status_updated', onSuccess);
            this.socket.on('driverStatusError', onError);

            try {
                this.socket.emit('setDriverStatus', payload);
            } catch (error) {
                cleanup();
                reject(
                    buildDriverStatusError(
                        error,
                        'SET_DRIVER_STATUS_EMIT_FAILED',
                        'Não foi possível enviar a atualização de status ao servidor.'
                    )
                );
            }
        });
    }

    // Atualizar localização do driver (evento canônico do backend)
    async updateLocation(driverId, lat, lng, heading = 0, speed = 0) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Update driver location timeout'));
            }, 10000);

            this.socket.emit('updateLocation', {
                uid: driverId,
                driverId,
                lat,
                lng,
                heading,
                speed,
                timestamp: Date.now()
            });
            this.socket.once('locationUpdated', (data) => {
                clearTimeout(timeout);
                if (data?.success !== false) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Update driver location failed'));
                }
            });
        });
    }

    // Compatibilidade temporária para chamadas legadas no app.
    async updateDriverLocation(driverId, lat, lng, heading = 0, speed = 0) {
        return this.updateLocation(driverId, lat, lng, heading, speed);
    }

    // Localização do passageiro durante corrida ativa (monitoramento de tripulação)
    async updatePassengerLocation(bookingId, lat, lng, heading = 0, speed = 0) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }
        if (!bookingId) {
            throw new Error('bookingId obrigatório para updatePassengerLocation');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Update passenger location timeout'));
            }, 10000);

            const cleanup = () => {
                clearTimeout(timeout);
                this.off('passengerLocationUpdated', onSuccess);
                this.off('passengerLocationError', onError);
            };

            const onSuccess = (data) => {
                if (data?.bookingId && String(data.bookingId) !== String(bookingId)) {
                    return;
                }
                cleanup();
                if (data?.success === false || data?.error) {
                    reject(new Error(data?.error || 'Update passenger location failed'));
                    return;
                }
                resolve(data || { success: true, bookingId });
            };

            const onError = (error) => {
                cleanup();
                reject(new Error(error?.error || error?.message || 'Update passenger location failed'));
            };

            this.on('passengerLocationUpdated', onSuccess);
            this.on('passengerLocationError', onError);
            this.socket.emit('passengerLocationUpdate', {
                bookingId,
                lat,
                lng,
                heading,
                speed,
                timestamp: Date.now()
            });
        });
    }

    // ==================== NOVOS MÉTODOS - BUSCA E MATCHING DE DRIVERS ====================

    // Buscar motoristas próximos
    async searchDrivers(pickupLocation, destinationLocation, rideType = 'standard', estimatedFare = 0, preferences = {}) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Search drivers timeout'));
            }, 15000);

            this.socket.emit('searchDrivers', {
                pickupLocation,
                destinationLocation,
                rideType,
                estimatedFare,
                preferences
            });
            this.socket.once('driversFound', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Search drivers failed'));
                }
            });
        });
    }

    // Cancelar busca de motoristas
    async cancelDriverSearch(bookingId, reason = 'Cancelado pelo usuário') {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Cancel driver search timeout'));
            }, 10000);

            this.socket.emit('cancelDriverSearch', { bookingId, reason });
            this.socket.once('driverSearchCancelled', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Cancel driver search failed'));
                }
            });
        });
    }

    // ==================== NOVOS MÉTODOS - GERENCIAMENTO DE CORRIDAS ====================

    // Cancelar corrida (com reembolso automático PIX)
    async cancelRide(bookingId, reason = 'Cancelado pelo usuário', cancellationFee = 0) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Cancel ride timeout'));
            }, 10000);

            this.socket.emit('cancelRide', { bookingId, reason, cancellationFee });
            this.socket.once('rideCancelled', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Cancel ride failed'));
                }
            });
        });
    }

    // ==================== NOVOS MÉTODOS - SISTEMA DE SEGURANÇA ====================

    // Reportar incidente
    async reportIncident(type, description, evidence = [], location = null) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Report incident timeout'));
            }, 10000);

            this.socket.emit('reportIncident', { type, description, evidence, location });
            this.socket.once('incidentReported', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Report incident failed'));
                }
            });
        });
    }

    // Contato de emergência
    async emergencyContact(contactType, location = null, message = 'Solicitação de emergência') {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Emergency contact timeout'));
            }, 10000);

            this.socket.emit('emergencyContact', { contactType, location, message });
            this.socket.once('emergencyContacted', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Emergency contact failed'));
                }
            });
        });
    }

    // ==================== NOVOS MÉTODOS - SISTEMA DE SUPORTE ====================

    // Criar ticket de suporte
    async createSupportTicket(type, priority = 'N3', description, attachments = []) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Create support ticket timeout'));
            }, 10000);

            this.socket.emit('createSupportTicket', { type, priority, description, attachments });
            this.socket.once('supportTicketCreated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Create support ticket failed'));
                }
            });
        });
    }

    // ==================== NOVOS MÉTODOS - NOTIFICAÇÕES AVANÇADAS ====================

    // Atualizar preferências de notificação
    async updateNotificationPreferences(preferences) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Update notification preferences timeout'));
            }, 10000);

            this.socket.emit('updateNotificationPreferences', preferences);
            this.socket.once('notificationPreferencesUpdated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Update notification preferences failed'));
                }
            });
        });
    }

    // ==================== NOVOS MÉTODOS - ANALYTICS E FEEDBACK ====================

    // Rastrear ação do usuário
    async trackUserAction(action, actionData = {}, timestamp = null) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Track user action timeout'));
            }, 10000);

            this.socket.emit('trackUserAction', { action, data: actionData, timestamp });
            this.socket.once('userActionTracked', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Track user action failed'));
                }
            });
        });
    }

    // Enviar feedback
    async submitFeedback(type, rating, comments = '', suggestions = '') {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Submit feedback timeout'));
            }, 10000);

            this.socket.emit('submitFeedback', { type, rating, comments, suggestions });
            this.socket.once('feedbackReceived', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Submit feedback failed'));
                }
            });
        });
    }

    // ==================== NOVOS MÉTODOS - NOTIFICAÇÕES FCM ====================

    // Registrar token FCM
    async registerFCMToken(tokenData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Register FCM token timeout'));
            }, 10000);

            this.socket.emit('registerFCMToken', tokenData);

            const onRegistered = (data) => {
                cleanup();
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Register FCM token failed'));
                }
            };

            const onError = (error) => {
                cleanup();
                reject(new Error(error.error || 'Register FCM token error event'));
            };

            const cleanup = () => {
                clearTimeout(timeout);
                this.socket.off('fcmTokenRegistered', onRegistered);
                this.socket.off('fcmTokenError', onError);
            };

            this.socket.once('fcmTokenRegistered', onRegistered);
            this.socket.once('fcmTokenError', onError);
        });
    }

    // Desregistrar token FCM
    async unregisterFCMToken(tokenData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Unregister FCM token timeout'));
            }, 10000);

            this.socket.emit('unregisterFCMToken', tokenData);
            this.socket.once('fcmTokenUnregistered', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Unregister FCM token failed'));
                }
            });
        });
    }

    // Enviar notificação
    async sendNotification(notificationData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Send notification timeout'));
            }, 10000);

            this.socket.emit('sendNotification', notificationData);
            this.socket.once('notificationSent', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Send notification failed'));
                }
            });
        });
    }

    // Enviar notificação para usuário específico
    async sendNotificationToUser(userId, notification) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Send notification to user timeout'));
            }, 10000);

            this.socket.emit('sendNotificationToUser', {
                userId,
                notification,
                timestamp: new Date().toISOString()
            });
            this.socket.once('notificationSentToUser', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Send notification to user failed'));
                }
            });
        });
    }

    // Enviar notificação para todos os usuários de um tipo
    async sendNotificationToUserType(userType, notification) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Send notification to user type timeout'));
            }, 10000);

            this.socket.emit('sendNotificationToUserType', {
                userType,
                notification,
                timestamp: new Date().toISOString()
            });
            this.socket.once('notificationSentToUserType', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                }
            });
        });
    }

    // ==================== NOVOS MÉTODOS - EXTENSÃO DE CORRIDA (MUDANÇA DE DESTINO) ====================

    /**
     * Solicita extensão de corrida com cobrança adicional via Pix.
     * @param {string} rideId 
     * @param {object} newDrop {lat, lng, add}
     * @param {number} newFare 
     */
    async requestRideExtension(rideId, newDrop, newFare) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                this.socket.off('rideExtensionRequestAccepted', onAccepted);
                this.socket.off('rideExtensionError', onError);
            };

            const onAccepted = (data) => {
                cleanup();
                if (data?.success === false || data?.error) {
                    reject(new Error(data?.error || 'Request ride extension failed'));
                    return;
                }
                resolve(data);
            };

            const onError = (data) => {
                cleanup();
                reject(new Error(data?.error || data?.message || 'Request ride extension failed'));
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Request ride extension timeout'));
            }, 10000);

            this.socket.on('rideExtensionRequestAccepted', onAccepted);
            this.socket.on('rideExtensionError', onError);
            this.socket.emit('requestRideExtension', {
                bookingId: rideId,
                newEndLocation: newDrop,
                newFare
            });
        });
    }

    async respondRideExtension(rideId, accepted, options = {}) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                this.socket.off('rideExtensionPendingPayment', onPendingPayment);
                this.socket.off('rideExtensionRejected', onRejected);
                this.socket.off('rideExtensionResponseError', onError);
            };

            const onPendingPayment = (data) => {
                cleanup();
                resolve(data);
            };

            const onRejected = (data) => {
                cleanup();
                resolve(data);
            };

            const onError = (data) => {
                cleanup();
                reject(new Error(data?.error || data?.message || 'Ride extension response failed'));
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Respond ride extension timeout'));
            }, 10000);

            this.socket.on('rideExtensionPendingPayment', onPendingPayment);
            this.socket.on('rideExtensionRejected', onRejected);
            this.socket.on('rideExtensionResponseError', onError);
            this.socket.emit('respondRideExtension', {
                bookingId: rideId,
                accepted: Boolean(accepted),
                ...options
            });
        });
    }

    /**
     * Solicita simples mudança de destino (mais barato ou igual)
     * @param {string} rideId 
     * @param {object} newDrop {lat, lng, add}
     */
    async changeDestination(rideId, newDrop) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                this.socket.off('destinationChanged', onChanged);
                this.socket.off('changeDestinationError', onError);
            };

            const onChanged = (data) => {
                cleanup();
                if (data?.success) {
                    resolve(data);
                } else {
                    reject(new Error(data?.error || 'Change destination failed'));
                }
            };

            const onError = (data) => {
                cleanup();
                reject(new Error(data?.error || data?.message || 'Change destination failed'));
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Change destination timeout'));
            }, 10000);

            this.socket.on('destinationChanged', onChanged);
            this.socket.on('changeDestinationError', onError);
            this.socket.emit('changeDestination', {
                bookingId: rideId,
                newDestination: newDrop
            });
        });
    }

    async endTripEarlyByRider(bookingId, endLocation, distanceKm = 0, durationSecs = 0, reason = 'EARLY_DROPOFF_BY_RIDER') {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                this.socket.off('tripCompleted', onCompleted);
                this.socket.off('tripCompleteError', onError);
            };

            const onCompleted = (data) => {
                cleanup();
                if (data?.success) {
                    resolve(data);
                } else {
                    reject(new Error(data?.error || 'End trip early failed'));
                }
            };

            const onError = (data) => {
                cleanup();
                reject(new Error(data?.error || data?.message || 'End trip early failed'));
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('End trip early timeout'));
            }, 12000);

            this.socket.on('tripCompleted', onCompleted);
            this.socket.on('tripCompleteError', onError);
            this.socket.emit('endTripEarlyByRider', {
                bookingId,
                endLocation,
                distanceKm,
                durationSecs,
                reason
            });
        });
    }

    async interruptRideOperational(
        bookingId,
        interruptionLocation,
        distanceKm = 0,
        durationSecs = 0,
        reason = 'VEHICLE_BREAKDOWN',
        note = ''
    ) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                this.socket.off('rideOperationalInterrupted', onInterrupted);
                this.socket.off('rideOperationalInterruptionError', onError);
            };

            const onInterrupted = (payload) => {
                cleanup();
                if (payload?.success === false || payload?.error) {
                    reject(new Error(payload?.error || 'Operational interruption failed'));
                    return;
                }
                resolve(payload);
            };

            const onError = (payload) => {
                cleanup();
                reject(new Error(payload?.error || payload?.message || 'Operational interruption failed'));
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Operational interruption timeout'));
            }, 12000);

            this.socket.on('rideOperationalInterrupted', onInterrupted);
            this.socket.on('rideOperationalInterruptionError', onError);
            this.socket.emit('interruptRideOperational', {
                bookingId,
                interruptionLocation,
                distanceKm,
                durationSecs,
                reason,
                note
            });
        });
    }

    async respondOperationalContinuation(bookingId, continueTrip) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                this.socket.off('rideOperationalContinuationSearching', onSearching);
                this.socket.off('tripCompleted', onTripCompleted);
                this.socket.off('rideOperationalContinuationError', onError);
            };

            const onSearching = (payload) => {
                if (payload?.bookingId && String(payload.bookingId) !== String(bookingId)) {
                    return;
                }
                cleanup();
                resolve(payload);
            };

            const onTripCompleted = (payload) => {
                if (payload?.bookingId && String(payload.bookingId) !== String(bookingId)) {
                    return;
                }
                cleanup();
                resolve(payload);
            };

            const onError = (payload) => {
                cleanup();
                reject(new Error(payload?.error || payload?.message || 'Operational continuation failed'));
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Operational continuation timeout'));
            }, 15000);

            this.socket.on('rideOperationalContinuationSearching', onSearching);
            this.socket.on('tripCompleted', onTripCompleted);
            this.socket.on('rideOperationalContinuationError', onError);
            this.socket.emit('respondOperationalContinuation', {
                bookingId,
                continueTrip: Boolean(continueTrip)
            });
        });
    }

    async syncActiveRideWithAck(timeoutMs = ACTIVE_RIDE_SYNC_TIMEOUT_MS) {
        if (!this.socket?.connected) {
            throw buildSocketError(
                { code: 'WS_DISCONNECTED', message: 'WebSocket nao conectado' },
                'Sem conexao com o servidor agora. Verifique sua internet e tente novamente.',
                'ride_sync'
            );
        }

        if (!this.authenticatedUserId || !this.authenticatedUserType) {
            throw buildSocketError(
                { code: 'AUTH_REQUIRED', message: 'Usuario nao autenticado' },
                'A sessao ainda nao foi validada. Tente novamente.',
                'ride_sync'
            );
        }

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                this.off('activeRideSync', onSync);
                clearTimeout(timeout);
            };

            const onSync = (payload) => {
                cleanup();
                if (!payload?.success) {
                    reject(
                        buildSocketError(
                            payload,
                            'Nao foi possivel sincronizar sua corrida ativa agora.',
                            'ride_sync'
                        )
                    );
                    return;
                }
                resolve(payload);
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(
                    buildSocketError(
                        { code: 'RIDE_SYNC_TIMEOUT', message: `Timeout ao sincronizar corrida ativa (${Math.floor(timeoutMs / 1000)}s)` },
                        'A sincronizacao da corrida ativa demorou mais que o esperado.',
                        'ride_sync'
                    )
                );
            }, timeoutMs);

            this.on('activeRideSync', onSync);
            this.socket.emit('syncActiveRide', {
                uid: this.authenticatedUserId,
                userType: this.authenticatedUserType
            });
        });
    }

    _rehydrateRideEventsFromSync(snapshot) {
        if (!snapshot?.success || !snapshot?.hasActiveRide) {
            return;
        }

        const status = String(snapshot.status || '').toUpperCase();
        const payload = {
            success: true,
            bookingId: snapshot.bookingId,
            driverId: snapshot.driverId || null,
            customerId: snapshot.customerId || null,
            location: snapshot.driverLocation || null,
            pickupLocation: snapshot.pickupLocation || null,
            destinationLocation: snapshot.destinationLocation || null,
            estimatedFare: snapshot.estimatedFare,
            finalFare: snapshot.finalFare,
            operationalFee: snapshot.operationalFee ?? null,
            paymentIntermediationFee: snapshot.paymentIntermediationFee ?? null,
            totalFees: snapshot.totalFees ?? null,
            driverNetAmount: snapshot.driverNetAmount ?? null,
            estimatedOperationalFee: snapshot.estimatedOperationalFee ?? null,
            estimatedPaymentIntermediationFee: snapshot.estimatedPaymentIntermediationFee ?? null,
            estimatedTotalFees: snapshot.estimatedTotalFees ?? null,
            estimatedDriverNetAmount: snapshot.estimatedDriverNetAmount ?? null,
            pricingSnapshotLocked: snapshot.pricingSnapshotLocked === true,
            pricingSnapshotLockedAt: snapshot.pricingSnapshotLockedAt || null,
            boardingDeadlineAt: snapshot.boardingDeadlineAt || null,
            boardingWindowSec: snapshot.boardingWindowSec ?? null,
            paymentStatus: snapshot.paymentStatus || null,
            rehydrated: true,
            syncedAt: snapshot.syncedAt || new Date().toISOString()
        };

        this.eventEmitter.emit('activeRideRehydrated', payload);

        if (['MATCHED', 'ACCEPTED'].includes(status)) {
            this.eventEmitter.emit('rideAccepted', payload);
            return;
        }

        if (['IN_PROGRESS', 'STARTED'].includes(status)) {
            this.eventEmitter.emit('tripStarted', payload);
        }
    }
}

export default WebSocketManager; 
