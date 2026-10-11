import { confirmDriverEarlyEnd } from '../src/screens/prototype/home/driverEarlyEndConfirm';
import { showLeafChoiceSheet } from '../src/components/design-system/LeafChoiceSheet';

jest.mock('../src/components/design-system/LeafChoiceSheet', () => ({
  showLeafChoiceSheet: jest.fn(),
}));

describe('driver early end confirmation', () => {
  beforeEach(() => {
    showLeafChoiceSheet.mockReset();
  });

  it('does not ask when the car is at the destination', async () => {
    await expect(confirmDriverEarlyEnd(120)).resolves.toBeNull();
    await expect(confirmDriverEarlyEnd(undefined)).resolves.toBeNull();
    expect(showLeafChoiceSheet).not.toHaveBeenCalled();
  });

  it('asks for a reason when the trip ends far from the destination', async () => {
    showLeafChoiceSheet.mockResolvedValue('passenger_request');

    await expect(confirmDriverEarlyEnd(8100)).resolves.toEqual({
      reason: 'passenger_request',
      remainingMeters: 8100,
    });
    const request = showLeafChoiceSheet.mock.calls[0][0];
    expect(request.title).toBe('Encerrar antes do destino?');
    expect(request.message).toContain('8,1 km');
    expect(request.options.map(option => option.key)).toEqual([
      'continue',
      'passenger_request',
      'trip_problem',
    ]);
  });

  it('keeps the trip going when the driver continues or dismisses', async () => {
    showLeafChoiceSheet.mockResolvedValueOnce('continue').mockResolvedValueOnce(null);

    await expect(confirmDriverEarlyEnd(900)).resolves.toEqual({ cancelled: true });
    await expect(confirmDriverEarlyEnd(900)).resolves.toEqual({ cancelled: true });
  });
});
