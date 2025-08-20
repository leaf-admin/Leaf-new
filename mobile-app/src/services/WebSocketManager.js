import io from 'socket.io-client';

// URL do WebSocket - usar localhost para desenvolvimento
const WEBSOCKET_URL = __DEV__ ? 'http://localhost:3001' : 'https://seu-backend-producao.com';

class WebSocketManager {
    static instance = null;

    constructor() {
        if (!WebSocketManager.instance) {
            this.socket = null;
            this.isConnecting = false;
            this.connectionAttempts = 0;
            this.maxConnectionAttempts = 3;
            
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
        if (this.socket?.connected || this.isConnecting) {
            return;
        }

        try {
            this.isConnecting = true;
            console.log('🔌 Tentando conectar ao WebSocket...');

            this.socket = io(WEBSOCKET_URL, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionDelay: 2000,
                reconnectionAttempts: this.maxConnectionAttempts,
                timeout: 10000,
            });

            this.setupListeners();
            
        } catch (error) {
            console.warn('⚠️ Erro ao inicializar WebSocket:', error.message);
            this.isConnecting = false;
        }
    }

    setupListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('🔌 Conectado ao servidor WebSocket');
            this.isConnecting = false;
            this.connectionAttempts = 0;
        });

        this.socket.on('disconnect', (reason) => {
            console.log(`🔌 Desconectado do servidor WebSocket: ${reason}`);
            this.isConnecting = false;
        });

        this.socket.on('connect_error', (error) => {
            console.warn('⚠️ Erro de conexão WebSocket:', error.message);
            this.isConnecting = false;
            this.connectionAttempts++;
            
            if (this.connectionAttempts >= this.maxConnectionAttempts) {
                console.log('🔌 Máximo de tentativas de conexão atingido. WebSocket desabilitado.');
            }
        });

        this.socket.on('reconnect', (attemptNumber) => {
            console.log(`🔌 Reconectado ao WebSocket após ${attemptNumber} tentativas`);
            this.connectionAttempts = 0;
        });
    }

    disconnect() {
        if (this.socket?.connected) {
            this.socket.disconnect();
        }
        this.isConnecting = false;
    }

    emit(event, data) {
        if (this.socket?.connected) {
            this.socket.emit(event, data);
        } else {
            console.warn(`⚠️ WebSocket não conectado. Evento '${event}' não enviado.`);
        }
    }

    on(event, callback) {
        if (this.socket) {
        this.socket.on(event, callback);
        }
    }

    off(event) {
        if (this.socket) {
        this.socket.off(event);
        }
    }

    // Verificar se está conectado
    isConnected() {
        return this.socket?.connected || false;
    }

    // Métodos específicos para eventos de viagem
    async createBooking(bookingData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Create booking timeout'));
            }, 15000);

            this.socket.emit('createBooking', bookingData);
            
            this.socket.once('bookingCreated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Create booking failed'));
                }
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

            this.socket.emit('driverResponse', { bookingId, accepted, reason });
            
            if (accepted) {
                this.socket.once('rideAccepted', (data) => {
                    clearTimeout(timeout);
                    if (data.success) {
                        resolve(data);
                    } else {
                        reject(new Error(data.error || 'Driver response failed'));
                    }
                });
            } else {
                this.socket.once('rideRejected', (data) => {
                    clearTimeout(timeout);
                    if (data.success) {
                        resolve(data);
                    } else {
                        reject(new Error(data.error || 'Driver response failed'));
                    }
                });
            }
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

    async updateDriverLocation(bookingId, lat, lng, heading = 0, speed = 0) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }
        
        this.socket.emit('updateDriverLocation', { 
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
}

export default WebSocketManager; 