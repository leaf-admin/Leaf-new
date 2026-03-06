import '@testing-library/jest-native/extend-expect';

// Mock puro de AsyncStorage para evitar dependência nativa
jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// RN 0.76 não expõe mais NativeAnimatedHelper no mesmo caminho.
// Mantemos setup mínimo para evitar dependência de internals.

// Mock do NetInfo usado possivelmente em config
jest.mock('@react-native-community/netinfo', () => ({
    addEventListener: jest.fn(),
    fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));

const firebaseRefMock = () => ({
    child: jest.fn(() => firebaseRefMock()),
    set: jest.fn(() => Promise.resolve()),
    update: jest.fn(() => Promise.resolve()),
    once: jest.fn(() => Promise.resolve({ val: () => null })),
    on: jest.fn(),
    off: jest.fn(),
    orderByChild: jest.fn(() => firebaseRefMock()),
    equalTo: jest.fn(() => firebaseRefMock()),
    limitToLast: jest.fn(() => firebaseRefMock()),
});

jest.mock('@react-native-firebase/app', () => () => ({}));
jest.mock('@react-native-firebase/auth', () => () => ({
    currentUser: { uid: 'test_uid' },
    signInWithEmailAndPassword: jest.fn(() => Promise.resolve()),
    signOut: jest.fn(() => Promise.resolve()),
}));
jest.mock('@react-native-firebase/firestore', () => () => ({
    collection: jest.fn(() => ({ doc: jest.fn(() => ({ get: jest.fn(() => Promise.resolve({ exists: false })) })) })),
}));
jest.mock('@react-native-firebase/database', () => () => ({
    ref: jest.fn(() => firebaseRefMock()),
}));
jest.mock('@react-native-firebase/messaging', () => () => ({
    getToken: jest.fn(() => Promise.resolve('mock_token')),
}));
jest.mock('@react-native-firebase/storage', () => () => ({
    ref: jest.fn(() => ({
        putFile: jest.fn(() => Promise.resolve()),
        getDownloadURL: jest.fn(() => Promise.resolve('https://mock.storage/file.jpg')),
    })),
}));

jest.mock('expo-font', () => ({
    isLoaded: jest.fn(() => true),
    loadAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@expo/vector-icons', () => {
    const React = require('react');
    const MockIcon = (props) => React.createElement('Icon', props, props.children);
    return {
        Ionicons: MockIcon,
        MaterialCommunityIcons: MockIcon,
        MaterialIcons: MockIcon,
        FontAwesome: MockIcon,
        Feather: MockIcon,
        Entypo: MockIcon,
    };
});
