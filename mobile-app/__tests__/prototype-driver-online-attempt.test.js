import { attemptCanonicalDriverOnlineStatus } from '../src/screens/prototype/driverOnlineCanonicalAttempt';

describe('canonical driver online attempt', () => {
  const statusLocation = {
    lat: -22.984,
    lng: -43.215,
    heading: 0,
    speed: 0,
  };

  it('reaches the socket with canAttemptOnline and preserves the canonical KYC challenge', async () => {
    const kycError = Object.assign(
      new Error('Validação facial necessária.'),
      {
        code: 'kycRequired',
        kycRequired: true,
        payload: {
          kycRequired: true,
          challengeId: 'challenge_identity_1',
          requirement: 'IDENTITY_REVERIFICATION',
        },
      },
    );
    const socket = {
      setDriverStatus: jest.fn().mockRejectedValue(kycError),
    };

    await expect(
      attemptCanonicalDriverOnlineStatus({
        activationState: {
          canGoOnline: false,
          canAttemptOnline: true,
        },
        socket,
        driverId: 'driver_1',
        statusLocation,
        destinationMode: { active: false },
      }),
    ).rejects.toBe(kycError);

    expect(socket.setDriverStatus).toHaveBeenCalledWith(
      'driver_1',
      'available',
      true,
      {
        timeoutMs: 12000,
        location: statusLocation,
        destinationMode: { active: false },
      },
    );
  });

  it('does not touch the socket when neither online gate is allowed', async () => {
    const socket = {
      setDriverStatus: jest.fn(),
    };

    await expect(
      attemptCanonicalDriverOnlineStatus({
        activationState: {
          canGoOnline: false,
          canAttemptOnline: false,
        },
        socket,
        driverId: 'driver_1',
        statusLocation,
      }),
    ).resolves.toEqual({
      success: false,
      blocked: true,
      reason: 'Ativação do motorista pendente.',
    });

    expect(socket.setDriverStatus).not.toHaveBeenCalled();
  });
});
