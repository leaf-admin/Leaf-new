jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const { BiometricJobLimiter } = require('../../../services/biometric-job-limiter');

describe('BiometricJobLimiter', () => {
  test('limits concurrent server-side biometric jobs', async () => {
    const limiter = new BiometricJobLimiter({
      maxConcurrency: 2,
      maxQueue: 10
    });
    let active = 0;
    let maxActive = 0;

    const jobs = Array.from({ length: 6 }, (_, index) => limiter.run('unit', async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return index;
    }));

    const results = await Promise.all(jobs);
    expect(results.map((item) => item.result).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxActive).toBe(2);
    expect(limiter.getStats()).toMatchObject({
      active: 0,
      queued: 0,
      completed: 6
    });
  });

  test('rejects when the biometric queue is full', async () => {
    const limiter = new BiometricJobLimiter({
      maxConcurrency: 1,
      maxQueue: 1
    });

    const blocker = limiter.run('unit', () => new Promise((resolve) => setTimeout(resolve, 25)));
    const queued = limiter.run('unit', async () => 'queued');

    await expect(limiter.run('unit', async () => 'overflow')).rejects.toMatchObject({
      code: 'BIOMETRIC_QUEUE_OVERLOADED'
    });

    await Promise.all([blocker, queued]);
  });
});
