import '@testing-library/jest-native/extend-expect';

// Mock puro de AsyncStorage para evitar dependência nativa
jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mocks simples para garantir que a renderização virtual não quebre por causa de Animações
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

// Mock do NetInfo usado possivelmente em config
jest.mock('@react-native-community/netinfo', () => ({
    addEventListener: jest.fn(),
    fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));
