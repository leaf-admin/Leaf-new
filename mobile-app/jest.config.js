module.exports = {
    preset: "jest-expo",
    setupFilesAfterEnv: ["@testing-library/jest-native/extend-expect", "./jest.setup.js"],
    haste: {
        defaultPlatform: "android",
        platforms: ["android", "ios", "native"],
        throwOnModuleCollision: false,
    },
    modulePathIgnorePatterns: [
        "<rootDir>/common/common-packages/",
        "<rootDir>/test-build-final-success/",
        "<rootDir>/playwright-report/",
    ],
    testPathIgnorePatterns: [
        "<rootDir>/e2e/",
        "<rootDir>/__tests__/run_jest.js",
        "<rootDir>/__tests__/RideLifecycle.test.js",
    ],
    transformIgnorePatterns: [
        "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-redux|@react-native-firebase|@reduxjs/toolkit|immer)"
    ],
    collectCoverage: false,
    collectCoverageFrom: [
        "src/**/*.{js,jsx}",
        "!src/**/*.test.{js,jsx}",
        "!src/components/I18nTestSuite.js",
        "!**/node_modules/**",
        "!**/vendor/**"
    ],
};
