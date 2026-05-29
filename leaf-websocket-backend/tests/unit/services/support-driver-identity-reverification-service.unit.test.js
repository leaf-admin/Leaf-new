jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const mockMarkDriverForPhotoMismatch = jest.fn();

jest.mock('../../../services/kyc-policy-service', () => ({
  isPhotoMismatchReport: jest.fn((payload = {}) =>
    String(`${payload.subject || ''} ${payload.description || ''} ${payload.comment || ''}`)
      .toLowerCase()
      .includes('motorista diferente')
  ),
  markDriverForPhotoMismatch: (...args) => mockMarkDriverForPhotoMismatch(...args)
}));

jest.mock('../../../firebase-config', () => ({
  getFromRealtimeDB: jest.fn()
}));

describe('support-driver-identity-reverification-service', () => {
  beforeEach(() => {
    jest.resetModules();
    mockMarkDriverForPhotoMismatch.mockResolvedValue({
      success: true,
      reverifyRequired: true,
      softBlocked: true
    });
  });

  test('triggers subtle driver identity reverification from support ticket text', async () => {
    const service = require('../../../services/support-driver-identity-reverification-service');

    const result = await service.handleTicket({
      id: 'ticket_1',
      userId: 'passenger_1',
      userType: 'passenger',
      subject: 'Motorista diferente do cadastro',
      description: 'O motorista diferente da foto chegou no carro.',
      metadata: {
        bookingId: 'booking_1',
        driverId: 'driver_1'
      }
    });

    expect(result).toEqual(expect.objectContaining({
      triggered: true,
      driverId: 'driver_1',
      softBlocked: true
    }));
    expect(mockMarkDriverForPhotoMismatch).toHaveBeenCalledWith(expect.objectContaining({
      driverId: 'driver_1',
      tripId: 'booking_1',
      reporterId: 'passenger_1',
      supportTicketId: 'ticket_1'
    }));
  });

  test('does not trigger when support ticket has no identity mismatch signal', async () => {
    const service = require('../../../services/support-driver-identity-reverification-service');

    const result = await service.handleTicket({
      id: 'ticket_2',
      subject: 'Ajuda com pagamento',
      description: 'Meu pix ainda nao confirmou.',
      metadata: { driverId: 'driver_2' }
    });

    expect(result).toEqual({
      triggered: false,
      reason: 'no_identity_mismatch_signal'
    });
    expect(mockMarkDriverForPhotoMismatch).not.toHaveBeenCalled();
  });
});
