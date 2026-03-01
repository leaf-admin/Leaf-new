/**
 * WRAPPER DE WEBSOCKET PARA TESTES
 */

const io = require('socket.io-client');
const TestHelpers = require('./test-helpers');
const PARAMS = require('../config/test-parameters');

class WebSocketTestClient {
    constructor(userId, userType = 'driver', options = {}) {
        this.userId = userId;
        this.userType = userType;
        this.socket = null;
        this.connected = false;
        this.authenticated = false;
        this.receivedEvents = [];
        this.eventListeners = new Map();
        this.options = {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
            ...options,
        };
    }

    /**
     * Conecta ao servidor WebSocket
     */
    async connect(wsUrl = null) {
        return new Promise((resolve, reject) => {
            const url = wsUrl || PARAMS.SERVER.WS_URL;
            this.socket = io(url, this.options);

            this.socket.on('connect', () => {
                this.connected = true;
                console.log(`✅ [${this.userType}] ${this.userId} conectado`);
                resolve(this.socket);
            });

            this.socket.on('connect_error', (error) => {
                console.error(`❌ [${this.userType}] Erro ao conectar:`, error.message);
                reject(error);
            });

            this.socket.on('disconnect', (reason) => {
                this.connected = false;
                console.log(`🔌 [${this.userType}] Desconectado: ${reason}`);
            });

            // Registrar todos os eventos recebidos
            this.socket.onAny((eventName, data) => {
                this.receivedEvents.push({
                    event: eventName,
                    data: data,
                    timestamp: TestHelpers.getTimestamp(),
                });
                
                // Acionar listeners específicos
                const listeners = this.eventListeners.get(eventName) || [];
                listeners.forEach(listener => {
                    try {
                        listener(data);
                    } catch (error) {
                        console.error(`Erro em listener de ${eventName}:`, error);
                    }
                });
            });

            // Timeout de conexão
            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('Timeout de conexão'));
                }
            }, 10000);
        });
    }

    /**
     * Autentica o usuário (FIDEDÍGNO AO APP REAL)
     * 
     * O app real emite: socket.emit('authenticate', { uid, userType })
     * E espera: evento 'authenticated' com data.success
     */
    async authenticate() {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                return reject(new Error('Não conectado ao servidor'));
            }

            // ✅ MESMO FORMATO QUE O APP REAL
            this.socket.emit('authenticate', {
                uid: this.userId,  // ✅ Campo é 'uid', não 'userId'
                userType: this.userType,  // 'passenger' ou 'driver'
            });

            // ✅ MESMO HANDLER QUE O APP REAL
            const timeout = setTimeout(() => {
                reject(new Error('Authentication timeout'));
            }, 10000);

            this.socket.once('authenticated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    this.authenticated = true;
                    console.log(`✅ [${this.userType}] ${this.userId} autenticado`);
                    resolve(data);
                } else {
                    reject(new Error('Authentication failed'));
                }
            });
        });
    }

    /**
     * Registra listener para evento (mantém registro)
     */
    on(eventName, callback) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName).push(callback);
    }

    /**
     * Remove listener
     */
    off(eventName, callback) {
        if (this.eventListeners.has(eventName)) {
            const listeners = this.eventListeners.get(eventName);
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * Listener único (remove após primeiro evento)
     */
    once(eventName, callback) {
        const wrapper = (data) => {
            callback(data);
            this.off(eventName, wrapper);
        };
        this.on(eventName, wrapper);
    }

    /**
     * Emite evento
     */
    emit(eventName, data) {
        if (!this.connected) {
            throw new Error('Não conectado ao servidor');
        }
        this.socket.emit(eventName, data);
    }

    /**
     * Aguarda evento específico com timeout
     * SOLUÇÃO 2: Verifica se evento já chegou antes de aguardar (resolve race condition)
     */
    async waitForEvent(eventName, timeout = 30) {
        // ✅ Verificar se evento já chegou ANTES de aguardar
        const lastEvent = this.getLastEvent(eventName);
        if (lastEvent) {
            // Evento já chegou, retornar imediatamente (apenas os dados)
            return lastEvent.data;
        }
        
        // Evento ainda não chegou, aguardar normalmente
        return TestHelpers.waitForEvent(this.socket, eventName, timeout);
    }

    /**
     * Aguarda múltiplos eventos (retorna o primeiro que chegar)
     * SOLUÇÃO: Verifica se algum evento já chegou antes de aguardar (resolve race condition)
     */
    async waitForAnyEvent(eventNames, timeout = 30) {
        // ✅ Verificar se algum evento já chegou ANTES de aguardar
        for (const eventName of eventNames) {
            const lastEvent = this.getLastEvent(eventName);
            if (lastEvent) {
                // Evento já chegou, retornar imediatamente
                return { event: eventName, data: lastEvent.data };
            }
        }
        
        // Nenhum evento chegou ainda, aguardar normalmente
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                eventNames.forEach(name => {
                    this.off(name, handlers.get(name));
                });
                handlers.clear();
                reject(new Error(`Timeout aguardando eventos ${eventNames.join(', ')} após ${timeout}s`));
            }, timeout * 1000);

            const handlers = new Map();
            eventNames.forEach(eventName => {
                const handler = (data) => {
                    clearTimeout(timer);
                    // Remover todos os handlers
                    eventNames.forEach(name => {
                        if (handlers.has(name)) {
                            this.off(name, handlers.get(name));
                        }
                    });
                    handlers.clear();
                    resolve({ event: eventName, data });
                };
                handlers.set(eventName, handler);
                this.once(eventName, handler);
            });
        });
    }

    /**
     * Simula perda de conexão
     * Usa disconnect() sem parâmetros para permitir reconexão automática
     */
    async simulateConnectionLoss(duration = 5) {
        if (this.socket) {
            // Usar disconnect() sem parâmetros permite que socket.io tente reconectar automaticamente
            // se reconnection: true estiver configurado
            this.socket.disconnect();
            this.connected = false;
            this.authenticated = false; // Reset autenticação para re-autenticar após reconexão
            await TestHelpers.sleep(duration);
        }
    }

    /**
     * Reconecta
     */
    async reconnect() {
        if (this.socket) {
            this.socket.connect();
            await this.waitForEvent('connect', 10);
            this.connected = true;
            // Sempre re-autenticar após reconexão (estado authenticated foi resetado)
            if (!this.authenticated) {
                await this.authenticate();
            }
        } else {
            // Se não há socket, criar nova conexão
            await this.connect();
            await this.authenticate();
        }
    }

    /**
     * Desconecta
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.connected = false;
            this.authenticated = false;
        }
    }

    /**
     * Limpa eventos recebidos
     */
    clearEvents() {
        this.receivedEvents = [];
    }

    /**
     * Busca eventos recebidos por nome
     */
    getEvents(eventName) {
        return this.receivedEvents.filter(e => e.event === eventName);
    }

    /**
     * Verifica se evento foi recebido
     */
    hasReceivedEvent(eventName) {
        return this.receivedEvents.some(e => e.event === eventName);
    }

    /**
     * Obtém último evento recebido
     */
    getLastEvent(eventName = null) {
        if (eventName) {
            const events = this.getEvents(eventName);
            return events.length > 0 ? events[events.length - 1] : null;
        }
        return this.receivedEvents.length > 0 
            ? this.receivedEvents[this.receivedEvents.length - 1] 
            : null;
    }

    // ========================================
    // MÉTODOS FIDEDÍGNOS AO APP REAL
    // Replicam exatamente o WebSocketManager
    // ========================================

    /**
     * Criar booking (FIDEDÍGNO AO APP REAL)
     * socket.emit('createBooking', bookingData) → espera 'bookingCreated'
     */
    async createBooking(bookingData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Create booking timeout'));
            }, 15000);

            // ✅ MESMO FORMATO QUE O APP REAL
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

    /**
     * Driver response (FIDEDÍGNO AO APP REAL)
     * socket.emit('driverResponse', { bookingId, accepted, reason }) → espera 'rideAccepted' ou 'rideRejected'
     */
    async driverResponse(bookingId, accepted, reason = null) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Driver response timeout'));
            }, 10000);

            // ✅ MESMO FORMATO QUE O APP REAL
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

    /**
     * Aceitar corrida (FIDEDÍGNO AO APP REAL)
     * socket.emit('acceptRide', { rideId, ...driverData }) → espera 'rideAccepted'
     */
    async acceptRide(rideId, driverData = {}) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Accept ride timeout'));
            }, 15000);

            // ✅ MESMO FORMATO QUE O APP REAL
            // Servidor aceita tanto rideId quanto bookingId
            const acceptData = { ...driverData };
            if (rideId) {
                acceptData.rideId = rideId;
                acceptData.bookingId = rideId; // Também enviar como bookingId para compatibilidade
            }
            
            // Configurar listener ANTES de emitir (evita race condition)
            // Usar on() ao invés de once() para garantir que captura eventos via rooms
            let eventReceived = false;
            const eventHandler = (data) => {
                if (eventReceived) return; // Evitar processar múltiplas vezes
                eventReceived = true;
                clearTimeout(timeout);
                this.socket.off('rideAccepted', eventHandler);
                this.socket.off('acceptRideError', errorHandler);
                // Servidor emite via room, pode não ter success explícito
                // Aceitar se não tiver erro explícito
                if (data.error) {
                    reject(new Error(data.error || 'Accept ride failed'));
                } else {
                    resolve(data);
                }
            };
            
            // ✅ NOVO: Listener para eventos de erro (se validação falhar)
            const errorHandler = (error) => {
                if (eventReceived) return;
                eventReceived = true;
                clearTimeout(timeout);
                this.socket.off('rideAccepted', eventHandler);
                this.socket.off('acceptRideError', errorHandler);
                reject(new Error(error.error || error.message || 'Accept ride failed'));
            };
            
            this.socket.on('rideAccepted', eventHandler);
            this.socket.on('acceptRideError', errorHandler);
            
            // Emitir após configurar listener
            this.socket.emit('acceptRide', acceptData);
        });
    }

    /**
     * Rejeitar corrida (FIDEDÍGNO AO APP REAL)
     * socket.emit('rejectRide', { rideId, reason }) → espera 'rideRejected'
     */
    async rejectRide(rideId, reason = 'Motorista indisponível') {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Reject ride timeout'));
            }, 10000);

            // ✅ MESMO FORMATO QUE O APP REAL
            // Servidor aceita tanto rideId quanto bookingId
            
            // Configurar listener ANTES de emitir (evita race condition)
            // Usar on() ao invés de once() para garantir que captura eventos via rooms
            let eventReceived = false;
            const eventHandler = (data) => {
                if (eventReceived) return; // Evitar processar múltiplas vezes
                eventReceived = true;
                clearTimeout(timeout);
                this.socket.off('rideRejected', eventHandler);
                this.socket.off('rejectRideError', errorHandler);
                // Servidor emite via room, pode não ter success explícito
                // Aceitar se não tiver erro explícito
                if (data.error) {
                    reject(new Error(data.error || 'Reject ride failed'));
                } else {
                    resolve(data);
                }
            };
            
            // ✅ NOVO: Listener para eventos de erro (se validação falhar)
            const errorHandler = (error) => {
                if (eventReceived) return;
                eventReceived = true;
                clearTimeout(timeout);
                this.socket.off('rideRejected', eventHandler);
                this.socket.off('rejectRideError', errorHandler);
                reject(new Error(error.error || error.message || 'Reject ride failed'));
            };
            
            this.socket.on('rideRejected', eventHandler);
            this.socket.on('rejectRideError', errorHandler);
            
            // Emitir após configurar listener
            this.socket.emit('rejectRide', { 
                rideId, 
                bookingId: rideId, // Também enviar como bookingId para compatibilidade
                reason 
            });
        });
    }

    /**
     * Iniciar viagem (FIDEDÍGNO AO APP REAL)
     * socket.emit('startTrip', { bookingId, startLocation }) → espera 'tripStarted'
     */
    async startTrip(bookingId, startLocation) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Start trip timeout'));
            }, 10000);

            // ✅ MESMO FORMATO QUE O APP REAL
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

    /**
     * Atualizar localização durante viagem (FIDEDÍGNO AO APP REAL)
     * socket.emit('updateTripLocation', { bookingId, lat, lng, heading, speed })
     */
    async updateTripLocation(bookingId, lat, lng, heading = 0, speed = 0) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        // ✅ MESMO FORMATO QUE O APP REAL (sem esperar resposta)
        this.socket.emit('updateTripLocation', {
            bookingId,
            lat,
            lng,
            heading,
            speed,
        });
    }

    /**
     * Completar viagem (FIDEDÍGNO AO APP REAL)
     * socket.emit('completeTrip', { bookingId, endLocation, distance, fare }) → espera 'tripCompleted'
     */
    async completeTrip(bookingId, endLocation, distance, fare) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Complete trip timeout'));
            }, 10000);

            // ✅ MESMO FORMATO QUE O APP REAL
            this.socket.emit('completeTrip', {
                bookingId,
                endLocation,
                distance,
                fare,
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

    /**
     * Confirmar pagamento (FIDEDÍGNO AO APP REAL)
     * socket.emit('confirmPayment', { bookingId, paymentMethod, paymentId, amount }) → espera 'paymentConfirmed'
     */
    async confirmPayment(bookingId, paymentMethod, paymentId, amount) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Confirm payment timeout'));
            }, 10000);

            // ✅ MESMO FORMATO QUE O APP REAL
            this.socket.emit('confirmPayment', {
                bookingId,
                paymentMethod,
                paymentId,
                amount,
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

    /**
     * Submeter avaliação (FIDEDÍGNO AO APP REAL)
     * socket.emit('submitRating', ratingData) → espera 'ratingSubmitted'
     */
    async submitRating(ratingData) {
        if (!this.socket?.connected) {
            throw new Error('WebSocket não conectado');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Submit rating timeout'));
            }, 15000);

            // Formato esperado pelo servidor (conforme server.js linha 741)
            // Servidor espera: tripId, customerId, driverId, customerRating, driverRating, etc
            const serverFormat = {
                tripId: ratingData.bookingId || ratingData.tripId,
                customerId: ratingData.ratedUserId === this.userId ? this.userId : ratingData.customerId,
                driverId: ratingData.ratedUserId !== this.userId ? ratingData.ratedUserId : ratingData.driverId,
                customerRating: this.userType === 'passenger' ? ratingData.rating : null,
                driverRating: this.userType === 'driver' ? ratingData.rating : null,
                customerComment: this.userType === 'passenger' ? ratingData.comment : null,
                driverComment: this.userType === 'driver' ? ratingData.comment : null,
            };

            // ✅ MESMO FORMATO QUE O APP REAL
            this.socket.emit('submitRating', serverFormat);

            this.socket.once('ratingSubmitted', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Submit rating failed'));
                }
            });

            // Também escutar ratingError
            this.socket.once('ratingError', (data) => {
                clearTimeout(timeout);
                reject(new Error(data.error || 'Submit rating failed'));
            });
        });
    }
}

module.exports = WebSocketTestClient;

