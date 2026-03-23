/**
 * WebSocket Test Client
 * 
 * Cliente WebSocket especializado para testes E2E
 * Replica exatamente o comportamento do app mobile
 */

const io = require('socket.io-client');
const { getIdTokenForUid } = require('./firebase-id-token');
const E2E_VERBOSE = String(process.env.E2E_VERBOSE || 'false').toLowerCase() === 'true';

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
        if (E2E_VERBOSE) {
          console.log(`✅ [TestClient] Conectado: ${this.socket.id}`);
        }
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
   * @param {Object|string} [options] - Opções de autenticação (ou token direto)
   * @returns {Promise<Object>}
   */
  async authenticate(uid, userType, options = {}) {
    if (!this.connected) {
      throw new Error('Socket não está conectado');
    }

    const authOptions = typeof options === 'string' ? { token: options } : (options || {});
    const shouldGenerateToken = String(process.env.E2E_GENERATE_FIREBASE_TOKEN || 'true').toLowerCase() !== 'false';
    let token = String(authOptions.token || process.env.E2E_AUTH_TOKEN || '').trim();
    if (!token && shouldGenerateToken) {
      try {
        token = await getIdTokenForUid(uid);
      } catch (error) {
        // Em backend local com NODE_ENV=test pode autenticar sem token; em produção, o erro surgirá no evento auth_error.
        if (E2E_VERBOSE) {
          console.warn(`⚠️ [TestClient] Não foi possível gerar token Firebase para ${uid}: ${error.message}`);
        }
      }
    }
    const normalizedUserType = userType === 'passenger' ? 'customer' : userType;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao autenticar'));
      }, 15000); // Aumentado para 15 segundos

      // Registrar listeners ANTES de emitir o evento (evitar race condition)
      const authenticatedHandler = (data) => {
        clearTimeout(timeout);
        this.socket.removeListener('auth_error', errorHandler);
        this.socket.removeListener('authentication_error', errorHandler);
        this.authenticated = true;
        this.userId = uid;
        this.userType = normalizedUserType;
        this.socket.userId = uid; // Simular comportamento do servidor
        this.socket.userType = normalizedUserType;

        // Entrar na room apropriada (servidor faz isso automaticamente, mas garantir)
        if (normalizedUserType === 'driver') {
          this.socket.emit('join', `driver_${uid}`);
        } else if (normalizedUserType === 'customer') {
          this.socket.emit('join', `customer_${uid}`);
        }

        resolve(data);
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('authenticated', authenticatedHandler);
        this.socket.removeListener('authentication_error', errorHandler);
        this.socket.removeListener('auth_error', errorHandler);
        reject(new Error(error.message || 'Erro na autenticação'));
      };

      this.socket.once('authenticated', authenticatedHandler);
      this.socket.once('auth_error', errorHandler);
      this.socket.once('authentication_error', errorHandler);

      // Emitir evento após registrar listeners
      const payload = { uid, userType: normalizedUserType };
      if (token) payload.token = token;
      this.socket.emit('authenticate', payload);
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

      const mockPaymentDefaultEnabled =
        String(process.env.E2E_MOCK_PAYMENT || 'true').toLowerCase() !== 'false';
      const shouldInjectMock =
        mockPaymentDefaultEnabled &&
        data &&
        data.mockPayment === undefined &&
        data.__mockPayment === undefined;

      const payload = shouldInjectMock
        ? { ...data, mockPayment: true, __mockPayment: true }
        : data;

      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('paymentError', errorHandler);
        resolve(response);
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('paymentConfirmed', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao confirmar pagamento'));
      };

      this.socket.once('paymentConfirmed', successHandler);
      this.socket.once('paymentError', errorHandler);

      this.socket.emit('confirmPayment', payload);
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

      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('acceptRideError', errorHandler);
        resolve(response);
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('rideAccepted', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao aceitar corrida'));
      };

      this.socket.once('rideAccepted', successHandler);
      this.socket.once('acceptRideError', errorHandler);

      this.socket.emit('acceptRide', { bookingId });
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
   * Notificar chegada ao local de embarque (motorista)
   * @param {string} bookingId - ID da corrida
   * @returns {Promise<Object>}
   */
  async arrivedAtPickup(bookingId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao notificar chegada ao local de embarque'));
      }, 10000);

      this.socket.emit('notificationAction', {
        action: 'arrived_at_pickup',
        bookingId
      });

      // O servidor geralmente não retorna evento imediato para o motorista,
      // mas podemos aguardar um pouco ou observar logs
      setTimeout(() => {
        clearTimeout(timeout);
        resolve({ success: true });
      }, 1500);
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
      }, 25000);

      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('tripStartError', errorHandler);
        resolve(response);
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('tripStarted', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao iniciar viagem'));
      };

      this.socket.once('tripStarted', successHandler);
      this.socket.once('tripStartError', errorHandler);

      this.socket.emit('startTrip', data);
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
      }, 30000); // Expanded timeout to account for external woovi API payment resolution

      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('tripCompleteError', errorHandler);
        resolve(response);
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('tripCompleted', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao finalizar viagem'));
      };

      this.socket.once('tripCompleted', successHandler);
      this.socket.once('tripCompleteError', errorHandler);

      this.socket.emit('completeTrip', data);
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
      }, 30000);

      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('rideCancellationError', errorHandler);
        resolve(response);
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('rideCancelled', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao cancelar corrida'));
      };

      this.socket.once('rideCancelled', successHandler);
      this.socket.once('rideCancellationError', errorHandler);

      this.socket.emit('cancelRide', { bookingId, reason });
    });
  }

  /**
   * Solicitar extensão de corrida (mais cara)
   * @param {Object} data - Dados da extensão
   * @returns {Promise<Object>}
   */
  async requestRideExtension(data) {
    return new Promise((resolve, reject) => {
      const mockExtensionDefaultEnabled =
        String(process.env.E2E_MOCK_PAYMENT || 'true').toLowerCase() !== 'false';
      const payload =
        mockExtensionDefaultEnabled &&
        data &&
        data.mockPayment === undefined &&
        data.__mockPayment === undefined
          ? { ...data, mockPayment: true, __mockPayment: true }
          : data;

      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao solicitar extensão de corrida'));
      }, 30000);

      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('rideExtensionError', errorHandler);
        resolve(response);
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('rideExtensionPaymentRequired', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao solicitar extensão'));
      };

      this.socket.once('rideExtensionPaymentRequired', successHandler);
      this.socket.once('rideExtensionError', errorHandler);

      this.socket.emit('requestRideExtension', payload);
    });
  }

  /**
   * Alterar destino durante a corrida (mesmo preço ou mais barata)
   * @param {Object} data - Dados do novo destino
   * @returns {Promise<Object>}
   */
  async changeDestination(data) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao alterar destino'));
      }, 15000);

      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('changeDestinationError', errorHandler);
        resolve(response);
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('destinationChanged', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao alterar destino'));
      };

      this.socket.once('destinationChanged', successHandler);
      this.socket.once('changeDestinationError', errorHandler);

      this.socket.emit('changeDestination', data);
    });
  }

  /**
   * Aguardar evento específico
   * @param {string} eventName - Nome do evento
   * @param {number} timeout - Timeout em ms
   * @param {Function} predicate - Filtro opcional para validar payload do evento
   * @returns {Promise<Object>}
   */
  async waitForEvent(eventName, timeout = 10000, predicate = null) {
    const matcher = typeof predicate === 'function' ? predicate : (() => true);

    const findMatchingEvent = () => {
      const events = this.events.get(eventName) || [];
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const eventData = events[i].data;
        try {
          if (matcher(eventData)) return eventData;
        } catch (_error) {
          // Ignorar predicados inválidos e seguir aguardando próximo evento
        }
      }
      return null;
    };

    // Verificar se evento já foi recebido (e atende predicado, se houver)
    const existingMatch = findMatchingEvent();
    if (existingMatch) return existingMatch;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        removeListener();
        reject(new Error(`Timeout aguardando evento: ${eventName}`));
      }, timeout);

      const removeListener = () => {
        const listeners = this.eventListeners.get(eventName) || [];
        this.eventListeners.set(
          eventName,
          listeners.filter((registeredListener) => registeredListener !== listener)
        );
      };

      const listener = (data) => {
        try {
          if (!matcher(data)) return;
        } catch (_error) {
          return;
        }

        clearTimeout(timeoutId);
        removeListener();
        resolve(data);
      };

      if (!this.eventListeners.has(eventName)) {
        this.eventListeners.set(eventName, []);
      }
      this.eventListeners.get(eventName).push(listener);

      // Revalidar após registrar listener para evitar race condition
      const matchedAfterRegister = findMatchingEvent();
      if (matchedAfterRegister) {
        clearTimeout(timeoutId);
        removeListener();
        resolve(matchedAfterRegister);
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
