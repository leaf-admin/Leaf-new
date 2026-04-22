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
});
