const { normalizePlace, mutatePlaces, validatePlaceId } = require('../../../services/account-saved-places');
const place = { name: 'Casa', address: 'Rua A, 10', coordinate: { latitude: -22, longitude: -43 } };
describe('saved place validation and mutation', () => {
  it('whitelists persisted fields and derives an id', () => {
    expect(normalizePlace({ ...place, uid: 'someone', balance: 100 })).toEqual({ ...place, id: '-22,-43', sourceType: 'saved_place' });
  });
  it.each([null, [], { ...place, name: ' ' }, { ...place, address: 'x'.repeat(301) }, { ...place, coordinate: { latitude: '22', longitude: 43 } }, { ...place, coordinate: { latitude: 91, longitude: 0 } }, { ...place, coordinate: { latitude: 0, longitude: Infinity } }])('rejects invalid input %j', input => {
    expect(() => normalizePlace(input)).toThrow();
    try { normalizePlace(input); } catch (error) { expect(error.status).toBe(400); }
  });
  it.each(['../../u2', '', 'a/b', 'x'.repeat(161)])('rejects invalid ids %s', id => expect(() => validatePlaceId(id)).toThrow());
  it('upserts duplicates and preserves the id on relocation', () => {
    const savedPlaces = mutatePlaces({}, 'add', place);
    expect(mutatePlaces({ savedPlaces }, 'add', { ...place, name: 'Meu lugar' })).toHaveLength(1);
    const relocated = mutatePlaces({ savedPlaces }, 'update', { ...place, coordinate: { latitude: -21, longitude: -42 } }, savedPlaces[0].id);
    expect(relocated[0].id).toBe('-22,-43');
    expect(relocated[0].coordinate.latitude).toBe(-21);
  });
  it('does not create a missing entry when editing, and deletion is idempotent', () => {
    expect(() => mutatePlaces({}, 'update', place, 'missing')).toThrow('não encontrado');
    expect(mutatePlaces({}, 'delete', null, 'missing')).toEqual([]);
  });
  it('limits thirty places while allowing update or deletion at capacity', () => {
    const savedPlaces = Array.from({ length: 30 }, (_, i) => normalizePlace({ ...place, coordinate: { latitude: i, longitude: 0 } }));
    expect(() => mutatePlaces({ savedPlaces }, 'add', place)).toThrow('30 endereços');
    expect(mutatePlaces({ savedPlaces }, 'update', place, savedPlaces[0].id)).toHaveLength(30);
    expect(mutatePlaces({ savedPlaces }, 'delete', null, savedPlaces[0].id)).toHaveLength(29);
  });
});
