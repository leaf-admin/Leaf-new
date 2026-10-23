import { AppState, DeviceEventEmitter, NativeModules, Platform } from 'react-native';

describe('ride overlay over the navigation app (Android)', () => {
  let native;
  let overlay;
  let changeListener;
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.resetModules();
    Platform.OS = 'android';
    native = {
      getStatus: jest.fn().mockResolvedValue({ overlaySupported: true, canDrawOverlays: true, liveUpdateSupported: false }),
      showOverlay: jest.fn().mockResolvedValue(true),
      hideOverlay: jest.fn().mockResolvedValue(true),
      showLiveUpdate: jest.fn().mockResolvedValue(false),
      cancelLiveUpdate: jest.fn().mockResolvedValue(true),
      openOverlaySettings: jest.fn().mockResolvedValue(true),
      showOfferCard: jest.fn().mockResolvedValue(true),
      hideOfferCard: jest.fn().mockResolvedValue(true),
      completeOverlayAction: jest.fn().mockResolvedValue(true),
    };
    NativeModules.LeafRideOverlay = native;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
      changeListener = listener;
      return { remove: jest.fn() };
    });
    overlay = require('../src/services/LeafRideOverlay');
  });

  afterEach(() => {
    Platform.OS = originalOS;
    delete NativeModules.LeafRideOverlay;
    jest.restoreAllMocks();
  });

  it('builds the bubble from the ride notification, with the stage button and no "Navegar"', () => {
    const state = overlay.buildRideOverlayState({
      bookingId: 'b1',
      status: 'started',
      ongoing: { title: 'Chegada às 14:47', subtitle: '12 min · 5 km', body: 'Destino: Via Parque', progress: 0.4, countdownSeconds: 700 },
      actions: [
        { identifier: 'open_navigation', buttonTitle: 'Navegar' },
        { identifier: 'end_trip', buttonTitle: 'Encerrar' },
      ],
      nearDestination: true,
    });
    expect(state).toEqual(expect.objectContaining({
      bookingId: 'b1',
      title: 'Chegada às 14:47',
      subtitle: '12 min · 5 km',
      body: 'Destino: Via Parque',
      progress: 0.4,
      shortText: '12 min',
      actionId: 'end_trip',
      actionLabel: 'Encerrar',
      legKey: 'b1:started',
      pillText: 'Chegando',
    }));
    expect(overlay.buildRideOverlayState({ bookingId: 'b1', status: 'arrived', ongoing: { progress: null } }).progress).toBe(-1);
    // Mid-trip, far from the destination: no "Encerrar" in the bubble.
    const midTrip = overlay.buildRideOverlayState({
      bookingId: 'b1',
      status: 'started',
      ongoing: { title: 'Chegada às 14:47' },
      actions: [{ identifier: 'open_navigation', buttonTitle: 'Navegar' }, { identifier: 'end_trip', buttonTitle: 'Encerrar' }],
    });
    expect(midTrip.actionId).toBe('');
    expect(midTrip.pillText).toBe('Em viagem');
  });

  it('gives the collapsed pill a short label for each stage', () => {
    const label = (status, actions = []) =>
      overlay.buildRideOverlayState({ bookingId: 'b1', status, ongoing: {}, actions }).pillText;
    expect(label('accepted')).toBe('A caminho');
    expect(label('accepted', [{ identifier: 'arrived_at_pickup', buttonTitle: 'Cheguei ao embarque' }])).toBe('No embarque');
    expect(label('arrived')).toBe('Embarque');
    expect(label('started')).toBe('Em viagem');
  });

  it('presents the ribbon from existing ride data without changing notification copy', () => {
    const trip = overlay.buildRideOverlayState({
      status: 'started', destinationAddress: 'Via Parque Shopping', distanceKm: 4.9,
      ongoing: { title: 'Chegada às 14:28', subtitle: '8 min · 4,9 km', body: 'Destino: Via Parque · R$ 38,00', countdownSeconds: 480 },
    });
    expect(trip).toEqual(expect.objectContaining({
      ribbonMetric: '8 min', ribbonMetricLabel: 'até o destino', ribbonTitle: 'Via Parque Shopping',
      ribbonDetail: '4,9 km restantes', title: 'Chegada às 14:28', body: 'Destino: Via Parque · R$ 38,00',
    }));
    const pickup = overlay.buildRideOverlayState({
      status: 'accepted', distanceKm: 0, pickupAddress: 'R. das Pastorinhas, 4',
      actions: [{ identifier: 'arrived_at_pickup', buttonTitle: 'Cheguei ao embarque' }],
    });
    expect(pickup.ribbonMetric).toBe('0 m');
    expect(pickup.ribbonDetail).toBe('R. das Pastorinhas, 4');
    const boarding = overlay.buildRideOverlayState({ status: 'arrived', ongoing: { countdownSeconds: 102 } });
    expect(boarding.ribbonCountdownSeconds).toBe(102);
    expect(overlay.buildRideOverlayState({ status: 'arrived', ongoing: { countdownSeconds: -1 } }).ribbonCountdownSeconds).toBe(0);
    expect(overlay.buildRideOverlayState({ status: 'accepted', distanceKm: null }).ribbonMetric).toBe('—');
  });

  it('executes a background action once and confirms only after the lifecycle ACK', async () => {
    const controller = overlay.default;
    let ack;
    const executor = jest.fn(() => new Promise((resolve) => { ack = resolve; }));
    controller.setActionExecutor(executor);
    controller.state = { bookingId: 'b1', actionId: 'start_trip' };
    AppState.currentState = 'background';
    const request = { requestId: 'r1', bookingId: 'b1', actionIdentifier: 'start_trip' };
    const pending = controller.handleAction(request);
    await controller.handleAction(request);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(native.completeOverlayAction).not.toHaveBeenCalled();
    ack({ success: true });
    await pending;
    expect(native.completeOverlayAction).toHaveBeenCalledWith('r1', true, 'Confirmado');
    controller.setActionExecutor(null);
  });

  it('rejects stale ride buttons and backend failures without reporting success', async () => {
    const controller = overlay.default;
    const executor = jest.fn().mockRejectedValue(new Error('Pagamento ainda não confirmado.'));
    controller.setActionExecutor(executor);
    controller.state = { bookingId: 'b1', actionId: 'start_trip' };
    await controller.handleAction({ requestId: 'old', bookingId: 'b0', actionIdentifier: 'start_trip' });
    expect(executor).not.toHaveBeenCalled();
    expect(native.completeOverlayAction).toHaveBeenLastCalledWith('old', false, expect.any(String));
    await controller.handleAction({ requestId: 'current', bookingId: 'b1', actionIdentifier: 'start_trip' });
    expect(native.completeOverlayAction).toHaveBeenLastCalledWith('current', false, 'Pagamento ainda não confirmado.');
    controller.setActionExecutor(null);
  });

  it('receives native events only while the driver executor is registered', async () => {
    const remove = jest.fn();
    const listen = jest.spyOn(DeviceEventEmitter, 'addListener').mockReturnValue({ remove });
    overlay.default.setActionExecutor(jest.fn());
    expect(listen).toHaveBeenCalledWith('LeafRideOverlayAction', expect.any(Function));
    overlay.default.setActionExecutor(null);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('shows the bubble only while Leaf is in the background, and clears it at the end of the ride', async () => {
    const controller = overlay.default;
    AppState.currentState = 'active';
    controller.appState = 'active';
    await controller.update({ bookingId: 'b1', title: 'Buscar Ana' });
    expect(native.showOverlay).not.toHaveBeenCalled();

    AppState.currentState = 'background';
    controller.appState = 'background';
    await controller.render();
    expect(native.showOverlay).toHaveBeenCalledWith(expect.objectContaining({ title: 'Buscar Ana' }));

    changeListener('active');
    await new Promise((resolve) => setImmediate(resolve));
    expect(native.hideOverlay).toHaveBeenCalled();

    native.showLiveUpdate.mockResolvedValueOnce(true);
    await controller.showLiveUpdate({ bookingId: 'b1' });
    await controller.dismiss();
    expect(native.cancelLiveUpdate).toHaveBeenCalled();
  });

  it('stays off when the driver turned the bubble off', async () => {
    await overlay.setRideOverlayEnabled(false);
    const controller = overlay.default;
    AppState.currentState = 'background';
    controller.appState = 'background';
    await controller.update({ bookingId: 'b1', title: 'Buscar Ana' });
    expect(native.showOverlay).not.toHaveBeenCalled();
  });

  it('hides the bubble when Leaf comes back while a background update was drawing it', async () => {
    const controller = overlay.default;
    AppState.currentState = 'background';
    controller.appState = 'background';
    let finishShow;
    native.showOverlay.mockImplementationOnce(() => new Promise((resolve) => { finishShow = resolve; }));
    const pending = controller.update({ bookingId: 'b1', title: 'Buscar Ana' });
    await new Promise((resolve) => setImmediate(resolve));
    changeListener('active');
    finishShow(true);
    await pending;
    expect(native.hideOverlay).toHaveBeenCalled();
    expect(controller.overlayShown).toBe(false);
  });

  it('shows the full offer card over other apps only in the background, and clears it', async () => {
    const controller = overlay.default;
    const card = overlay.buildOfferCardState({
      bookingId: 'b9',
      fareLabel: 'R$ 40,09',
      pickupEtaLabel: '2 min',
      distanceLabel: '14,7 km',
      durationLabel: '20 min',
      perKmLabel: 'R$ 2,06/km',
      pickupLabel: 'R. das Pastorinhas',
      dropoffLabel: 'Via Parque Shopping',
      expiresAtMs: Date.now() + 15000,
    });
    expect(card.tripLine).toBe('2 min até o embarque · 14,7 km · 20 min');
    AppState.currentState = 'active';
    await controller.showOffer(card);
    expect(native.showOfferCard).not.toHaveBeenCalled();
    AppState.currentState = 'background';
    await controller.showOffer({ ...card, expiresAtMs: card.expiresAtMs + 1 });
    expect(native.showOfferCard).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'b9', fareLabel: 'R$ 40,09' }));
    await controller.clearOffer();
    expect(native.hideOfferCard).toHaveBeenCalled();
  });
});
