# QA Flow Inventory

Generated at: 2026-10-04T06:48:25.120Z

Total navigation routes: 69
Surface status: current 43; compatibility_redirect 26
Total maestro flows (non-debug): 103
Release-only eligible flows: 79

## Release Preconditions

1. Executar somente build release instalado (`br.com.leaf.ride`), sem Expo Go/dev-client como alvo.
2. Backend deve responder `/health/runtime-flags` com `realSandbox.ready=true`.
3. Não usar payment mock, PaymentBypassService, E2E_TEST=true ou qualquer bypass de pagamento.
4. Motorista deve estar online e elegível antes de qualquer flow de solicitação do passageiro.
5. Evidências por rodada devem incluir JUnit XML, logs Maestro, screenshots e snapshot de runtime flags.

## Release Coverage Matrix

This is a static inventory of flow definitions, not an execution report. `DEFINED` means an eligible flow file names every required platform and role; `GAP` means one or more definitions are missing. Check execution logs and screenshots before treating a flow as PASS.

| Area | Status | Release-only flows | Gaps |
|---|---|---:|---|
| Cadastro passageiro | DEFINED | 2 | - |
| Cadastro motorista | DEFINED | 2 | - |
| Login passageiro/motorista | DEFINED | 9 | - |
| Motorista online antes da solicitação | DEFINED | 12 | - |
| Passageiro solicita corrida | DEFINED | 30 | - |
| Motorista aceita corrida | DEFINED | 4 | - |
| Navegação passageiro/motorista | DEFINED | 18 | - |
| Chat em corrida ativa | DEFINED | 3 | - |
| Suporte/ticket | DEFINED | 5 | - |
| Avaliação pós-corrida | DEFINED | 7 | - |

## Product Routes (One By One)

1. `AuthFlowScreenshotHarness` (current; auth-onboarding)
2. `AuthLoading` (current; auth-onboarding)
3. `AuthLoadingScreen` (current; auth-onboarding)
4. `AuthScreen` (compatibility_redirect; auth-onboarding)
5. `BaaSAccount` (compatibility_redirect; auth-onboarding)
6. `BaaSAccountScreen` (compatibility_redirect; auth-onboarding)
7. `CNHUpload` (compatibility_redirect; auth-onboarding)
8. `CNHUploadScreen` (compatibility_redirect; auth-onboarding)
9. `CompleteRegistration` (compatibility_redirect; auth-onboarding)
10. `CRLVUpload` (compatibility_redirect; auth-onboarding)
11. `CRLVUploadScreen` (compatibility_redirect; auth-onboarding)
12. `DriverInvite` (current; driver-ops)
13. `DriverTerms` (compatibility_redirect; auth-onboarding)
14. `EarningsReport` (current; driver-ops)
15. `FreeTrial` (compatibility_redirect; auth-onboarding)
16. `LeafAccountInfo` (current; other)
17. `LeafSavedPlacePicker` (current; other)
18. `LeafSavedPlaces` (current; other)
19. `Legal` (current; account-support)
20. `Login` (compatibility_redirect; auth-onboarding)
21. `LoginScreen` (compatibility_redirect; auth-onboarding)
22. `Map` (compatibility_redirect; ride-lifecycle)
23. `MapScreen` (compatibility_redirect; ride-lifecycle)
24. `OTP` (compatibility_redirect; auth-onboarding)
25. `PhoneInputScreen` (compatibility_redirect; other)
26. `PhoneScreen` (compatibility_redirect; other)
27. `PlanSelection` (compatibility_redirect; auth-onboarding)
28. `PrivacyPolicy` (current; account-support)
29. `ProfileSelection` (compatibility_redirect; auth-onboarding)
30. `ProfileSelectionScreen` (compatibility_redirect; auth-onboarding)
31. `Referral` (compatibility_redirect; auth-onboarding)
32. `ReferralScreen` (compatibility_redirect; auth-onboarding)
33. `Registration` (compatibility_redirect; auth-onboarding)
34. `RobotaxiMenuEditProfile` (current; account-support)
35. `RobotaxiMenuHelp` (current; account-support)
36. `RobotaxiMenuMessages` (current; account-support)
37. `RobotaxiMenuSettings` (current; account-support)
38. `RobotaxiMenuTripHistory` (current; ride-lifecycle)
39. `RobotaxiPrototype` (current; prototype)
40. `RobotaxiPrototypeCancellation` (current; ride-lifecycle)
41. `RobotaxiPrototypeChat` (current; account-support)
42. `RobotaxiPrototypeComplain` (current; ride-lifecycle)
43. `RobotaxiPrototypeDestination` (current; prototype)
44. `RobotaxiPrototypeDriverActivation` (current; driver-ops)
45. `RobotaxiPrototypeDriverDocuments` (current; driver-ops)
46. `RobotaxiPrototypeDriverPanel` (current; driver-ops)
47. `RobotaxiPrototypeDriverSearch` (current; driver-ops)
48. `RobotaxiPrototypeDriverWaitlist` (current; driver-ops)
49. `RobotaxiPrototypeDriverWaitlistStatus` (current; driver-ops)
50. `RobotaxiPrototypeInvites` (current; prototype)
51. `RobotaxiPrototypeMenu` (current; prototype)
52. `RobotaxiPrototypeNoDrivers` (current; driver-ops)
53. `RobotaxiPrototypePaymentFailed` (current; ride-lifecycle)
54. `RobotaxiPrototypePaymentSuccess` (current; ride-lifecycle)
55. `RobotaxiPrototypeProfile` (current; account-support)
56. `RobotaxiPrototypePublicTracking` (current; prototype)
57. `RobotaxiPrototypeRating` (current; prototype)
58. `RobotaxiPrototypeReceipt` (current; ride-lifecycle)
59. `RobotaxiPrototypeSettings` (current; account-support)
60. `RobotaxiPrototypeShareTrip` (current; ride-lifecycle)
61. `RobotaxiPrototypeSupport` (current; account-support)
62. `RobotaxiPrototypeSupportThread` (current; account-support)
63. `RobotaxiPrototypeSupportTicket` (current; account-support)
64. `RobotaxiPrototypeTrip` (current; ride-lifecycle)
65. `RobotaxiPrototypeVehicles` (current; driver-ops)
66. `Splash` (current; other)
67. `TabRoot` (compatibility_redirect; other)
68. `WelcomeScreen` (compatibility_redirect; auth-onboarding)
69. `WooviDriverBalance` (compatibility_redirect; driver-ops)

## Maestro Flows (One By One)

1. `.maestro/flows/account-deletion-direct-smoke.yaml` (other; android/ios; unknown; navigation; release-only)
2. `.maestro/flows/auth.yaml` (other; android/ios; driver/passenger; driver-online, login; blocked: payment-bypass-marker)
3. `.maestro/flows/auth/01-login-customer-real.yaml` (auth-onboarding; android/ios; passenger; login, navigation, rating, request-ride, support; blocked: dev-server-marker, fixed-otp-marker)
4. `.maestro/flows/auth/01-login-customer.yaml` (auth-onboarding; android/ios; passenger; login, request-ride; release-only)
5. `.maestro/flows/auth/02-login-driver.yaml` (auth-onboarding; android/ios; driver; driver-online, login, navigation; blocked: fixed-otp-marker)
6. `.maestro/flows/auth/03-phone-otp-login-new-ios.yaml` (auth-onboarding; ios; passenger; login, navigation, request-ride; blocked: dev-server-marker, fixed-otp-marker)
7. `.maestro/flows/auth/03-phone-otp-login-new.yaml` (auth-onboarding; android/ios; unknown; login, navigation; blocked: dev-server-marker, fixed-otp-marker)
8. `.maestro/flows/auth/04-phone-driver-home-online-ios.yaml` (auth-onboarding; ios; driver; driver-online, login, navigation; blocked: dev-server-marker, fixed-otp-marker)
9. `.maestro/flows/current-menus/01-passenger-dedicated-device.yaml` (other; android/ios; passenger; navigation, request-ride, support; release-only)
10. `.maestro/flows/current-menus/02-driver-dedicated-device.yaml` (other; android/ios; driver; complete-ride, driver-online, navigation, support; release-only)
11. `.maestro/flows/current/01-robotaxi-current-home.yaml` (other; android/ios; driver/passenger; driver-online, request-ride; release-only)
12. `.maestro/flows/driver/01-driver-go-online.yaml` (driver-ops; android/ios; driver; driver-online; release-only)
13. `.maestro/flows/payments/01-payment-flow.yaml` (wallet-finance; android/ios; unknown; payment; release-only)
14. `.maestro/flows/qa/01-passenger-prototype-qa.yaml` (qa-auxiliary; android/ios; passenger; driver-online, login, navigation, payment, request-ride; blocked: dev-server-marker, fixed-otp-marker)
15. `.maestro/flows/qa/02-driver-prototype-qa.yaml` (qa-auxiliary; android/ios; driver; driver-online, login, navigation; blocked: dev-server-marker, fixed-otp-marker)
16. `.maestro/flows/qa/03-passenger-final-view.yaml` (qa-auxiliary; android/ios; passenger; navigation; release-only)
17. `.maestro/flows/qa/04-driver-final-view.yaml` (qa-auxiliary; android/ios; driver; navigation; release-only)
18. `.maestro/flows/qa/05-cleanup-driver-prompt.yaml` (qa-auxiliary; android/ios; driver; navigation; blocked: dev-server-marker)
19. `.maestro/flows/qa/06-passenger-prototype-refine.yaml` (qa-auxiliary; android/ios; passenger; login, navigation; blocked: dev-server-marker, fixed-otp-marker)
20. `.maestro/flows/qa/07-driver-prototype-refine.yaml` (qa-auxiliary; android/ios; driver; login, navigation; blocked: dev-server-marker, fixed-otp-marker)
21. `.maestro/flows/qa/08-passenger-voice-smoke.yaml` (qa-auxiliary; android/ios; passenger; login, navigation; blocked: dev-server-marker, fixed-otp-marker)
22. `.maestro/flows/qa/09-passenger-voice-tap.yaml` (qa-auxiliary; android/ios; passenger; smoke; release-only)
23. `.maestro/flows/qa/10-passenger-voice-after-login.yaml` (qa-auxiliary; android/ios; passenger; login; release-only)
24. `.maestro/flows/qa/11-passenger-menu-support-settings-audit.yaml` (qa-auxiliary; android/ios; passenger; chat, navigation, support; release-only)
25. `.maestro/flows/qa/12-passenger-rating-screen-audit.yaml` (qa-auxiliary; android/ios; passenger; navigation, rating; release-only)
26. `.maestro/flows/qa/90-play-video-passenger-voice-android.yaml` (qa-auxiliary; android; passenger; smoke; blocked: fixed-otp-marker)
27. `.maestro/flows/qa/91-play-video-driver-location-android.yaml` (qa-auxiliary; android; driver; driver-online; blocked: fixed-otp-marker)
28. `.maestro/flows/qa/boot-app-ready-ios.yaml` (qa-auxiliary; ios; unknown; navigation; blocked: dev-server-marker)
29. `.maestro/flows/qa/e2e/01-driver-login-online-8082.yaml` (e2e-core; android/ios; driver; driver-online, login, navigation; blocked: dev-server-marker)
30. `.maestro/flows/qa/e2e/02-passenger-login-8081.yaml` (e2e-core; android/ios; passenger; login, navigation; blocked: dev-server-marker)
31. `.maestro/flows/qa/e2e/03-passenger-request-ride.yaml` (e2e-core; android/ios; driver/passenger; navigation, payment, request-ride; release-only)
32. `.maestro/flows/qa/e2e/04-driver-offer-trip-complete.yaml` (e2e-core; android/ios; driver/passenger; complete-ride, driver-online, navigation, trip-progress; release-only)
33. `.maestro/flows/qa/e2e/05-passenger-post-trip-verify.yaml` (e2e-core; android/ios; driver/passenger; complete-ride, navigation, request-ride; release-only)
34. `.maestro/flows/qa/e2e/06-passenger-navigation-audit.yaml` (e2e-core; android/ios; passenger; chat, complete-ride, navigation; release-only)
35. `.maestro/flows/qa/e2e/07-driver-navigation-audit.yaml` (e2e-core; android/ios; driver; driver-online, navigation; release-only)
36. `.maestro/flows/qa/e2e/20-passenger-signup-real-android.yaml` (e2e-core; android; passenger; login, rating, request-ride, signup, support; release-only)
37. `.maestro/flows/qa/e2e/20-passenger-signup-real-ios.yaml` (e2e-core; ios; passenger; login, rating, request-ride, signup, support; release-only)
38. `.maestro/flows/qa/e2e/20-passenger-signup-screenshots-android.yaml` (e2e-core; android; passenger; login, navigation, rating, request-ride, signup, support; blocked: dev-server-marker, fixed-otp-marker)
39. `.maestro/flows/qa/e2e/21-driver-signup-docs-real-android.yaml` (e2e-core; android; driver; driver-online, login, signup; release-only)
40. `.maestro/flows/qa/e2e/21-driver-signup-real-ios.yaml` (e2e-core; ios; driver; driver-online, login, signup; release-only)
41. `.maestro/flows/qa/e2e/21-driver-signup-screenshots-android.yaml` (e2e-core; android; driver; driver-online, login, navigation, signup; blocked: dev-server-marker, fixed-otp-marker)
42. `.maestro/flows/qa/e2e/ideal/11-driver-login-online-ideal.yaml` (ride-lifecycle; android/ios; driver; driver-online, login, navigation; blocked: dev-server-marker, fixed-otp-marker)
43. `.maestro/flows/qa/e2e/ideal/12-passenger-login-ideal.yaml` (ride-lifecycle; android/ios; passenger; login, navigation, request-ride; blocked: dev-server-marker, fixed-otp-marker)
44. `.maestro/flows/qa/e2e/ideal/13-passenger-request-ideal.yaml` (ride-lifecycle; android/ios; driver/passenger; navigation, payment, request-ride; release-only)
45. `.maestro/flows/qa/e2e/ideal/14-driver-complete-ideal.yaml` (ride-lifecycle; android/ios; driver; accept-ride, complete-ride, navigation, trip-progress; release-only)
46. `.maestro/flows/qa/e2e/ideal/15-passenger-receipt-rating-ideal.yaml` (ride-lifecycle; android/ios; passenger; complete-ride, navigation, rating; release-only)
47. `.maestro/flows/qa/e2e/lifecycle/00-driver-offline-home.yaml` (ride-lifecycle; android/ios; driver; driver-online; release-only)
48. `.maestro/flows/qa/e2e/lifecycle/01-driver-online-home.yaml` (ride-lifecycle; android/ios; driver; driver-online; release-only)
49. `.maestro/flows/qa/e2e/lifecycle/01-driver-toggle-online.yaml` (ride-lifecycle; android/ios; driver; driver-online; release-only)
50. `.maestro/flows/qa/e2e/lifecycle/02-passenger-request-copacabana-release-direct.yaml` (ride-lifecycle; android/ios; driver/passenger; payment, request-ride; release-only)
51. `.maestro/flows/qa/e2e/lifecycle/02-passenger-request-copacabana.yaml` (ride-lifecycle; android/ios; driver/passenger; payment, request-ride; release-only)
52. `.maestro/flows/qa/e2e/lifecycle/02-passenger-request-current-home.yaml` (ride-lifecycle; android/ios; driver/passenger; payment, request-ride; release-only)
53. `.maestro/flows/qa/e2e/lifecycle/02-passenger-request-home.yaml` (ride-lifecycle; android/ios; driver/passenger; payment, request-ride; release-only)
54. `.maestro/flows/qa/e2e/lifecycle/02-passenger-request-recent-destination.yaml` (ride-lifecycle; android/ios; driver/passenger; payment, request-ride; release-only)
55. `.maestro/flows/qa/e2e/lifecycle/03-driver-accept-offer.yaml` (ride-lifecycle; android/ios; driver; accept-ride; release-only)
56. `.maestro/flows/qa/e2e/lifecycle/03-driver-wait-offer.yaml` (ride-lifecycle; android/ios; driver; accept-ride; release-only)
57. `.maestro/flows/qa/e2e/lifecycle/04-driver-accept-offer.yaml` (ride-lifecycle; android/ios; driver; accept-ride, trip-progress; release-only)
58. `.maestro/flows/qa/e2e/lifecycle/04-driver-arrived.yaml` (ride-lifecycle; android/ios; driver; trip-progress; release-only)
59. `.maestro/flows/qa/e2e/lifecycle/05-driver-arrive-pickup.yaml` (ride-lifecycle; android/ios; driver; trip-progress; release-only)
60. `.maestro/flows/qa/e2e/lifecycle/05-driver-start-trip.yaml` (ride-lifecycle; android/ios; driver; trip-progress; release-only)
61. `.maestro/flows/qa/e2e/lifecycle/06-driver-complete-trip.yaml` (ride-lifecycle; android/ios; driver; complete-ride; release-only)
62. `.maestro/flows/qa/e2e/lifecycle/06-driver-start-trip.yaml` (ride-lifecycle; android/ios; driver; trip-progress; release-only)
63. `.maestro/flows/qa/e2e/lifecycle/07-driver-complete-trip.yaml` (ride-lifecycle; android/ios; driver; complete-ride; release-only)
64. `.maestro/flows/qa/e2e/lifecycle/07-passenger-rate-trip.yaml` (ride-lifecycle; android/ios; passenger; complete-ride, rating; release-only)
65. `.maestro/flows/qa/e2e/lifecycle/08-driver-rate-passenger.yaml` (ride-lifecycle; android/ios; driver/passenger; complete-ride, payment, rating; release-only)
66. `.maestro/flows/qa/e2e/lifecycle/09-driver-receipt-back-to-map.yaml` (ride-lifecycle; android/ios; driver/passenger; complete-ride, driver-online, payment, rating; release-only)
67. `.maestro/flows/qa/e2e/lifecycle/10-passenger-receipt-back-to-map.yaml` (ride-lifecycle; android/ios; passenger; complete-ride, request-ride; release-only)
68. `.maestro/flows/qa/e2e/lifecycle/11-driver-open-earnings.yaml` (ride-lifecycle; android/ios; driver; navigation; release-only)
69. `.maestro/flows/qa/e2e/wave4/00-passenger-quote-ready.yaml` (ride-lifecycle; android/ios; passenger; request-ride; release-only)
70. `.maestro/flows/qa/e2e/wave4/01-passenger-request-from-quote.yaml` (ride-lifecycle; android/ios; driver/passenger; request-ride; release-only)
71. `.maestro/flows/qa/e2e/wave4/02-passenger-cancel-search.yaml` (ride-lifecycle; android/ios; driver/passenger; smoke; release-only)
72. `.maestro/flows/qa/e2e/wave4/03-driver-interrupt-operational.yaml` (ride-lifecycle; android/ios; driver; smoke; release-only)
73. `.maestro/flows/qa/e2e/wave4/04-passenger-operational-continue.yaml` (ride-lifecycle; android/ios; driver/passenger; smoke; release-only)
74. `.maestro/flows/qa/e2e/wave4/05-passenger-end-early.yaml` (ride-lifecycle; android/ios; passenger; complete-ride; release-only)
75. `.maestro/flows/qa/e2e/wave4/06-passenger-request-extension.yaml` (ride-lifecycle; android/ios; driver/passenger; request-ride; release-only)
76. `.maestro/flows/qa/e2e/wave4/07-driver-accept-extension.yaml` (ride-lifecycle; android/ios; driver; smoke; release-only)
77. `.maestro/flows/qa/qa-session-bootstrap-ios.yaml` (qa-auxiliary; ios; driver/passenger; login, navigation; blocked: dev-server-marker)
78. `.maestro/flows/qa/qa-session-reset-ios.yaml` (qa-auxiliary; ios; unknown; smoke; release-only)
79. `.maestro/flows/qa/transitions/passenger-accepted-cancel-dismiss-ios.yaml` (qa-auxiliary; ios; passenger; payment; release-only)
80. `.maestro/flows/qa/transitions/passenger-cancelled-return-to-home-ios.yaml` (qa-auxiliary; ios; passenger; request-ride; release-only)
81. `.maestro/flows/qa/transitions/passenger-no-drivers-retry-to-home-ios.yaml` (qa-auxiliary; ios; driver/passenger; request-ride; release-only)
82. `.maestro/flows/qa/transitions/passenger-payment-failed-retry-to-home-ios.yaml` (qa-auxiliary; ios; passenger; payment, request-ride; release-only)
83. `.maestro/flows/qa/ui-ux-lifecycle-state-assert-ios.yaml` (qa-auxiliary; ios; unknown; smoke; release-only)
84. `.maestro/flows/qa/ui-ux-passenger-category-current-ios.yaml` (qa-auxiliary; ios; passenger; request-ride; release-only)
85. `.maestro/flows/qa/ui-ux-passenger-confirm-availability-release-ios.yaml` (qa-auxiliary; ios; passenger; request-ride; release-only)
86. `.maestro/flows/qa/ui-ux-passenger-destination-quote-ios.yaml` (qa-auxiliary; ios; passenger; payment, request-ride; release-only)
87. `.maestro/flows/qa/ui-ux-passenger-destination-quote-release-compact-ios.yaml` (qa-auxiliary; ios; passenger; request-ride; release-only)
88. `.maestro/flows/qa/ui-ux-passenger-destination-quote-release-ios.yaml` (qa-auxiliary; ios; passenger; request-ride; release-only)
89. `.maestro/flows/qa/ui-ux-passenger-pix-release-compact-ios.yaml` (qa-auxiliary; ios; passenger; payment, request-ride; release-only)
90. `.maestro/flows/qa/ui-ux-passenger-pix-release-ios.yaml` (qa-auxiliary; ios; passenger; payment, request-ride; release-only)
91. `.maestro/flows/qa/ui-ux-passenger-quote-pix-ios.yaml` (qa-auxiliary; ios; passenger; payment; release-only)
92. `.maestro/flows/qa/ui-ux-privacy-route-ios.yaml` (qa-auxiliary; ios; passenger; navigation; release-only)
93. `.maestro/flows/qa/ux-lab-connect-debug-ios.yaml` (qa-auxiliary; ios; unknown; smoke; release-only)
94. `.maestro/flows/qa/ux-lab-driver-home-baseline-ios.yaml` (qa-auxiliary; ios; driver; driver-online; release-only)
95. `.maestro/flows/qa/ux-lab-driver-location-consent-ios.yaml` (qa-auxiliary; ios; driver; smoke; release-only)
96. `.maestro/flows/qa/ux-lab-driver-permission-upgrade-ios.yaml` (qa-auxiliary; ios; driver; smoke; release-only)
97. `.maestro/flows/ride_request.yaml` (other; android/ios; driver/passenger; payment, request-ride; blocked: payment-bypass-marker)
98. `.maestro/flows/rides/01-request-ride-real.yaml` (ride-lifecycle; android/ios; driver/passenger; login, payment, request-ride; release-only)
99. `.maestro/flows/rides/01-request-ride.yaml` (ride-lifecycle; android/ios; driver/passenger; login, request-ride; release-only)
100. `.maestro/flows/rides/02-chat-during-ride.yaml` (ride-lifecycle; android/ios; driver/passenger; chat, payment; release-only)
101. `.maestro/flows/rides/02-invalid-long-distance-guard.yaml` (ride-lifecycle; android/ios; passenger; chat, login, navigation, request-ride; blocked: dev-server-marker)
102. `.maestro/flows/screenshots-for-stores.yaml` (other; android/ios; driver; login, navigation, payment, request-ride; release-only)
103. `.maestro/flows/test-simple-launch.yaml` (other; android/ios; unknown; smoke; release-only)

## Category Breakdown

| Category | Product Routes | Maestro Flows |
|---|---:|---:|
| auth-onboarding | 23 | 6 |
| ride-lifecycle | 10 | 39 |
| driver-ops | 11 | 1 |
| wallet-finance | 0 | 1 |
| account-support | 12 | 0 |
| prototype | 6 | 0 |
| e2e-core | 0 | 13 |
| qa-auxiliary | 0 | 35 |
| other | 7 | 8 |

## Execution Notes

1. Reachable routes are extracted from `Stack.Screen` registrations in `src/navigation/AppNavigator.js`; `src/navigation/surfaceManifest.json` supplies current/redirect/legacy classification. Retired manifest entries are not counted as reachable.
2. Flow inventory is extracted from `.maestro/flows/**/*.yaml` excluding debug/helper flows that start with `_`.
3. Use `node scripts/qa/generate-flow-inventory.js` from `mobile-app/` to regenerate after navigation or flow changes.
4. `releaseOnly=false` means the flow still exists, but has a static blocker for release evidence such as dev-server markers, fixed OTP values, or payment mock/bypass markers.
