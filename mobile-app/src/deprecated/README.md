# Deprecated Inventory - 2026-03-26

This directory contains structures removed from the active mobile runtime because they are not linked to the current app flow.

## Deprecated Components

- `components/ModernAddressCard.js`
- `components/ModernBookButton.js`
- `components/ModernButton.js`
- `components/ModernCarCard.js`
- `components/ModernLoginScreen.js`
- `components/ModernMapScreenExample.js`
- `components/ModernProfileScreen.js`
- `components/ModernWalletScreen.js`
- `components/UXImprovementsExample.js`
- `components/WebSocketDemo.js`
- `components/I18nTestSuite.js`
- `components/LanguageDemo.js`
- `components/TestUserButton.js`
- `components/TestUserManager.js`

## Deprecated Examples

- `examples/WebSocketIntegrationExamples.js`
- `examples/WebSocketListenersExamples.js`

## Deprecated Internal Docs

- `docs/README_MODERN_COMPONENTS.md`
- `docs/README_ALL_MODERN_COMPONENTS.md`

## Deprecated Screens

- `screens/SelectGatewayScreen.js`

## Deliberately Kept Outside Deprecated

These files are legacy or compatibility paths, but still have a live link to the current project and therefore were not moved:

- `src/navigation/AppNavigator.js`
- `src/screens/NewMapScreen.js`
- `src/components/map/PassengerUI.js`
- `src/components/map/DriverUI.js`
- `src/screens/DriverDashboardScreen.js`
- `src/screens/DriverDocumentsScreen.js`
- `src/screens/EarningsReportScreen.js`
- `src/screens/TripTrackingScreen.js`

## Rule Applied

Only files with no live import or route linkage to the current runtime were moved here.
