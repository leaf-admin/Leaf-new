const {
  MAX_CONSUMER_NAME_LENGTH,
  resolveWorkerInstanceId,
  buildWorkerConsumerName
} = require('../../../workers/worker-consumer-identity');

describe('distributed worker consumer identity', () => {
  it('separates equal PIDs running on different hosts', () => {
    const first = buildWorkerConsumerName('billing-worker', {
      env: {},
      hostname: 'leaf-host-a',
      pid: 1
    });
    const second = buildWorkerConsumerName('billing-worker', {
      env: {},
      hostname: 'leaf-host-b',
      pid: 1
    });

    expect(first).toBe('billing-worker-leaf-host-a-1');
    expect(second).toBe('billing-worker-leaf-host-b-1');
    expect(first).not.toBe(second);
  });

  it('separates multiple worker processes on the same host', () => {
    expect(buildWorkerConsumerName('listener-worker', {
      env: {},
      hostname: 'leaf-host-a',
      pid: 10
    })).not.toBe(buildWorkerConsumerName('listener-worker', {
      env: {},
      hostname: 'leaf-host-a',
      pid: 11
    }));
  });

  it('builds a stable pidless identity for the trip worker healthcheck', () => {
    const options = {
      env: { LEAF_WORKER_INSTANCE_ID: 'realtime-b' },
      hostname: 'ignored-host',
      includePid: false
    };

    expect(buildWorkerConsumerName('trip-location-worker', options))
      .toBe('trip-location-worker-realtime-b');
  });

  it('prefers the explicit deployment instance id and sanitizes it', () => {
    expect(resolveWorkerInstanceId({
      env: {
        LEAF_WORKER_INSTANCE_ID: 'host B / zone 2',
        HOSTNAME: 'container-id'
      },
      hostname: 'ignored-host'
    })).toBe('host-B-zone-2');
  });

  it('bounds the Redis consumer name', () => {
    const consumerName = buildWorkerConsumerName('worker', {
      env: { LEAF_WORKER_INSTANCE_ID: 'a'.repeat(256) },
      pid: 123
    });

    expect(consumerName.length).toBeLessThanOrEqual(MAX_CONSUMER_NAME_LENGTH);
    expect(consumerName).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
