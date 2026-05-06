/**
 * WebSocket Test Client
 * 
 * Cliente WebSocket especializado para testes E2E
 * Replica exatamente o comportamento do app mobile
 */

const io = require('socket.io-client');
const { getIdTokenForUid } = require('./firebase-id-token');
const { buildCanonicalCreateBookingIdempotencyKey } = require('../../../../services/create-booking-idempotency-service');
const E2E_VERBOSE = String(process.env.E2E_VERBOSE || 'false').toLowerCase() === 'true';

function extractEventIdempotencyKey(payload = {}) {
  if (!payload || typeof payload !== 'object') return null;
  return (
    payload.idempotencyKey ||
    payload?.data?.idempotencyKey ||
    payload?.booking?.idempotencyKey ||
    payload?.meta?.idempotencyKey ||
    null
  );
}

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function deriveApiBaseUrl(wsUrl) {
  const fromEnv = normalizeBaseUrl(process.env.API_BASE_URL || '');
  if (fromEnv) return fromEnv;

  const resolvedWsUrl = String(wsUrl || process.env.WS_URL || '').trim();
  if (!resolvedWsUrl) {
    return 'https://api.62.169.31.231.sslip.io';
  }

  try {
    const parsed = new URL(resolvedWsUrl);
    if (parsed.hostname.startsWith('socket.')) {
      parsed.hostname = parsed.hostname.replace(/^socket\./, 'api.');
    }
    return normalizeBaseUrl(parsed.toString());
  } catch (_error) {
    return 'https://api.62.169.31.231.sslip.io';
  }
}

function toAmountInCents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class WebSocketTestClient {
  constructor(url, options = {}) {
    this.url = url || process.env.WS_URL || 'http://localhost:3001';
    this.apiBaseUrl = deriveApiBaseUrl(this.url);
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
    const options =
      arguments.length > 1 && arguments[1] && typeof arguments[1] === 'object'
        ? arguments[1]
        : {};
    const allowAutoPaymentFallback =
      options.autoPaymentFallback !== false &&
      String(process.env.E2E_AUTO_PAYMENT_ON_CREATE_BOOKING || 'true').toLowerCase() !== 'false';

    try {
      return await this._createBookingOnce(data, options);
    } catch (error) {
      if (!allowAutoPaymentFallback) {
        throw error;
      }

      const retryablePaymentError = this.isRetryableCreateBookingPaymentError(error);
      const alreadyHasConfirmedPayment = this.hasBookingPayloadConfirmedPayment(data);
      if (!retryablePaymentError || alreadyHasConfirmedPayment) {
        throw error;
      }

      const payment = await this.provisionAdvancePaymentForBooking(data);
      const retryPayload = this.injectConfirmedPaymentData(data, payment);

      if (E2E_VERBOSE) {
        console.log(
          `⚠️ [TestClient] createBooking exigiu pagamento. Repetindo com cobrança confirmada (${payment.chargeId})`
        );
      }

      return this._createBookingOnce(retryPayload, options);
    }
  }

  async _createBookingOnce(data, options = {}) {
    const timeoutMs = Math.max(1000, Number.parseInt(options.timeoutMs || '20000', 10) || 20000);
    const lateEventGraceMs = Math.max(0, Number.parseInt(options.lateEventGraceMs || '250', 10) || 250);
    const expectedIdempotencyKey = data?.idempotencyKey || null;
    const canonicalIdempotencyKey = buildCanonicalCreateBookingIdempotencyKey({
      userId: data?.customerId || this.userId || 'anonymous',
      data,
      fallbackIdempotencyKey: expectedIdempotencyKey
    });
    const acceptedIdempotencyKeys = new Set(
      [expectedIdempotencyKey, canonicalIdempotencyKey]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );

    return new Promise((resolve, reject) => {
      const matchesSuccessPayload = (payload = {}) => {
        if (acceptedIdempotencyKeys.size === 0) return true;
        const eventKey = extractEventIdempotencyKey(payload);
        return acceptedIdempotencyKeys.has(String(eventKey || '').trim());
      };

      const matchesErrorPayload = (payload = {}) => {
        if (acceptedIdempotencyKeys.size === 0) return true;
        const eventKey = extractEventIdempotencyKey(payload);
        return !eventKey || acceptedIdempotencyKeys.has(String(eventKey || '').trim());
      };

      const findRecordedEvent = (eventName, matcher) => {
        const events = this.getEvents(eventName) || [];
        for (let index = events.length - 1; index >= 0; index -= 1) {
          const eventData = events[index]?.data || {};
          try {
            if (matcher(eventData)) return eventData;
          } catch (_error) {
            // ignore matcher errors and continue scanning
          }
        }
        return null;
      };

      const summarizeRecentEvents = () => {
        const collected = ['bookingCreated', 'bookingError']
          .flatMap((eventName) => {
            const events = (this.getEvents(eventName) || []).slice(-3);
            return events.map((entry) => {
              const payload = entry?.data || {};
              return {
                eventName,
                at: entry?.timestamp || null,
                idempotencyKey: extractEventIdempotencyKey(payload),
                bookingId: payload?.bookingId || payload?.data?.bookingId || null,
                code: payload?.code || null,
                message: payload?.error || payload?.message || null
              };
            });
          })
          .slice(-6);

        return JSON.stringify(collected);
      };

      let timeout = null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        this.socket.removeListener('bookingCreated', successHandler);
        this.socket.removeListener('bookingError', errorHandler);
      };

      const successHandler = (response) => {
        if (!matchesSuccessPayload(response)) return;
        cleanup();
        resolve(response);
      };

      const errorHandler = (error) => {
        if (!matchesErrorPayload(error)) return;
        cleanup();
        reject(new Error(error.error || error.message || 'Erro ao criar booking'));
      };

      timeout = setTimeout(async () => {
        const immediateSuccess = findRecordedEvent('bookingCreated', matchesSuccessPayload);
        if (immediateSuccess) {
          cleanup();
          resolve(immediateSuccess);
          return;
        }

        const immediateError = findRecordedEvent('bookingError', matchesErrorPayload);
        if (immediateError) {
          cleanup();
          reject(new Error(immediateError.error || immediateError.message || 'Erro ao criar booking'));
          return;
        }

        if (lateEventGraceMs > 0) {
          await new Promise((resolveGrace) => setTimeout(resolveGrace, lateEventGraceMs));
          const lateSuccess = findRecordedEvent('bookingCreated', matchesSuccessPayload);
          if (lateSuccess) {
            cleanup();
            resolve(lateSuccess);
            return;
          }

          const lateError = findRecordedEvent('bookingError', matchesErrorPayload);
          if (lateError) {
            cleanup();
            reject(new Error(lateError.error || lateError.message || 'Erro ao criar booking'));
            return;
          }
        }

        const socketId = this.socket?.id || 'unknown';
        const socketState = this.socket?.connected ? 'connected' : 'disconnected';
        const suffix = [
          `idempotencyKeys=${Array.from(acceptedIdempotencyKeys).join(',') || 'none'}`,
          `socketId=${socketId}`,
          `socketState=${socketState}`,
          `recentEvents=${summarizeRecentEvents()}`
        ].join(' ');
        cleanup();
        reject(new Error(`Timeout ao criar booking (${suffix})`));
      }, timeoutMs);

      this.socket.on('bookingCreated', successHandler);
      this.socket.on('bookingError', errorHandler);

      this.socket.emit('createBooking', data);
    });
  }

  hasBookingPayloadConfirmedPayment(data = {}) {
    const normalizedStatus = String(data?.paymentStatus || '').trim().toLowerCase();
    const isConfirmedStatus = ['confirmed', 'paid', 'in_holding'].includes(normalizedStatus);
    const hasChargeId = Boolean(String(data?.paymentData?.chargeId || data?.paymentId || '').trim());
    return isConfirmedStatus && hasChargeId;
  }

  isRetryableCreateBookingPaymentError(error) {
    const message = String(error?.message || '').trim().toLowerCase();
    if (!message) return false;
    return (
      message.includes('pagamento obrigatório') ||
      message.includes('payment required') ||
      message.includes('referência de pagamento ausente')
    );
  }

  async postJson(url, body, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  async provisionAdvancePaymentForBooking(bookingPayload = {}) {
    const passengerId = String(bookingPayload?.customerId || this.userId || '').trim();
    if (!passengerId) {
      throw new Error('payment_bootstrap_missing_passenger');
    }

    const pickupAddress = bookingPayload?.pickupLocation?.address || bookingPayload?.pickupLocation?.add || 'Origem E2E';
    const destinationAddress =
      bookingPayload?.destinationLocation?.address || bookingPayload?.destinationLocation?.add || 'Destino E2E';
    const inferredAmountInCents =
      Number.parseInt(String(bookingPayload?.paymentData?.amountInCents || ''), 10) ||
      Number.parseInt(String(bookingPayload?.amountInCents || ''), 10) ||
      toAmountInCents(bookingPayload?.estimatedFare) ||
      2750;
    const rideId = `ride_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const paymentAdvance = await this.postJson(`${this.apiBaseUrl}/api/payment/advance`, {
      passengerId,
      amount: inferredAmountInCents,
      rideId,
      rideDetails: {
        origin: pickupAddress,
        destination: destinationAddress
      },
      passengerName: 'Leaf E2E Passenger',
      passengerEmail: 'qa+e2e@leaf.local'
    }, 25000);

    const chargeId = String(paymentAdvance?.data?.chargeId || '').trim();
    if (!paymentAdvance.ok || !chargeId) {
      throw new Error(
        `payment_advance_failed:${paymentAdvance?.data?.message || paymentAdvance?.status || 'unknown'}`
      );
    }

    const webhookPayload = {
      event: 'OPENPIX:CHARGE_COMPLETED',
      charge: {
        identifier: chargeId,
        correlationID: `ride_${rideId}_${Date.now()}_e2e`,
        value: inferredAmountInCents,
        status: 'COMPLETED',
        paidAt: new Date().toISOString(),
        additionalInfo: [
          { key: 'ride_id', value: rideId },
          { key: 'passenger_id', value: passengerId },
          { key: 'payment_type', value: 'advance_payment' }
        ]
      },
      pix: { status: 'COMPLETED' }
    };

    const webhookResponse = await this.postJson(`${this.apiBaseUrl}/api/woovi/webhook`, webhookPayload, 25000);
    if (!webhookResponse.ok) {
      throw new Error(`payment_webhook_failed:${webhookResponse.status}`);
    }

    await sleep(250);
    return {
      chargeId,
      rideId,
      amountInCents: inferredAmountInCents
    };
  }

  injectConfirmedPaymentData(originalPayload = {}, payment = {}) {
    const safeOriginal = originalPayload && typeof originalPayload === 'object' ? originalPayload : {};
    const existingPaymentData = safeOriginal.paymentData && typeof safeOriginal.paymentData === 'object'
      ? safeOriginal.paymentData
      : {};
    const paymentMethod = String(safeOriginal.paymentMethod || 'pix').trim() || 'pix';

    return {
      ...safeOriginal,
      paymentMethod,
      paymentStatus: 'confirmed',
      paymentData: {
        ...existingPaymentData,
        chargeId: payment.chargeId,
        paymentId: payment.chargeId,
        rideId: payment.rideId,
        amountInCents: payment.amountInCents
      }
    };
  }

  async emitAndWait({
    emitEvent,
    emitPayload,
    successEvent,
    errorEvent = null,
    timeoutMs = 20000,
    predicate = null
  }) {
    const matcher = typeof predicate === 'function' ? predicate : (() => true);

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.socket.removeListener(successEvent, successHandler);
        if (errorEvent) {
          this.socket.removeListener(errorEvent, errorHandler);
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout aguardando evento: ${emitEvent}`));
      }, timeoutMs);

      const successHandler = (payload = {}) => {
        try {
          if (!matcher(payload)) return;
        } catch (_error) {
          return;
        }

        clearTimeout(timeout);
        cleanup();
        resolve(payload);
      };

      const errorHandler = (error = {}) => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error(error.error || error.message || `Erro ao executar ${emitEvent}`));
      };

      this.socket.on(successEvent, successHandler);
      if (errorEvent) {
        this.socket.on(errorEvent, errorHandler);
      }

      this.socket.emit(emitEvent, emitPayload);
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
  async arrivedAtPickup(bookingId, options = {}) {
    const timeoutMs = Math.max(1000, Number.parseInt(options.timeoutMs || '15000', 10) || 15000);
    const location =
      options.location && typeof options.location === 'object'
        ? {
            lat: options.location.lat,
            lng: options.location.lng
          }
        : undefined;

    const emitPayload = {
      bookingId,
      ...(location ? { location } : {})
    };

    const waitForArriveAtPickup = () => new Promise((resolve, reject) => {
      const cleanup = () => {
        this.socket.removeListener('arrivedAtPickup', handler);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout aguardando evento: arriveAtPickup'));
      }, timeoutMs);

      const handler = (payload = {}) => {
        if (String(payload?.bookingId || payload?.rideId || '') !== String(bookingId)) {
          return;
        }

        clearTimeout(timeout);
        cleanup();

        if (payload?.success === false || payload?.error) {
          reject(new Error(payload.error || payload.message || 'Erro ao registrar chegada no pickup'));
          return;
        }

        resolve(payload);
      };

      this.socket.on('arrivedAtPickup', handler);
      this.socket.emit('arriveAtPickup', emitPayload);
    });

    try {
      return await waitForArriveAtPickup();
    } catch (error) {
      if (!String(error?.message || '').includes('Timeout aguardando evento: arriveAtPickup')) {
        throw error;
      }

      return this.emitAndWait({
        emitEvent: 'notificationAction',
        emitPayload: {
          action: 'arrived_at_pickup',
          bookingId,
          ...(location ? { location } : {})
        },
        successEvent: 'notificationActionSuccess',
        errorEvent: 'notificationActionError',
        timeoutMs,
        predicate: (payload = {}) =>
          String(payload?.bookingId || '') === String(bookingId) &&
          String(payload?.action || 'arrived_at_pickup') === 'arrived_at_pickup'
      });
    }
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

  async interruptRideOperational(data) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao interromper corrida operacionalmente'));
      }, 20000);

      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('rideOperationalInterruptionError', errorHandler);
        resolve(response);
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('rideOperationalInterrupted', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao interromper corrida operacionalmente'));
      };

      this.socket.once('rideOperationalInterrupted', successHandler);
      this.socket.once('rideOperationalInterruptionError', errorHandler);
      this.socket.emit('interruptRideOperational', data);
    });
  }

  async respondOperationalContinuation(data) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao responder continuidade operacional'));
      }, 25000);

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.removeListener('rideOperationalContinuationSearching', successHandler);
        this.socket.removeListener('tripCompleted', successHandler);
        reject(new Error(error.error || error.message || 'Erro ao responder continuidade operacional'));
      };

      const successHandler = (response) => {
        clearTimeout(timeout);
        this.socket.removeListener('rideOperationalContinuationError', errorHandler);
        this.socket.removeListener('rideOperationalContinuationSearching', successHandler);
        this.socket.removeListener('tripCompleted', successHandler);
        resolve(response);
      };

      this.socket.once('rideOperationalContinuationSearching', successHandler);
      this.socket.once('tripCompleted', successHandler);
      this.socket.once('rideOperationalContinuationError', errorHandler);
      this.socket.emit('respondOperationalContinuation', data);
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
