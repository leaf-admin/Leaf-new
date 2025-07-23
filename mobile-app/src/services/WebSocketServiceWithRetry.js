import { io } from 'socket.io-client';

class WebSocketServiceWithRetry {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.retryAttempts = 0;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 segundo inicial
        this.maxRetryDelay = 10000; // 10 segundos máximo
        this.connectionPromise = null;
        this.eventListeners = new Map();
        this.authenticated = false;
        this.userId = null;
    }

    // Configurações de conexão otimizadas
    getConnectionConfig() {
        return {
            transports: ['websocket', 'polling'],
            timeout: 15000, // 15 segundos
            forceNew: true,
            reconnection: false, // Gerenciamos reconexão manualmente
            // Configurações de performance
            maxHttpBufferSize: 1e6, // 1MB
            pingTimeout: 60000, // 60 segundos
            pingInterval: 25000, // 25 segundos
            upgradeTimeout: 10000, // 10 segundos
            // Configurações de concorrência
            connectTimeout: 45000, // 45 segundos
        };
    }

    // Conectar com retry automático
    async connect(serverUrl = 'http://localhost:3001') {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connectionPromise = this._connectWithRetry(serverUrl);
        return this.connectionPromise;
    }

    async _connectWithRetry(serverUrl) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`🔌 Tentativa de conexão ${attempt}/${this.maxRetries}`);
                
                const socket = io(serverUrl, this.getConnectionConfig());
                
                const connectionResult = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Connection timeout'));
                    }, 15000);
                    
                    socket.on('connect', () => {
                        clearTimeout(timeout);
                        console.log(`✅ Conectado na tentativa ${attempt}`);
                        this.socket = socket;
                        this.isConnected = true;
                        this.retryAttempts = 0;
                        this._setupEventListeners();
                        resolve(socket);
                    });
                    
                    socket.on('connect_error', (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                
                return connectionResult;
                
            } catch (error) {
                console.log(`❌ Tentativa ${attempt} falhou: ${error.message}`);
                
                if (attempt < this.maxRetries) {
                    // Backoff exponencial
                    const waitTime = Math.min(
                        this.retryDelay * Math.pow(2, attempt - 1),
                        this.maxRetryDelay
                    );
                    
                    console.log(`⏳ Aguardando ${waitTime}ms antes da próxima tentativa...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    console.log('❌ Todas as tentativas falharam');
                    throw new Error(`Falha na conexão após ${this.maxRetries} tentativas: ${error.message}`);
                }

    // Autenticar usuário
    async authenticate(uid) {
        if (!this.socket || !this.isConnected) {
            throw new Error('Socket não está conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Authentication timeout'));
            }, 10000);

            this.socket.emit('authenticate', { uid });
            
            this.socket.once('authenticated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    this.authenticated = true;
                    this.userId = uid;
                    console.log(`🔐 Usuário autenticado: ${uid}`);
                    resolve(data);
                } else {
                    reject(new Error('Authentication failed'));
                }
            });
    }

    // Configurar listeners de eventos
    _setupEventListeners() {
        if (!this.socket) return;

        this.socket.on('disconnect', (reason) => {
            console.log(`🔌 Desconectado: ${reason}`);
            this.isConnected = false;
            this.authenticated = false;
            this._notifyListeners('disconnect', reason);
        });

        this.socket.on('connect_error', (error) => {
            console.log(`❌ Erro de conexão: ${error.message}`);
            this.isConnected = false;
            this._notifyListeners('connect_error', error);
        });

        this.socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`🔄 Tentativa de reconexão: ${attemptNumber}`);
            this._notifyListeners('reconnect_attempt', attemptNumber);
        });
    }

    // Sistema de listeners
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }

    off(event, callback) {
        if (this.eventListeners.has(event)) {
            
            if (index > -1) {
                listeners.splice(index, 1);
            }

    _notifyListeners(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Erro no listener ${event}:`, error);
                }
            });
        }

    // Métodos de comunicação
    emit(event, data) {
        if (!this.socket || !this.isConnected) {
            throw new Error('Socket não está conectado');
        }
        this.socket.emit(event, data);
    }

    // Atualizar localização com retry
    async updateLocation(lat, lng) {
        if (!this.authenticated) {
            throw new Error('Usuário não autenticado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Update location timeout'));
            }, 10000);

            this.emit('updateLocation', { lat, lng });
            
            this.socket.once('locationUpdated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Update location failed'));
                }
            });
    }

    // Buscar motoristas próximos com retry
    async findNearbyDrivers(lat, lng, radius = 5000, limit = 10) {
        if (!this.authenticated) {
            throw new Error('Usuário não autenticado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Find drivers timeout'));
            }, 15000);

            this.emit('findNearbyDrivers', { lat, lng, radius, limit });
            
            this.socket.once('nearbyDrivers', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Find drivers failed'));
                }
            });
    }

    // Finalizar viagem
    async finishTrip(tripData) {
        if (!this.authenticated) {
            throw new Error('Usuário não autenticado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Finish trip timeout'));
            }, 10000);

            this.emit('finishTrip', tripData);
            
            this.socket.once('tripFinished', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Finish trip failed'));
                }
            });
    }

    // Cancelar viagem
    async cancelTrip(tripData) {
        if (!this.authenticated) {
            throw new Error('Usuário não autenticado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Cancel trip timeout'));
            }, 10000);

            this.emit('cancelTrip', tripData);
            
            this.socket.once('tripCancelled', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Cancel trip failed'));
                }
            });
    }

    // Desconectar
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
            this.authenticated = false;
            this.connectionPromise = null;
            console.log('🔌 Desconectado manualmente');
        }

    // Verificar status
    getStatus() {
        return {
            isConnected: this.isConnected,
            authenticated: this.authenticated,
            userId: this.userId,
            retryAttempts: this.retryAttempts
        };
    }

// Instância singleton
const webSocketService = new WebSocketServiceWithRetry();

export default webSocketService; 

class WebSocketServiceWithRetry {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.retryAttempts = 0;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 segundo inicial
        this.maxRetryDelay = 10000; // 10 segundos máximo
        this.connectionPromise = null;
        this.eventListeners = new Map();
        this.authenticated = false;
        this.userId = null;
    }

    // Configurações de conexão otimizadas
    getConnectionConfig() {
        return {
            transports: ['websocket', 'polling'],
            timeout: 15000, // 15 segundos
            forceNew: true,
            reconnection: false, // Gerenciamos reconexão manualmente
            // Configurações de performance
            maxHttpBufferSize: 1e6, // 1MB
            pingTimeout: 60000, // 60 segundos
            pingInterval: 25000, // 25 segundos
            upgradeTimeout: 10000, // 10 segundos
            // Configurações de concorrência
            connectTimeout: 45000, // 45 segundos
        };
    }

    // Conectar com retry automático
    async connect(serverUrl = 'http://localhost:3001') {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connectionPromise = this._connectWithRetry(serverUrl);
        return this.connectionPromise;
    }

    async _connectWithRetry(serverUrl) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`🔌 Tentativa de conexão ${attempt}/${this.maxRetries}`);
                
                
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }

    _notifyListeners(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Erro no listener ${event}:`, error);
                }
            });
        }

    // Métodos de comunicação
    emit(event, data) {
        if (!this.socket || !this.isConnected) {
            throw new Error('Socket não está conectado');
        }
        this.socket.emit(event, data);
    }

    // Atualizar localização com retry
    async updateLocation(lat, lng) {
        if (!this.authenticated) {
            throw new Error('Usuário não autenticado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Update location timeout'));
            }, 10000);

            this.emit('updateLocation', { lat, lng });
            
            this.socket.once('locationUpdated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Update location failed'));
                }
            });
    }

    // Buscar motoristas próximos com retry
    async findNearbyDrivers(lat, lng, radius = 5000, limit = 10) {
        if (!this.authenticated) {
            throw new Error('Usuário não autenticado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Find drivers timeout'));
            }, 15000);

            this.emit('findNearbyDrivers', { lat, lng, radius, limit });
            
            this.socket.once('nearbyDrivers', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Find drivers failed'));
                }
            });
    }

    // Finalizar viagem
    async finishTrip(tripData) {
        if (!this.authenticated) {
            throw new Error('Usuário não autenticado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Finish trip timeout'));
            }, 10000);

            this.emit('finishTrip', tripData);
            
            this.socket.once('tripFinished', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Finish trip failed'));
                }
            });
    }

    // Cancelar viagem
    async cancelTrip(tripData) {
        if (!this.authenticated) {
            throw new Error('Usuário não autenticado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Cancel trip timeout'));
            }, 10000);

            this.emit('cancelTrip', tripData);
            
            this.socket.once('tripCancelled', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Cancel trip failed'));
                }
            });
    }

    // Desconectar
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
            this.authenticated = false;
            this.connectionPromise = null;
            console.log('🔌 Desconectado manualmente');
        }

    // Verificar status
    getStatus() {
        return {
            isConnected: this.isConnected,
            authenticated: this.authenticated,
            userId: this.userId,
            retryAttempts: this.retryAttempts
        };
    }

// Instância singleton

                
                const connectionResult = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Connection timeout'));
                    }, 15000);
                    
                    socket.on('connect', () => {
                        clearTimeout(timeout);
                        console.log(`✅ Conectado na tentativa ${attempt}`);
                        this.socket = socket;
                        this.isConnected = true;
                        this.retryAttempts = 0;
                        this._setupEventListeners();
                        resolve(socket);
                    });
                    
                    socket.on('connect_error', (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                
                return connectionResult;
                
            } catch (error) {
                console.log(`❌ Tentativa ${attempt} falhou: ${error.message}`);
                
                if (attempt < this.maxRetries) {
                    // Backoff exponencial
                    const waitTime = Math.min(
                        this.retryDelay * Math.pow(2, attempt - 1),
                        this.maxRetryDelay
                    );
                    
                    console.log(`⏳ Aguardando ${waitTime}ms antes da próxima tentativa...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    console.log('❌ Todas as tentativas falharam');
                    throw new Error(`Falha na conexão após ${this.maxRetries} tentativas: ${error.message}`);
                }

    // Autenticar usuário
    async authenticate(uid) {
        if (!this.socket || !this.isConnected) {
            throw new Error('Socket não está conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Authentication timeout'));
            }, 10000);

            this.socket.emit('authenticate', { uid });
            
            this.socket.once('authenticated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    this.authenticated = true;
                    this.userId = uid;
                    console.log(`🔐 Usuário autenticado: ${uid}`);
                    resolve(data);
                } else {
                    reject(new Error('Authentication failed'));
                }
            });
    }

    // Configurar listeners de eventos
    _setupEventListeners() {
        if (!this.socket) return;

        this.socket.on('disconnect', (reason) => {
            console.log(`🔌 Desconectado: ${reason}`);
            this.isConnected = false;
            this.authenticated = false;
            this._notifyListeners('disconnect', reason);
        });

        this.socket.on('connect_error', (error) => {
            console.log(`❌ Erro de conexão: ${error.message}`);
            this.isConnected = false;
            this._notifyListeners('connect_error', error);
        });

        this.socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`🔄 Tentativa de reconexão: ${attemptNumber}`);
            this._notifyListeners('reconnect_attempt', attemptNumber);
        });
    }

    // Sistema de listeners
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }

    off(event, callback) {
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            

export default webSocketService; 