import { restoreQaSeedProfile } from '../src/utils/qaSeedProfile';

describe('qaSeedProfile', () => {
  it('restores generic seeded test users from stored user data', async () => {
    const AsyncStorage = {
      multiGet: jest.fn().mockResolvedValue([
        ['@auth_uid', 'qa-driver-bypass-test-2'],
        [
          '@user_data',
          JSON.stringify({
            uid: 'qa-driver-bypass-test-2',
            id: 'qa-driver-bypass-test-2',
            name: 'Leaf Motorista QA 2',
            usertype: 'driver',
            userType: 'driver',
            role: 'driver',
            canGoOnline: true,
            vehicleId: 'vehicle-qa-2',
            userVehicleId: 'uv-vehicle-qa-2',
            carPlate: 'TES8899',
            profile: {
              uid: 'qa-driver-bypass-test-2',
              id: 'qa-driver-bypass-test-2',
              name: 'Leaf Motorista QA 2',
              usertype: 'driver',
              userType: 'driver',
              role: 'driver',
              canGoOnline: true,
              carPlate: 'TES8899',
            },
          }),
        ],
        ['@test_mode', 'true'],
        [
          '@prototype_driver_activation_qa-driver-bypass-test-2',
          JSON.stringify({ canGoOnline: true, currentStage: 'vehicle_activation' }),
        ],
      ]),
      multiSet: jest.fn().mockResolvedValue(undefined),
    };

    const restored = await restoreQaSeedProfile({
      AsyncStorage,
      authUidKey: '@auth_uid',
      userDataKey: '@user_data',
      driverActivationKey: '@prototype_driver_activation_qa-driver-bypass-test-2',
    });

    expect(restored).toEqual(
      expect.objectContaining({
        uid: 'qa-driver-bypass-test-2',
        id: 'qa-driver-bypass-test-2',
        name: 'Leaf Motorista QA 2',
        canGoOnline: true,
        driverActivation: expect.objectContaining({
          canGoOnline: true,
          currentStage: 'vehicle_activation',
        }),
      }),
    );
    expect(restored.profile).toEqual(
      expect.objectContaining({
        uid: 'qa-driver-bypass-test-2',
        id: 'qa-driver-bypass-test-2',
        carPlate: 'TES8899',
        driverActivation: expect.objectContaining({
          canGoOnline: true,
          currentStage: 'vehicle_activation',
        }),
      }),
    );
    expect(AsyncStorage.multiSet).toHaveBeenCalledWith([
      ['@auth_uid', 'qa-driver-bypass-test-2'],
      ['@user_data', JSON.stringify(restored)],
    ]);
  });
});
