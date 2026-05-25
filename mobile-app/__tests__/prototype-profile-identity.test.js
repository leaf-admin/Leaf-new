import {
  isPrototypeMockProfileName,
  resolvePrototypeProfileEmail,
  resolvePrototypeProfileName,
  resolvePrototypeProfilePhone,
} from '../src/screens/prototype/prototypeProfileIdentity';

describe('prototypeProfileIdentity', () => {
  it('ignores the legacy Ana Dias prototype placeholder', () => {
    expect(isPrototypeMockProfileName('Ana Dias')).toBe(true);
    expect(resolvePrototypeProfileName({ name: 'Ana Dias' })).toBe('');
  });

  it('resolves the real customer identity from persisted profile fields', () => {
    const profile = {
      firstName: 'Izaak',
      lastName: 'Ribeiro Dias',
      email: 'izaak.dias@hotmail.com',
      phoneNumber: '+5521998991886',
    };

    expect(resolvePrototypeProfileName(profile)).toBe('Izaak Ribeiro Dias');
    expect(resolvePrototypeProfileEmail(profile)).toBe('izaak.dias@hotmail.com');
    expect(resolvePrototypeProfilePhone(profile)).toBe('+5521998991886');
  });

  it('prefers explicit nested profile data when available', () => {
    const profile = {
      profile: {
        name: 'Izaak Ribeiro Dias',
        email: 'izaak.dias@hotmail.com',
        mobile: '+5521998991886',
      },
    };

    expect(resolvePrototypeProfileName(profile)).toBe('Izaak Ribeiro Dias');
    expect(resolvePrototypeProfileEmail(profile)).toBe('izaak.dias@hotmail.com');
    expect(resolvePrototypeProfilePhone(profile)).toBe('+5521998991886');
  });
});
