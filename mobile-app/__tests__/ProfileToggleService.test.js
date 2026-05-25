// ProfileToggleService.test.js

// Mock puro de Firebase auth e API externa
jest.mock('@react-native-firebase/auth', () => () => ({
    currentUser: { uid: 'user_123' },
}));

jest.mock('../src/services/httpClient', () => ({
    apiClient: {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn()
    }
}));

const ProfileToggleServiceModule = require('../src/services/ProfileToggleService');
const ProfileToggleService = ProfileToggleServiceModule.default || ProfileToggleServiceModule;
const { apiClient } = require('../src/services/httpClient');

describe('ProfileToggleService Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('deve permitir alternar para motorista se o usuário tiver as permissões necessárias e estiver aprovado', async () => {
        // Simula a resposta do backend dizendo que ele tem permissão
        apiClient.get.mockResolvedValueOnce({
            data: {
                success: true,
                permissions: { canBeDriver: true, driverVerified: true }
            }
        });

        const result = await ProfileToggleService.canSwitchToMode('user_123', 'driver');
        expect(result).toBe(true);
        expect(apiClient.get).toHaveBeenCalledWith('/user/permissions/user_123');
    });

    it('não deve permitir alternar para motorista se driverVerified for falso', async () => {
        // Simula um usuário que falta CNH
        apiClient.get.mockResolvedValueOnce({
            data: {
                success: true,
                permissions: { canBeDriver: true, driverVerified: false }
            }
        });

        const result = await ProfileToggleService.canSwitchToMode('user_123', 'driver');
        expect(result).toBe(false);
    });
});
