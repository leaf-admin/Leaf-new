import {
  buildRideConfirmationMessage,
  checkPendingRideConfirmations,
} from '../src/screens/prototype/home/passengerRideConfirmation';

jest.mock('../src/services/httpClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/components/design-system/LeafChoiceSheet', () => ({ showLeafChoiceSheet: jest.fn() }));

function buildClient(pending) {
  return {
    get: jest.fn().mockResolvedValue({ data: { success: true, pending } }),
    post: jest.fn().mockResolvedValue({ data: { success: true } }),
  };
}

describe('passenger ride confirmation', () => {
  it('does nothing when there is no pending confirmation', async () => {
    const client = buildClient([]);
    const ask = jest.fn();
    await expect(checkPendingRideConfirmations({ ask, client })).resolves.toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('asks about the ride and sends the answer', async () => {
    const client = buildClient([
      { bookingId: 'b1', pickupAddress: 'Rua Barata Ribeiro, 200, Copacabana', destinationAddress: 'Praia de Ipanema, Rio' },
    ]);
    const ask = jest.fn().mockResolvedValue('did_not_take_ride');

    await expect(checkPendingRideConfirmations({ ask, client })).resolves.toEqual({
      bookingId: 'b1',
      answer: 'did_not_take_ride',
    });
    const request = ask.mock.calls[0][0];
    expect(request.title).toBe('Você fez esta corrida?');
    expect(request.message).toContain('Rua Barata Ribeiro → Praia de Ipanema');
    expect(request.options.map(option => option.key)).toEqual(['took_ride', 'did_not_take_ride']);
    expect(client.post).toHaveBeenCalledWith('/api/rides/b1/confirmation', { tookRide: false });
  });

  it('sends nothing when the passenger closes the sheet', async () => {
    const client = buildClient([{ bookingId: 'b1' }]);
    const ask = jest.fn().mockResolvedValue(null);
    await expect(checkPendingRideConfirmations({ ask, client })).resolves.toBeNull();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('never mentions the driver or a suspicion in the message', () => {
    const message = buildRideConfirmationMessage({ pickupAddress: 'A', destinationAddress: 'B' });
    expect(message).not.toMatch(/motorista|suspeit|fraude|irregular/i);
  });
});
