import { createPrototypeRideTelemetryRuntime } from '../src/screens/prototype/prototypeRideTelemetryRuntime';

function createTelemetryServiceMock() {
  let nextId = 1;
  const contexts = new Map();

  return {
    ensureContext: jest.fn((payload = {}) => {
      const contextId = payload.contextId || `ctx_${nextId++}`;
      const context = {
        contextId,
        bookingId: payload.bookingId || null,
        sourceKey: payload.sourceKey || null,
        sourceMeta: payload.sourceMeta || {},
      };
      contexts.set(contextId, context);
      return context;
    }),
    bindContextToBooking: jest.fn((payload = {}) => {
      const contextId = payload.contextId || `ctx_${nextId++}`;
      const context = {
        contextId,
        bookingId: payload.bookingId || null,
        sourceKey: payload.sourceKey || null,
        sourceMeta: payload.sourceMeta || {},
      };
      contexts.set(contextId, context);
      return context;
    }),
    rotateDraftContext: jest.fn((payload = {}) => {
      const context = {
        contextId: `ctx_${nextId++}`,
        bookingId: null,
        sourceKey: payload.sourceKey || null,
        sourceMeta: payload.sourceMeta || {},
      };
      contexts.set(context.contextId, context);
      return context;
    }),
  };
}

describe('prototype ride telemetry runtime controller', () => {
  it('resolves passenger source metadata from runtime state by default', () => {
    const telemetryService = createTelemetryServiceMock();
    const controller = createPrototypeRideTelemetryRuntime({
      telemetryService,
      platformOS: 'ios',
      getRuntimeState: () => ({
        activeRole: 'passenger',
        profileUid: 'user_1',
      }),
    });

    expect(controller.resolveSourceMeta()).toEqual({
      userId: 'user_1',
      userType: 'customer',
      platform: 'ios',
      flow: 'prototype',
      scenario: 'robotaxi_prototype',
      surface: 'prototype_runtime',
    });
  });

  it('keeps one draft context before a booking exists and applies route overrides', () => {
    const telemetryService = createTelemetryServiceMock();
    const controller = createPrototypeRideTelemetryRuntime({
      telemetryService,
      platformOS: 'android',
      getRuntimeState: () => ({
        activeRole: 'passenger',
        profileUid: 'customer_2',
      }),
    });

    const first = controller.resolveContext({
      cacheMode: 'backend_hit',
      routeScope: 'passenger_to_destination',
      surface: 'category_selection',
    });
    const second = controller.resolveContext();

    expect(first.contextId).toBe(second.contextId);
    expect(first).toEqual(expect.objectContaining({
      cacheMode: 'backend_hit',
      routeScope: 'passenger_to_destination',
      surface: 'category_selection',
      sourceKey: 'customer:customer_2',
    }));
    expect(telemetryService.ensureContext).toHaveBeenCalledTimes(3);
  });

  it('resolves a direct booking context from active booking state without using the draft id', () => {
    const telemetryService = createTelemetryServiceMock();
    const controller = createPrototypeRideTelemetryRuntime({
      telemetryService,
      platformOS: 'ios',
      getRuntimeState: () => ({
        activeRole: 'driver',
        profileUid: 'driver_1',
        activeBookingId: 'booking_active',
      }),
    });

    const context = controller.resolveContext({ forceFresh: true });

    expect(context).toEqual(expect.objectContaining({
      bookingId: 'booking_active',
      forceFresh: true,
      sourceKey: 'driver:driver_1',
    }));
    expect(telemetryService.ensureContext).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking_active',
      sourceMeta: expect.objectContaining({
        userType: 'driver',
      }),
    }));
  });

  it('binds the open draft context to a booking and resets the draft id', () => {
    const telemetryService = createTelemetryServiceMock();
    const controller = createPrototypeRideTelemetryRuntime({
      telemetryService,
      platformOS: 'ios',
      getRuntimeState: () => ({
        activeRole: 'passenger',
        profileUid: 'customer_3',
      }),
    });

    const draft = controller.resolveContext();
    expect(controller.getDraftContextIdForTests()).toBe(draft.contextId);

    const bound = controller.bindToBooking(' booking_123 ');

    expect(bound).toEqual(expect.objectContaining({
      contextId: draft.contextId,
      bookingId: 'booking_123',
    }));
    expect(controller.getDraftContextIdForTests()).toBeNull();
    expect(controller.bindToBooking('')).toBeNull();
  });

  it('rotates a draft context for the same runtime source', () => {
    const telemetryService = createTelemetryServiceMock();
    const controller = createPrototypeRideTelemetryRuntime({
      telemetryService,
      platformOS: 'android',
      getRuntimeState: () => ({
        activeRole: 'passenger',
        profileUid: 'customer_4',
      }),
    });

    const first = controller.resolveContext();
    const rotated = controller.rotateDraftContext({ sourceKey: 'custom:source' });

    expect(rotated.contextId).not.toBe(first.contextId);
    expect(rotated.sourceKey).toBe('custom:source');
    expect(controller.getDraftContextIdForTests()).toBe(rotated.contextId);
  });
});
