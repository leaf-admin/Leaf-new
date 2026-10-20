import { resolveDriverActionLocation } from '../src/services/driverActionLocation';

describe('location sent with a ride action from the notification or the bubble', () => {
  const NOW = 1792503600000;
  const stale = { lastDriverLocation: { latitude: -22.9265, longitude: -43.4085 } };

  it('uses the phone fix, not the position kept in the session since the accept', async () => {
    const location = await resolveDriverActionLocation(stale, {
      now: NOW,
      getLastKnownPosition: async () => ({ coords: { latitude: -22.92082, longitude: -43.40607 }, timestamp: NOW - 4000 }),
    });
    expect(location).toEqual({ latitude: -22.92082, longitude: -43.40607 });
  });

  it('falls back to the session when the phone has no recent fix', async () => {
    const old = await resolveDriverActionLocation(stale, {
      now: NOW,
      getLastKnownPosition: async () => ({ coords: { latitude: -22.9, longitude: -43.4 }, timestamp: NOW - 120000 }),
    });
    expect(old).toEqual({ latitude: -22.9265, longitude: -43.4085 });

    const failing = await resolveDriverActionLocation(stale, {
      getLastKnownPosition: async () => { throw new Error('no fix'); },
    });
    expect(failing).toEqual({ latitude: -22.9265, longitude: -43.4085 });
    await expect(resolveDriverActionLocation(null, { getLastKnownPosition: async () => null })).resolves.toBeNull();
  });
});
