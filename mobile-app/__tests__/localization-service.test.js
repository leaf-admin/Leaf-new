import { getLangKey } from '../src/services/runtime/localizationBridge';

describe('localizationBridge', () => {
  it('normalizes display strings into translation keys', () => {
    expect(getLangKey('Leaf Plus')).toBe('leaf_plus_');
    expect(getLangKey('  Barra  Shopping  ')).toBe('barra_shopping_');
    expect(getLangKey('A.B#C$D/E[F]')).toBe('abcdef_');
    expect(getLangKey('')).toBe('');
    expect(getLangKey(null)).toBe('');
  });
});
