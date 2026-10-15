// The optimized redaction must produce exactly the same log output as the
// previous implementation (kept in fixtures/log-redaction.reference.js).
const current = require('../../../utils/log-redaction');
const reference = require('./fixtures/log-redaction.reference');

class Point { constructor() { this.lat = -22.9; this.lng = -43.2; this.apiKey = 'k'; } }

function inputs() {
  const shared = { a: 1 };
  const circular = { name: 'loop' };
  circular.self = circular;
  return [
    'plain message without secrets',
    'Authorization: Bearer abc.def',
    'token=xyz; other=1',
    'password: "hunter2", user=bob',
    'client_secret=s3cr3t',
    'cookie=a=b',
    'keyboard and monkey',
    { driverId: 'd1', bookingId: 'b1', nested: { lat: 1, lng: 2, tags: ['x', 'y'] } },
    { accessToken: 'abc', profile: { fcmToken: 'f', deviceFingerprint: 'keep', name: 'Ana' } },
    { message: 'Bearer zzz', list: [{ password: 'p' }, 'Authorization: x', 3, null] },
    { err: new Error('boom'), point: new Point(), when: new Date(0) },
    { first: shared, second: shared },
    circular,
    { deep: { deeper: { deepest: { refresh_token: 'r', ok: true } } } },
    [1, 'two', { three: 3, apiKey: 'k' }],
    { emptyObj: {}, emptyArr: [], zero: 0, no: false, nothing: null, undef: undefined },
    Object.assign(Object.create(null), { a: 1, token: 'secret' })
  ];
}

describe('log redaction equivalence', () => {
  test.each(inputs().map((value, index) => [index, value]))('input %i redacts the same as before', (_index, value) => {
    expect(JSON.stringify(current.redactSensitiveValue(value, ''))).toBe(JSON.stringify(reference.redactSensitiveValue(value, '')));
    expect(JSON.stringify(current.redactSensitiveValue(value, 'payload'))).toBe(JSON.stringify(reference.redactSensitiveValue(value, 'payload')));
    expect(JSON.stringify(current.redactSensitiveValue(value, 'authorization'))).toBe(JSON.stringify(reference.redactSensitiveValue(value, 'authorization')));
  });

  test('redactLogInfoInPlace gives the same info object', () => {
    const make = () => ({ level: 'info', message: 'Bearer abc', driverId: 'd1', meta: { idToken: 't', lat: 1 } });
    expect(JSON.stringify(current.redactLogInfoInPlace(make()))).toBe(JSON.stringify(reference.redactLogInfoInPlace(make())));
  });

  test('isSensitiveKey matches for repeated lookups', () => {
    for (const key of ['token', 'deviceFingerprint', 'Authorization', 'name', 'name', 'fcm_token', 'tokenCount', '']) {
      expect(current.isSensitiveKey(key)).toBe(reference.isSensitiveKey(key));
    }
  });
});
