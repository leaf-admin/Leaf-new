const { toApnsCollapseId } = require('../../../services/fcm-service');

describe('apns-collapse-id', () => {
  it('keeps short keys and shortens per-ride keys to the 64-byte APNs limit', () => {
    expect(toApnsCollapseId('leaf-ride-offer')).toBe('leaf-ride-offer');
    const key = 'leaf-ride-accepted-booking_1792671036678_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2';
    const id = toApnsCollapseId(key);
    expect(Buffer.byteLength(id)).toBeLessThanOrEqual(64);
    expect(id.startsWith('leaf-ride-accepted-booking_')).toBe(true);
    expect(toApnsCollapseId(key)).toBe(id);
    expect(toApnsCollapseId(key.replace('accepted', 'arrived'))).not.toBe(id);
  });
});
