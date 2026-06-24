import AsyncStorage from '@react-native-async-storage/async-storage';
import RatingService from '../src/services/RatingService';
import WebSocketManager from '../src/services/WebSocketManager';
import { store } from '../src/state/appStore';
import { isSimulatorBuild, canUseProfileBypass } from '../src/config/runtimeAccessPolicy';

const mockWebSocketInstance = {
  isConnected: jest.fn(() => false),
  connect: jest.fn(async () => undefined),
  submitRating: jest.fn(async () => ({ success: true })),
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => mockWebSocketInstance),
}));

jest.mock('../src/state/appStore', () => ({
  store: {
    getState: jest.fn(() => ({ auth: { profile: { uid: 'prototype-user', isTestUser: true } } })),
    dispatch: jest.fn(),
  },
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  isSimulatorBuild: jest.fn(() => false),
  canUseProfileBypass: jest.fn(() => false),
}));

describe('RatingService prototype bypass', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketInstance.isConnected.mockReturnValue(false);
    isSimulatorBuild.mockReturnValue(false);
    canUseProfileBypass.mockReturnValue(false);
    RatingService.webSocketManager = mockWebSocketInstance;
  });

  it('confirma localmente a avaliacao no simulador sem depender do websocket', async () => {
    isSimulatorBuild.mockReturnValue(true);

    const result = await RatingService.submitRating({
      tripId: 'trip-passenger-proof-1',
      userId: 'prototype-user',
      reviewerId: 'prototype-user',
      reviewerType: 'passenger',
      driverId: 'driver-test',
      targetUserId: 'driver-test',
      rating: 5,
      comment: 'Tudo certo',
    });

    expect(result).toEqual({ success: true, localOnly: true });
    expect(AsyncStorage.setItem).toHaveBeenCalled();
    expect(store.dispatch).toHaveBeenCalled();
    expect(mockWebSocketInstance.submitRating).not.toHaveBeenCalled();
  });

  it('tambem usa bypass local para perfil elegivel em corrida prototype', async () => {
    canUseProfileBypass.mockReturnValue(true);

    const result = await RatingService.submitRating({
      tripId: 'trip-driver-proof-1',
      userId: 'prototype-user',
      reviewerId: 'prototype-user',
      reviewerType: 'driver',
      passengerId: 'passenger-test',
      targetUserId: 'passenger-test',
      rating: 5,
      comment: 'Passageiro ok',
    });

    expect(result).toEqual({ success: true, localOnly: true });
    expect(AsyncStorage.setItem).toHaveBeenCalled();
    expect(store.dispatch).toHaveBeenCalled();
  });

  it('marca uma avaliacao confirmada pelo backend como enviada, sem recoloca-la na fila', async () => {
    mockWebSocketInstance.isConnected.mockReturnValue(true);
    mockWebSocketInstance.submitRating.mockResolvedValue({ success: true, ratingId: 'rating_1' });

    await RatingService.submitRating({
      tripId: 'ride_1',
      userId: 'passenger_1',
      reviewerType: 'passenger',
      rating: 5,
    });

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'localRatings',
      expect.stringContaining('"status":"sent"'),
    );
  });

  it('nao enfileira uma avaliacao recusada por regra de negocio', async () => {
    mockWebSocketInstance.isConnected.mockReturnValue(true);
    const error = new Error('A avaliação só pode ser enviada após a corrida ser concluída');
    error.code = 'RATING_TRIP_NOT_COMPLETED';
    mockWebSocketInstance.submitRating.mockRejectedValue(error);

    await expect(RatingService.submitRating({
      tripId: 'ride_1',
      userId: 'passenger_1',
      reviewerType: 'passenger',
      rating: 5,
    })).rejects.toThrow('A avaliação só pode ser enviada após a corrida ser concluída');

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('enfileira retry somente para falha transitória de conexão', async () => {
    mockWebSocketInstance.isConnected.mockReturnValue(true);
    const error = new Error('WebSocket não conectado');
    error.code = 'WS_DISCONNECTED';
    mockWebSocketInstance.submitRating.mockRejectedValue(error);

    await expect(RatingService.submitRating({
      tripId: 'ride_1',
      userId: 'passenger_1',
      reviewerType: 'passenger',
      rating: 5,
    })).rejects.toThrow('WebSocket não conectado');

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'localRatings',
      expect.stringContaining('"status":"pending"'),
    );
  });
});
