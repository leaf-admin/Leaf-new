import { isRideGoneOnServerError } from '../src/screens/prototype/rideServerErrors';

describe('isRideGoneOnServerError', () => {
  it('recognises the server answers for a ride that no longer exists', () => {
    expect(isRideGoneOnServerError(new Error('Corrida não encontrada'))).toBe(true);
    expect(isRideGoneOnServerError(new Error('Corrida já está cancelada'))).toBe(true);
    expect(isRideGoneOnServerError(Object.assign(new Error('x'), { code: 'RIDE_NOT_FOUND' }))).toBe(true);
  });

  it('keeps the ride for failures where the server may still hold it', () => {
    expect(isRideGoneOnServerError(new Error('Cancel ride timeout'))).toBe(false);
    expect(isRideGoneOnServerError(new Error('WebSocket não conectado'))).toBe(false);
    expect(isRideGoneOnServerError(new Error('Pagamento já foi repassado ao motorista.'))).toBe(false);
    expect(isRideGoneOnServerError(null)).toBe(false);
  });
});
