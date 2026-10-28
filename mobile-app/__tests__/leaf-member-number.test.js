import {
  formatLeafMemberNumber,
  isValidLeafMemberNumber,
  luhnCheckDigit,
  resolveLeafMemberNumber,
} from '../src/utils/leafMemberNumber';

describe('leafMemberNumber', () => {
  it('derives a stable 12-digit number with a valid Luhn check digit', () => {
    const first = resolveLeafMemberNumber('driver_uid_123');
    expect(first).toMatch(/^\d{12}$/);
    expect(resolveLeafMemberNumber('driver_uid_123')).toBe(first);
    expect(isValidLeafMemberNumber(first)).toBe(true);
    expect(resolveLeafMemberNumber('driver_uid_124')).not.toBe(first);
  });

  it('rejects a mistyped digit and empty uids', () => {
    const number = resolveLeafMemberNumber('passenger_uid_9');
    const mistyped = `${(Number(number[0]) + 1) % 10}${number.slice(1)}`;
    expect(isValidLeafMemberNumber(mistyped)).toBe(false);
    expect(resolveLeafMemberNumber('')).toBe('');
  });

  it('computes the standard Luhn digit and groups digits for display', () => {
    expect(luhnCheckDigit('7992739871')).toBe('3');
    expect(formatLeafMemberNumber('123456789012')).toBe('1234 5678 9012');
  });
});
