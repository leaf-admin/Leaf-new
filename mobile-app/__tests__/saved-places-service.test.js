let AsyncStorage;
const mockCurrentUser = jest.fn();
const mockRequest = jest.fn();
jest.mock('../src/services/AuthService', () => ({ getCurrentUser: mockCurrentUser, authenticatedRequest: mockRequest }));
const place = { id: '-22,-43', name: 'Casa', address: 'Rua A, 10', coordinate: { latitude: -22, longitude: -43 } };
const answer = (places, uid = 'u1') => ({ ok: true, status: 200, json: async () => ({ success: true, uid, places }) });

describe('saved places synchronization', () => {
  let service;
  beforeEach(async () => {
    jest.resetModules(); jest.clearAllMocks();
    const storage = require('@react-native-async-storage/async-storage');
    AsyncStorage = storage.default || storage;
    await AsyncStorage.clear();
    mockCurrentUser.mockResolvedValue({ uid: 'u1' });
    mockRequest.mockResolvedValue(answer([place]));
    service = require('../src/services/SavedPlacesService');
  });
  it('saves only after an authenticated backend acknowledgement', async () => {
    expect(await service.savePlace('u1', place, 'Casa')).toEqual([place]);
    expect(mockRequest).toHaveBeenCalledWith('/account/places', expect.objectContaining({ method: 'POST' }));
  });
  it('renames or relocates an address using its stable id', async () => {
    await service.savePlace('u1', place, 'Trabalho', { id: place.id });
    const [url, options] = mockRequest.mock.calls[0];
    expect(url).toBe('/account/places/-22%2C-43');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body).place.name).toBe('Trabalho');
  });
  it('keeps cached addresses when the backend is unavailable without claiming synchronization', async () => {
    await AsyncStorage.setItem('@leaf_saved_places_u1', JSON.stringify([place]));
    mockRequest.mockRejectedValue(new Error('offline'));
    expect(await service.getSavedPlacesSnapshot('u1')).toEqual(expect.objectContaining({ places: [place], synced: false }));
    await expect(service.removeSavedPlace('u1', place.id)).rejects.toThrow('offline');
    expect(await service.getLocalSavedPlaces('u1')).toEqual([place]);
  });
  it('does not call the backend for another authenticated user or cache another uid response', async () => {
    mockCurrentUser.mockResolvedValue({ uid: 'u2' });
    await expect(service.savePlace('u1', place, 'Casa')).rejects.toThrow('sessão mudou');
    expect(mockRequest).not.toHaveBeenCalled();
    mockCurrentUser.mockResolvedValue({ uid: 'u1' });
    mockRequest.mockResolvedValue(answer([place], 'u2'));
    await expect(service.savePlace('u1', place, 'Casa')).rejects.toThrow('sessão mudou');
    expect(await service.getLocalSavedPlaces('u1')).toEqual([]);
  });
  it('retires a legacy copy only after the remote copy is confirmed, so it cannot resurrect after deletion elsewhere', async () => {
    await AsyncStorage.setItem('@leaf_saved_places_u1', JSON.stringify([place]));
    expect((await service.getSavedPlacesSnapshot('u1')).localOnly).toEqual([]);
    mockRequest.mockResolvedValue(answer([]));
    expect((await service.getSavedPlacesSnapshot('u1')).places).toEqual([]);
  });
  it('preserves device-only entries on read, then migrates explicitly', async () => {
    await AsyncStorage.setItem('@leaf_saved_places_u1', JSON.stringify([place]));
    mockRequest.mockResolvedValueOnce(answer([]));
    expect((await service.getSavedPlacesSnapshot('u1')).localOnly).toEqual([place]);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    mockRequest.mockResolvedValueOnce(answer([])).mockResolvedValueOnce(answer([place]));
    expect(await service.syncLocalSavedPlaces('u1')).toEqual([place]);
    expect(await AsyncStorage.getItem('@leaf_saved_places_u1')).toBe('[]');
  });
  it('preserves unacknowledged entries if migration partially fails', async () => {
    const other = { ...place, id: '-23,-44', name: 'Trabalho', coordinate: { latitude: -23, longitude: -44 } };
    await AsyncStorage.setItem('@leaf_saved_places_u1', JSON.stringify([place, other]));
    mockRequest.mockResolvedValueOnce(answer([])).mockResolvedValueOnce(answer([place])).mockRejectedValueOnce(new Error('offline'));
    await expect(service.syncLocalSavedPlaces('u1')).rejects.toThrow('offline');
    expect(JSON.parse(await AsyncStorage.getItem('@leaf_saved_places_u1'))).toEqual([other]);
    expect(await service.getLocalSavedPlaces('u1')).toEqual([place, other]);
  });
  it.each([NaN, Infinity, 91, '12'])('rejects invalid latitude %s before sending', async latitude => {
    await expect(service.savePlace('u1', { ...place, coordinate: { latitude, longitude: 0 } }, 'Casa')).rejects.toThrow('localização confirmada');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
