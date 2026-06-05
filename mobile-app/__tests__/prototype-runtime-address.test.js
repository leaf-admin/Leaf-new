import { isGenericRuntimeAddress } from '../src/screens/prototype/prototypeRuntimeAddress';

describe('prototype runtime address helpers', () => {
  it('treats pickup fallback labels as missing runtime addresses', () => {
    expect(isGenericRuntimeAddress('Local atual')).toBe(true);
    expect(isGenericRuntimeAddress('Minha localização')).toBe(true);
    expect(isGenericRuntimeAddress('Sua localização atual')).toBe(true);
    expect(isGenericRuntimeAddress('Origem atual')).toBe(true);
  });

  it('keeps real street labels as meaningful addresses', () => {
    expect(isGenericRuntimeAddress('Rua das Pastorinhas, 173')).toBe(false);
    expect(isGenericRuntimeAddress('Avenida Atlântica, 1702, Rio de Janeiro')).toBe(false);
  });
});
