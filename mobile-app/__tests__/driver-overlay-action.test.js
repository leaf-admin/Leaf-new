jest.mock('../src/services/PrototypeDriverTripAssistantService', () => ({
  PICKUP_TOLERANCE_METERS: 80,
  DESTINATION_ALERT_METERS: 500,
  calculateDistanceMeters: jest.fn(),
}));

import { calculateDistanceMeters } from '../src/services/PrototypeDriverTripAssistantService';
import { executeDriverOverlayAction } from '../src/services/executeDriverOverlayAction';

describe('driver actions from the external overlay', () => {
  let context;
  let commands;
  const location = { lat: -22.9, lng: -43.4 };
  const run = (actionIdentifier, bookingId = 'b1') => executeDriverOverlayAction(
    { actionIdentifier, bookingId }, commands,
  );

  beforeEach(() => {
    context = { bookingId: 'b1', status: 'accepted', pickupCoordinate: location, destinationCoordinate: location };
    commands = {
      getContext: jest.fn(async () => context),
      resolveLocation: jest.fn().mockResolvedValue(location),
      arrive: jest.fn().mockResolvedValue({ success: true }),
      start: jest.fn().mockResolvedValue({ success: true }),
      complete: jest.fn().mockResolvedValue({ success: true }),
    };
    calculateDistanceMeters.mockReturnValue(20);
  });

  it.each(['', 'old-ride'])('does not execute a stale/missing ride %s', async (id) => {
    await expect(run('arrived_at_pickup', id)).rejects.toThrow('etapa mudou');
    expect(commands.arrive).not.toHaveBeenCalled();
    expect(commands.resolveLocation).not.toHaveBeenCalled();
  });

  it('rejects a button from a previous stage', async () => {
    context.status = 'started';
    await expect(run('start_trip')).rejects.toThrow('etapa mudou');
    expect(commands.start).not.toHaveBeenCalled();
  });

  it('does not act on a new ride that replaced the old one during a GPS read', async () => {
    commands.resolveLocation.mockImplementation(async () => {
      context = { ...context, bookingId: 'b2' };
      return location;
    });
    await expect(run('arrived_at_pickup')).rejects.toThrow('etapa mudou');
    expect(commands.arrive).not.toHaveBeenCalled();
  });

  it('uses current location and the existing pickup tolerance', async () => {
    context.pickupToleranceReached = true;
    calculateDistanceMeters.mockReturnValue(81);
    await expect(run('arrived_at_pickup')).rejects.toThrow('Aproxime-se');
    expect(commands.arrive).not.toHaveBeenCalled();
    calculateDistanceMeters.mockReturnValue(80);
    await expect(run('arrived_at_pickup')).resolves.toEqual({ success: true });
    expect(commands.arrive).toHaveBeenCalledWith({ locationOverride: location });
  });

  it('keeps backend payment/start rejection authoritative', async () => {
    context.status = 'arrived';
    commands.start.mockRejectedValue(new Error('Pagamento não confirmado'));
    await expect(run('start_trip')).rejects.toThrow('Pagamento não confirmado');
    expect(commands.start).toHaveBeenCalledWith({ locationOverride: location });
  });

  it('completes at the destination through the existing command', async () => {
    context.status = 'started';
    calculateDistanceMeters.mockReturnValue(500);
    await expect(run('end_trip')).resolves.toEqual({ success: true });
    expect(commands.complete).toHaveBeenCalledWith({ locationOverride: location });
  });

  it('checks the updated destination if it changes during the GPS read', async () => {
    context.status = 'started';
    const updatedDestination = { lat: -22.8, lng: -43.5 };
    commands.resolveLocation.mockImplementation(async () => {
      context = { ...context, destinationCoordinate: updatedDestination };
      return location;
    });
    calculateDistanceMeters.mockReturnValue(600);
    await expect(run('end_trip')).rejects.toThrow('antes do destino');
    expect(calculateDistanceMeters).toHaveBeenLastCalledWith(location, updatedDestination);
    expect(commands.complete).not.toHaveBeenCalled();
  });

  it.each([501, null, NaN])('does not bypass the early-end consent flow at distance %s', async (meters) => {
    context.status = 'started';
    context.remainingMeters = 0;
    calculateDistanceMeters.mockReturnValue(meters);
    await expect(run('end_trip')).rejects.toThrow('antes do destino');
    expect(commands.complete).not.toHaveBeenCalled();
  });
});
