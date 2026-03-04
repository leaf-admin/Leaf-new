import Logger from '../utils/Logger';
import io from 'socket.io-client';
import { getWebSocketURL } from '../config/NetworkConfig';
import auth from '@react-native-firebase/auth';


// ✅ CORREÇÃO: Calcular URL dinamicamente para evitar problemas em builds de release
// Não armazenar como constante, calcular sempre que necessário

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
            this.connectionAttempts = 0;
            this.maxConnectionAttempts = 5; // ✅ Aumentado para 5 tentativas
            this.eventListeners = new Map(); // ✅ Manter para compatibilidade temporária
            this.pendingListeners = []; // ✅ Inicializar pendingListeners
            this._connectHandlers = new Set(); // ✅ FASE 1: Rastrear handlers de conexão para evitar duplicação
            this.isAuthenticated = false; // ✅ Rastrear estado de autenticação
            this.authenticatedUserId = null; // ✅ ID do usuário autenticado
            this.authenticatedUserType = null; // ✅ Tipo do usuário autenticado
            this.authCredentials = null; // ✅ Armazenar credenciais para auto-reautenticação
            this.isAuthenticating = false; // ✅ Flag para evitar autenticação duplicada

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

    async connect() {
        if (this.socket?.connected) {
            Logger.log('✅ [WebSocketManager] Já conectado, ignorando nova conexão');
            return;
        }

        if (this.isConnecting) {
            Logger.log('⏳ [WebSocketManager] Conexão já em andamento, aguardando...');
            return;
        }

        try {
            this.isConnecting = true;
            this.connectionAttempts = 0;

            // ✅ CORREÇÃO: Calcular URL dinamicamente para garantir que está correta
            const WEBSOCKET_URL = getWebSocketURL();
            Logger.log('🔌 [WebSocketManager] Conectando ao WebSocket:', WEBSOCKET_URL);

            // ✅ Se já existe um socket, desconectar primeiro
            if (this.socket) {
                Logger.log('🔌 [WebSocketManager] Desconectando socket anterior...');
                this.socket.removeAllListeners();
                this.socket.disconnect();
                this.socket = null;
            }

            // ✅ CORREÇÃO: Tentar websocket primeiro, polling como fallback
            // Polling pode ter problemas em React Native, websocket é mais confiável
            const transports = ['websocket', 'polling'];

            Logger.log('🔌 [WebSocketManager] Configuração de transporte:', {
                transports,
                url: WEBSOCKET_URL,
                isDev: __DEV__
            });

            // ✅ Buscar token do Firebase para autenticação segura
            let userToken = null;
            try {
                const currentUser = auth().currentUser;
                if (currentUser) {
                    userToken = await currentUser.getIdToken();
                }
            } catch (tokenError) {
                Logger.warn('⚠️ [WebSocketManager] Erro ao obter token do Firebase:', tokenError);
            }

            this.socket = io(WEBSOCKET_URL, {
                // ✅ Passar token JWT na conexão (handshake)
                auth: { token: userToken },
                // ✅ Ignorar verificação de certificado SSL para IP direto (se usar HTTPS)
                rejectUnauthorized: false,
                // ✅ Permitir certificados auto-assinados
                transports: transports,
                reconnection: true,
                reconnectionDelay: 3000,
                reconnectionDelayMax: 10000,
                reconnectionAttempts: 5,
                timeout: 20000, // 20 segundos
                forceNew: true, // ✅ Forçar nova conexão para evitar cache
                upgrade: true,
                rememberUpgrade: false, // ✅ Não lembrar upgrade para evitar problemas
                // ✅ Configurações adicionais para React Native
                autoConnect: true,
                // ✅ Headers extras para React Native
                extraHeaders: {},
                // ✅ Configurações de ping
                pingTimeout: 60000,
                pingInterval: 25000,
                // ✅ Permitir EIO3 e EIO4
                allowEIO3: true,
                allowEIO4: true,
            });

            this.setupListeners();

        } catch (error) {
            Logger.error('❌ [WebSocketManager] Erro ao inicializar WebSocket:', error.message);
            Logger.error('❌ [WebSocketManager] Stack:', error.stack);
            this.isConnecting = false;
            throw error; // ✅ Re-throw para que o chamador possa tratar
        }
    }

    setupListeners() {
        if (!this.socket) return;

        // ✅ FASE 2: Registrar eventos do servidor APENAS UMA VEZ
        // Lista de eventos que o servidor pode enviar
        const serverEvents = [
            'rideRequest',
            'newBookingAvailable',
            'newRideRequest', // ✅ Evento do DriverNotificationDispatcher 
            'rideAccepted',
            'rideRejected',
            'tripStarted',
            'tripCompleted',
            'paymentConfirmed',
            'ratingReceived',
            'authenticated', // ✅ Evento de autenticação confirmada
            'driverStatusChanged',
            'locationUpdated'
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
            });
            this.socketListeners.add('authenticated');
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

            // ✅ AUTO-REAUTENTICAÇÃO: Se já tínhamos credenciais, re-autenticar automaticamente
            if (this.authCredentials) {
                Logger.log('🔐 [WebSocketManager] Reconectado. Iniciando auto-reautenticação...');
                this.authenticate(this.authCredentials.userId, this.authCredentials.userType);
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
            const errorMessage = error.message || 'Erro desconhecido';
            Logger.error('❌ [WebSocketManager] Erro de conexão WebSocket:', errorMessage);
            Logger.error('❌ [WebSocketManager] Tipo de erro:', error.type || 'N/A');
            Logger.error('❌ [WebSocketManager] Descrição:', error.description || 'N/A');

            this.isConnecting = false;
            this.connectionAttempts++;

            // ✅ Emitir erro através do EventEmitter
            this.eventEmitter.emit('connect_error', error);

            // ✅ Se for timeout, tentar reconectar automaticamente
            if (errorMessage.includes('timeout') || error.type === 'TransportError') {
                Logger.log(`🔄 [WebSocketManager] Timeout detectado. Tentativa ${this.connectionAttempts}/${this.maxConnectionAttempts}`);

                if (this.connectionAttempts < this.maxConnectionAttempts) {
                    const delay = Math.min(3000 * this.connectionAttempts, 10000); // Delay exponencial até 10s
                    Logger.log(`⏳ [WebSocketManager] Tentando reconectar em ${delay}ms...`);
                    setTimeout(() => {
                        if (!this.socket?.connected) {
                            this.connect();
                        }
                    }, delay);
                } else {
                    Logger.log('🔌 [WebSocketManager] Máximo de tentativas de conexão atingido. Tentando reconectar em 30 segundos...');
                    setTimeout(() => {
                        this.connectionAttempts = 0;
                        if (!this.socket?.connected) {
                            this.connect();
                        }
                    }, 30000);
                }
            } else if (this.connectionAttempts >= this.maxConnectionAttempts) {
                Logger.log('🔌 [WebSocketManager] Máximo de tentativas de conexão atingido. Tentando reconectar em 30 segundos...');
                setTimeout(() => {
                    this.connectionAttempts = 0;
                    if (!this.socket?.connected) {
                        this.connect();
                    }
                }, 30000);
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
    authenticate(userId, userType) {
        if (!this.socket?.connected) {
            Logger.warn('⚠️ [WebSocketManager] WebSocket não conectado. Não é possível autenticar.');
            return;
        }

        // ✅ Evitar autenticação duplicada se já está autenticado com os mesmos dados
        if (this.isAuthenticated &&
            this.authenticatedUserId === userId &&
            this.authenticatedUserType === userType) {
            Logger.log('✅ [WebSocketManager] Já autenticado com esses dados, ignorando');
            return;
        }

        // ✅ Evitar múltiplas tentativas simultâneas
        if (this.isAuthenticating) {
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

        this.socket.emit('authenticate', {
            uid: userId,
            userType: userType
        });

        // Resetar flag após 3 segundos (tempo suficiente para resposta)
        setTimeout(() => {
            this.isAuthenticating = false;
        }, 3000);

        // O listener 'authenticated' já está registrado em setupListeners()
        // e atualizará automaticamente isAuthenticated quando o servidor confirmar
    }

    // Métodos específicos para eventos de viagem
    async createBooking(bookingData) {
        Logger.log('📤 [WebSocketManager] Criando booking...', {
            connected: this.socket?.connected,
            socketId: this.socket?.id,
            bookingData: {
                customerId: bookingData.customerId,
                carType: bookingData.carType,
                estimatedFare: bookingData.estimatedFare
            }
        });

        if (!this.socket?.connected) {
            const error = new Error('WebSocket não conectado');
            Logger.error('❌ [WebSocketManager] Erro ao criar booking:', error.message);
            throw error;
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                Logger.error('❌ [WebSocketManager] Timeout ao criar booking (15s)');
                reject(new Error('Create booking timeout'));
            }, 15000);

            Logger.log('📤 [WebSocketManager] Emitindo evento createBooking...');
            this.socket.emit('createBooking', bookingData);

            this.socket.once('bookingCreated', (data) => {
                Logger.log('✅ [WebSocketManager] Resposta bookingCreated recebida:', data);
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    const error = new Error(data.error || 'Create booking failed');
                    Logger.error('❌ [WebSocketManager] Erro na resposta:', error.message);
                    reject(error);
                }
            });

            // ✅ Adicionar listener para erros do servidor
            this.socket.once('bookingError', (error) => {
                Logger.error('❌ [WebSocketManager] Erro do servidor:', error);
                clearTimeout(timeout);
                reject(new Error(error.message || 'Erro ao criar booking'));
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
            const timeout = setTimeout(() => {
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

            this.socket.emit('arriveAtPickup', { rideId, location });
            this.socket.once('arrivedAtPickup', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Arrive at pickup failed'));
                }
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

            this.socket.emit('create_chat', chatData);
            this.socket.once('chat_created', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Create chat failed'));
                }
            });
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

            this.socket.emit('send_message', messageData);
            this.socket.once('message_sent', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Send message failed'));
                }
            });
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
    async setDriverStatus(driverId, status, isOnline = true) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Set driver status timeout'));
            }, 10000);

            this.socket.emit('setDriverStatus', { driverId, status, isOnline });
            this.socket.once('driverStatusUpdated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Set driver status failed'));
                }
            });
        });
    }

    // Atualizar localização do driver
    async updateDriverLocation(driverId, lat, lng, heading = 0, speed = 0) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Update driver location timeout'));
            }, 10000);

            this.socket.emit('updateDriverLocation', { driverId, lat, lng, heading, speed });
            this.socket.once('locationUpdated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Update driver location failed'));
                }
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

    // ==================== NOVOS MÉTODOS - CHAT E COMUNICAÇÃO ====================

    // Criar chat (método atualizado)
    async createChat(chatData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Create chat timeout'));
            }, 10000);

            this.socket.emit('createChat', chatData);
            this.socket.once('chatCreated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Create chat failed'));
                }
            });
        });
    }

    // Enviar mensagem (método atualizado)
    async sendMessage(messageData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Send message timeout'));
            }, 10000);

            this.socket.emit('sendMessage', messageData);
            this.socket.once('messageSent', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Send message failed'));
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
            const timeout = setTimeout(() => {
                reject(new Error('Request ride extension timeout'));
            }, 10000);

            this.socket.emit('requestRideExtension', { rideId, newDrop, newFare });

            // Note: In an event-driven system, the actual confirmation comes later.
            // But we can listen for an immediate acknowledgment if available.
            this.socket.once('rideExtensionRequested', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Request ride extension failed'));
                }
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
            const timeout = setTimeout(() => {
                reject(new Error('Change destination timeout'));
            }, 10000);

            this.socket.emit('changeDestination', { rideId, newDrop });
            this.socket.once('destinationChanged', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Change destination failed'));
                }
            });
        });
    }
}

export default WebSocketManager; 