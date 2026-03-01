/**
 * WebSocket Test Client
 * 
 * Cliente WebSocket especializado para testes E2E
 * Replica exatamente o comportamento do app mobile
 */

const io = require('socket.io-client');

class WebSocketTestClient {
  constructor(url, options = {}) {
    this.url = url || process.env.WS_URL || 'http://localhost:3001';
    this.options = {
      transports: ['websocket'],
      reconnection: false, // Desabilitar reconexão automática nos testes
      timeout: 20000,
      ...options
    };
    
    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this.events = new Map(); // Armazenar eventos recebidos
    this.eventListeners = new Map(); // Listeners registrados
    this.userId = null;
    this.userType = null;
  }
  
  /**
   * Conectar ao servidor
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.url, this.options);
      
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao conectar WebSocket'));
      }, this.options.timeout);
      
      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        console.log(`✅ [TestClient] Conectado: ${this.socket.id}`);
        resolve();
      });
      
      this.socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      
      // Registrar todos os eventos recebidos
      this.socket.onAny((eventName, ...args) => {
        if (!this.events.has(eventName)) {
          this.events.set(eventName, []);
        }
        this.events.get(eventName).push({
          timestamp: Date.now(),
          data: args[0] || {}
        });
        
        // Notificar listeners
        if (this.eventListeners.has(eventName)) {
          this.eventListeners.get(eventName).forEach(callback => {
            callback(args[0] || {});
          });
        }
      });
    });
  }
  
  /**
   * Autenticar usuário
   * @param {string} uid - ID do usuário
   * @param {string} userType - Tipo: 'customer' ou 'driver'
   * @returns {Promise<Object>}
   */
  async authenticate(uid, userType) {
    if (!this.connected) {
      throw new Error('Socket não está conectado');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao autenticar'));
      }, 15000); // Aumentado para 15 segundos
      
      // Registrar listeners ANTES de emitir o evento (evitar race condition)
      const authenticatedHandler = (data) => {
        clearTimeout(timeout);
        this.socket.removeListener('auth_error', errorHandler);
        this.authenticated = true;
        this.userId = uid;
        this.userType = userType;
        this.socket.userId = uid; // Simular comportamento do servidor
        this.socket.userType = userType;
        
        // Entrar na room apropriada (servidor faz isso automaticamente, mas garantir)
        if (userType === 'driver') {
          this.socket.emit('join', `driver_${uid}`);
        } else if (userType === 'customer') {
          this.socket.emit('join', `customer_${uid}`);
        }
        
        resolve(data);
      };
      
      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('authenticated', authenticatedHandler);
        reject(new Error(error.message || 'Erro na autenticação'));
      };
      
      this.socket.once('authenticated', authenticatedHandler);
      this.socket.once('auth_error', errorHandler);
      
      // Emitir evento após registrar listeners
      this.socket.emit('authenticate', { uid, userType });
    });
  }
  
  /**
   * Criar booking (solicitar corrida)
   * @param {Object} data - Dados do booking
   * @returns {Promise<Object>}
   */
  async createBooking(data) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao criar booking'));
      }, 20000); // Aumentado para 20 segundos
      
      // Registrar listeners ANTES de emitir o evento
      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('bookingError', errorHandler);
        resolve(response);
      };
      
      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('bookingCreated', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao criar booking'));
      };
      
      this.socket.once('bookingCreated', successHandler);
      this.socket.once('bookingError', errorHandler);
      
      // Emitir evento após registrar listeners
      this.socket.emit('createBooking', data);
    });
  }
  
  /**
   * Confirmar pagamento
   * @param {Object} data - Dados do pagamento
   * @returns {Promise<Object>}
   */
  async confirmPayment(data) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao confirmar pagamento'));
      }, 15000);
      
      this.socket.emit('confirmPayment', data);
      
      this.socket.once('paymentConfirmed', (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      
      this.socket.once('paymentError', (error) => {
        clearTimeout(timeout);
        reject(new Error(error.error || error.message || 'Erro ao confirmar pagamento'));
      });
    });
  }
  
  /**
   * Aceitar corrida (motorista)
   * @param {string} bookingId - ID da corrida
   * @returns {Promise<Object>}
   */
  async acceptRide(bookingId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao aceitar corrida'));
      }, 10000);
      
      this.socket.emit('acceptRide', { bookingId });
      
      this.socket.once('rideAccepted', (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      
      this.socket.once('acceptRideError', (error) => {
        clearTimeout(timeout);
        reject(new Error(error.error || error.message || 'Erro ao aceitar corrida'));
      });
    });
  }
  
  /**
   * Rejeitar corrida (motorista)
   * @param {string} bookingId - ID da corrida
   * @param {string} reason - Motivo da rejeição
   * @returns {Promise<Object>}
   */
  async rejectRide(bookingId, reason = 'Motorista indisponível') {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao rejeitar corrida'));
      }, 10000);
      
      this.socket.emit('rejectRide', { bookingId, reason });
      
      // Rejeição geralmente não retorna evento específico
      setTimeout(() => {
        clearTimeout(timeout);
        resolve({ success: true });
      }, 1000);
    });
  }
  
  /**
   * Iniciar viagem
   * @param {Object} data - Dados do início da viagem
   * @returns {Promise<Object>}
   */
  async startTrip(data) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao iniciar viagem'));
      }, 10000);
      
      this.socket.emit('startTrip', data);
      
      this.socket.once('tripStarted', (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      
      this.socket.once('tripStartError', (error) => {
        clearTimeout(timeout);
        reject(new Error(error.error || error.message || 'Erro ao iniciar viagem'));
      });
    });
  }
  
  /**
   * Finalizar viagem
   * @param {Object} data - Dados do fim da viagem
   * @returns {Promise<Object>}
   */
  async finishTrip(data) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao finalizar viagem'));
      }, 15000);
      
      this.socket.emit('completeTrip', data);
      
      this.socket.once('tripCompleted', (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      
      this.socket.once('tripCompleteError', (error) => {
        clearTimeout(timeout);
        reject(new Error(error.error || error.message || 'Erro ao finalizar viagem'));
      });
    });
  }
  
  /**
   * Cancelar corrida
   * @param {string} bookingId - ID da corrida
   * @param {string} reason - Motivo do cancelamento
   * @returns {Promise<Object>}
   */
  async cancelRide(bookingId, reason = 'Cancelado pelo usuário') {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao cancelar corrida'));
      }, 10000);
      
      this.socket.emit('cancelRide', { bookingId, reason });
      
      this.socket.once('rideCancelled', (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      
      this.socket.once('rideCancellationError', (error) => {
        clearTimeout(timeout);
        reject(new Error(error.error || error.message || 'Erro ao cancelar corrida'));
      });
    });
  }
  
  /**
   * Aguardar evento específico
   * @param {string} eventName - Nome do evento
   * @param {number} timeout - Timeout em ms
   * @returns {Promise<Object>}
   */
  async waitForEvent(eventName, timeout = 10000) {
    // Verificar se evento já foi recebido
    if (this.events.has(eventName) && this.events.get(eventName).length > 0) {
      const events = this.events.get(eventName);
      return events[events.length - 1].data;
    }
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout aguardando evento: ${eventName}`));
      }, timeout);
      
      const listener = (data) => {
        clearTimeout(timeoutId);
        resolve(data);
      };
      
      if (!this.eventListeners.has(eventName)) {
        this.eventListeners.set(eventName, []);
      }
      this.eventListeners.get(eventName).push(listener);
      
      // Se evento já foi recebido, resolver imediatamente
      if (this.events.has(eventName) && this.events.get(eventName).length > 0) {
        clearTimeout(timeoutId);
        const events = this.events.get(eventName);
        resolve(events[events.length - 1].data);
      }
    });
  }
  
  /**
   * Verificar se evento foi recebido
   * @param {string} eventName - Nome do evento
   * @returns {boolean}
   */
  hasReceivedEvent(eventName) {
    return this.events.has(eventName) && this.events.get(eventName).length > 0;
  }
  
  /**
   * Obter todos os eventos recebidos
   * @param {string} eventName - Nome do evento
   * @returns {Array}
   */
  getEvents(eventName) {
    return this.events.get(eventName) || [];
  }
  
  /**
   * Limpar eventos recebidos
   */
  clearEvents() {
    this.events.clear();
  }
  
  /**
   * Desconectar
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
      this.authenticated = false;
      this.socket = null;
    }
  }
  
  /**
   * Obter ID do socket
   * @returns {string|null}
   */
  getSocketId() {
    return this.socket?.id || null;
  }
}

module.exports = WebSocketTestClient;

