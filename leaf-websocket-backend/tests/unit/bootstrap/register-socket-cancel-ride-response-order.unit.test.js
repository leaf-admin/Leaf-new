const mockMarkRideCancelled = jest.fn();
jest.mock('../../../services/ride-persistence-service', () => ({
  markRideCancelled: (...args) => mockMarkRideCancelled(...args),
}));
jest.mock('../../../utils/map-h3-refresh-broadcaster', () => ({
  scheduleMapH3Refresh: jest.fn(),
}));

const registerSocketCancelRideHandler = require('../../../bootstrap/register-socket-cancel-ride-handler');

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

// Motorista cancela uma corrida aceita: a resposta ao iniciador só pode sair depois do
// command (estado + reembolso) e não deve esperar o espelho do Firestore.
const arrange = ({ commandResult, order = [] } = {}) => {
  const handlers = new Map();
  const socket = {
    id: 'socket_driver_1',
    userId: 'driver_1',
    userType: 'driver',
    on: jest.fn((event, handler) => handlers.set(event, handler)),
    emit: jest.fn((event) => order.push(`socket:${event}`)),
    trigger: (event, payload) => handlers.get(event)?.(payload),
  };
  const roomEmits = [];
  const io = {
    to: jest.fn((room) => ({
      emit: jest.fn((event, payload) => {
        roomEmits.push({ room, event, payload });
        order.push(`emit:${room}:${event}`);
      }),
    })),
  };
  const booking = {
    customerId: 'customer_1',
    passengerId: 'customer_1',
    driverId: 'driver_1',
    status: 'ACCEPTED',
    estimatedFare: '48.61',
  };
  const redis = {
    hgetall: jest.fn().mockResolvedValue(booking),
    smembers: jest.fn().mockResolvedValue([]),
    sadd: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
  };
  const execute = jest.fn().mockImplementation(async () => {
    order.push('command:state_committed');
    return commandResult || {
      success: true,
      data: {
        bookingId: 'booking_driver_cancel',
        cancellationFee: 0,
        refundResult: {
          success: true,
          amount: 4861,
          refundId: 'refund_driver_cancel',
          chargeId: 'charge_driver_cancel',
        },
        event: { bookingId: 'booking_driver_cancel' },
      },
    };
  });
  const CancelRideCommand = jest.fn().mockImplementation(() => ({ execute }));
  const paymentService = {
    getStoredPayment: jest.fn().mockResolvedValue({
      status: 'REFUNDED_FULL',
      refunded: true,
      amount: 4861,
      refundAmount: 4861,
      refundId: 'refund_driver_cancel',
      chargeId: 'charge_driver_cancel',
    }),
    processRideRefund: jest.fn(),
    markPaymentRefunded: jest.fn(),
  };
  const PaymentService = jest.fn(() => paymentService);
  PaymentService.isRefundedPaymentStatus = jest.fn(() => true);
  const idempotencyService = {
    generateKey: jest.fn(() => 'idem_driver_cancel'),
    beginRequest: jest.fn().mockResolvedValue({ isNew: true }),
    cacheResult: jest.fn().mockImplementation(async () => { order.push('idempotency:cached'); }),
    releaseInflight: jest.fn().mockResolvedValue(undefined),
  };
  const eventBus = {
    publish: jest.fn().mockImplementation(async () => { order.push('event:published'); }),
  };
  const logStructured = jest.fn();

  registerSocketCancelRideHandler({
    socket,
    io,
    extractTraceIdFromEvent: jest.fn(() => 'trace_driver_cancel'),
    traceContext: { runWithTraceId: jest.fn(async (_traceId, callback) => callback()) },
    logStructured,
    rateLimiterService: { checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }) },
    redisPool: {
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      getConnection: jest.fn(() => redis),
    },
    RideStateManager: {
      STATES: { SEARCHING: 'SEARCHING', PENDING: 'PENDING' },
      getBookingState: jest.fn().mockResolvedValue('ACCEPTED'),
    },
    gradualExpander: { stopSearch: jest.fn() },
    GeoHashUtils: { getRegionHash: jest.fn() },
    rideQueueManager: { dequeueRide: jest.fn() },
    CancelRideCommand,
    eventBus,
    PaymentService,
    fcmService: { sendRideStatusUpdate: jest.fn().mockResolvedValue(undefined) },
    assertRideParticipant: jest.fn().mockResolvedValue({
      allowed: true,
      participantRole: 'driver',
      identity: { userId: 'driver_1' },
    }),
    idempotencyService,
    getTracer: jest.fn(() => ({})),
    createCommandSpan: jest.fn(() => ({})),
    createEventSpan: jest.fn(() => ({ spanContext: jest.fn(() => ({})) })),
    runInSpan: jest.fn(async (_span, callback) => callback()),
    endSpanError: jest.fn(),
    logCommand: jest.fn(),
    logEvent: jest.fn(),
  });

  return { socket, io, roomEmits, execute, paymentService, idempotencyService, eventBus, logStructured, order };
};

const initiatorAnswer = (roomEmits) => roomEmits.find(
  ({ room, event }) => room === 'driver_driver_1' && event === 'rideCancelled'
);

describe('cancelRide handler - ordem da resposta ao iniciador', () => {
  beforeEach(() => {
    mockMarkRideCancelled.mockReset();
  });

  it('responde ao motorista depois do command e sem esperar o espelho do Firestore', async () => {
    const order = [];
    let releaseMirror;
    mockMarkRideCancelled.mockImplementation(() => {
      order.push('mirror:started');
      return new Promise((resolve) => { releaseMirror = resolve; });
    });
    const ctx = arrange({ order });

    let handlerFinished = false;
    const pending = ctx.socket.trigger('cancelRide', {
      bookingId: 'booking_driver_cancel',
      reason: 'Motorista cancelou',
    }).then(() => { handlerFinished = true; });
    await flushAsync();
    await flushAsync();

    // O espelho ainda não terminou e o motorista já recebeu a resposta.
    const answer = initiatorAnswer(ctx.roomEmits);
    expect(answer).toBeDefined();
    expect(answer.payload).toMatchObject({
      success: true,
      bookingId: 'booking_driver_cancel',
      data: expect.objectContaining({
        refundStatus: 'REFUNDED_FULL',
        refundAmount: 48.61,
        refundId: 'refund_driver_cancel',
      }),
    });
    expect(handlerFinished).toBe(false);
    expect(ctx.execute).toHaveBeenCalledTimes(1);
    expect(ctx.paymentService.processRideRefund).not.toHaveBeenCalled();
    expect(ctx.paymentService.markPaymentRefunded).not.toHaveBeenCalled();

    const answerIndex = order.indexOf('emit:driver_driver_1:rideCancelled');
    expect(order.indexOf('command:state_committed')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('command:state_committed')).toBeLessThan(answerIndex);
    expect(order.indexOf('event:published')).toBeLessThan(answerIndex);
    expect(order.indexOf('idempotency:cached')).toBeLessThan(answerIndex);
    expect(order.indexOf('command:state_committed')).toBeLessThan(order.indexOf('mirror:started'));

    releaseMirror({ success: true });
    await pending;
    expect(handlerFinished).toBe(true);
    expect(mockMarkRideCancelled).toHaveBeenCalledTimes(1);
    expect(mockMarkRideCancelled).toHaveBeenCalledWith(
      'booking_driver_cancel',
      'Motorista cancelou',
      expect.objectContaining({ driverId: 'driver_1' })
    );
    expect(ctx.socket.emit).not.toHaveBeenCalledWith('rideCancellationError', expect.anything());
  });

  it('não responde rideCancelled nem espelha quando o command falha (reembolso recusado)', async () => {
    const ctx = arrange({
      commandResult: { success: false, error: 'Falha ao processar reembolso PIX' },
    });

    await ctx.socket.trigger('cancelRide', { bookingId: 'booking_driver_cancel' });

    expect(initiatorAnswer(ctx.roomEmits)).toBeUndefined();
    expect(ctx.socket.emit).toHaveBeenCalledWith('rideCancellationError', {
      error: 'Falha ao processar reembolso PIX',
    });
    expect(mockMarkRideCancelled).not.toHaveBeenCalled();
    expect(ctx.eventBus.publish).not.toHaveBeenCalled();
    expect(ctx.idempotencyService.cacheResult).not.toHaveBeenCalled();
    expect(ctx.idempotencyService.releaseInflight).toHaveBeenCalledWith('idem_driver_cancel');
  });

  it('registra a falha do espelho do Firestore sem transformar o cancelamento em erro', async () => {
    mockMarkRideCancelled.mockRejectedValue(new Error('firestore deadline exceeded'));
    const ctx = arrange();

    await ctx.socket.trigger('cancelRide', { bookingId: 'booking_driver_cancel' });

    expect(initiatorAnswer(ctx.roomEmits)).toBeDefined();
    expect(ctx.logStructured).toHaveBeenCalledWith(
      'error',
      'Erro ao marcar corrida como cancelada no Firestore',
      expect.objectContaining({
        bookingId: 'booking_driver_cancel',
        error: 'firestore deadline exceeded',
      })
    );
    expect(ctx.socket.emit).not.toHaveBeenCalledWith('rideCancellationError', expect.anything());
    expect(ctx.idempotencyService.releaseInflight).not.toHaveBeenCalled();
  });
});
