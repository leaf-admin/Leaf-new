# QA Flow Inventory

Generated at: 2026-06-22T20:09:07.273Z

Total navigation routes: 135
Total maestro flows (non-debug): 76
Release-only eligible flows: 57

## Release Preconditions

1. Executar somente build release instalado (`br.com.leaf.ride`), sem Expo Go/dev-client como alvo.
2. Backend deve responder `/health/runtime-flags` com `realSandbox.ready=true`.
3. Não usar payment mock, PaymentBypassService, E2E_TEST=true ou qualquer bypass de pagamento.
4. Motorista deve estar online e elegível antes de qualquer flow de solicitação do passageiro.
5. Evidências por rodada devem incluir JUnit XML, logs Maestro, screenshots e snapshot de runtime flags.

## Release Coverage Matrix

| Area | Status | Release-only flows | Gaps |
|---|---|---:|---|
| Cadastro passageiro | GAP | 1 | platform:ios |
| Cadastro motorista | GAP | 1 | platform:ios |
| Login passageiro/motorista | GO | 8 | - |
| Motorista online antes da solicitação | GO | 10 | - |
| Passageiro solicita corrida | GO | 16 | - |
| Motorista aceita corrida | GO | 4 | - |
| Navegação passageiro/motorista | GO | 16 | - |
| Chat em corrida ativa | GAP | 3 | role:driver |
| Suporte/ticket | GO | 2 | - |
| Avaliação pós-corrida | GO | 6 | - |

## Product Routes (One By One)

1. `About` (account-support)
2. `AccountSettings` (account-support)
3. `AccountStatement` (other)
4. `addMoney` (wallet-finance)
5. `AddMoney` (wallet-finance)
6. `AddVehicle` (driver-ops)
7. `AuthLoading` (auth-onboarding)
8. `AuthLoadingScreen` (auth-onboarding)
9. `AuthScreen` (auth-onboarding)
10. `BaaSAccount` (auth-onboarding)
11. `BaaSAccountScreen` (auth-onboarding)
12. `BookedCab` (ride-lifecycle)
13. `BookingConfirmation` (other)
14. `Cancellation` (ride-lifecycle)
15. `CancellationSuccess` (ride-lifecycle)
16. `CarEdit` (other)
17. `CarEditScreen` (other)
18. `Cars` (other)
19. `Chat` (account-support)
20. `CNHUpload` (auth-onboarding)
21. `CNHUploadScreen` (auth-onboarding)
22. `Complain` (ride-lifecycle)
23. `CompleteRegistration` (auth-onboarding)
24. `CRLVUpload` (auth-onboarding)
25. `CRLVUploadScreen` (auth-onboarding)
26. `Dashboard` (other)
27. `DriverBalance` (driver-ops)
28. `DriverDashboard` (driver-ops)
29. `DriverDocuments` (driver-ops)
30. `DriverIncome` (driver-ops)
31. `DriverInvite` (driver-ops)
32. `DriverRating` (driver-ops)
33. `DriverSearch` (driver-ops)
34. `DriverTerms` (auth-onboarding)
35. `DriverTrips` (ride-lifecycle)
36. `EarningsReport` (driver-ops)
37. `EarningsReportScreen` (driver-ops)
38. `EditProfile` (account-support)
39. `EditProfileScreen` (account-support)
40. `Feedback` (ride-lifecycle)
41. `FreeTrial` (auth-onboarding)
42. `Help` (account-support)
43. `HelpScreen` (account-support)
44. `Legal` (account-support)
45. `Login` (auth-onboarding)
46. `LoginScreen` (auth-onboarding)
47. `Map` (ride-lifecycle)
48. `MapScreen` (ride-lifecycle)
49. `Messages` (account-support)
50. `MyEarning` (other)
51. `MyVehicles` (driver-ops)
52. `MyVehiclesScreen` (driver-ops)
53. `Notifications` (account-support)
54. `onlineChat` (account-support)
55. `OTP` (auth-onboarding)
56. `PaymentDetails` (ride-lifecycle)
57. `PaymentFailed` (ride-lifecycle)
58. `PaymentSuccess` (ride-lifecycle)
59. `PaymentSuccessScreen` (ride-lifecycle)
60. `PersonalData` (other)
61. `PhoneInputScreen` (other)
62. `PhoneScreen` (other)
63. `PixPayment` (ride-lifecycle)
64. `PlanSelection` (auth-onboarding)
65. `PrivacyPolicy` (account-support)
66. `Profile` (account-support)
67. `ProfileSelection` (auth-onboarding)
68. `ProfileSelectionScreen` (auth-onboarding)
69. `Receipt` (ride-lifecycle)
70. `ReceiptDetails` (ride-lifecycle)
71. `Referral` (auth-onboarding)
72. `ReferralScreen` (auth-onboarding)
73. `Registration` (auth-onboarding)
74. `RideDetails` (ride-lifecycle)
75. `RideListScreen` (ride-lifecycle)
76. `Rides` (ride-lifecycle)
77. `RobotaxiMenuEditProfile` (account-support)
78. `RobotaxiMenuHelp` (account-support)
79. `RobotaxiMenuMessages` (account-support)
80. `RobotaxiMenuSettings` (account-support)
81. `RobotaxiMenuTripHistory` (ride-lifecycle)
82. `RobotaxiPrototype` (prototype)
83. `RobotaxiPrototypeBooking` (prototype)
84. `RobotaxiPrototypeCancellation` (ride-lifecycle)
85. `RobotaxiPrototypeChat` (account-support)
86. `RobotaxiPrototypeComplain` (ride-lifecycle)
87. `RobotaxiPrototypeDestination` (prototype)
88. `RobotaxiPrototypeDriverActivation` (driver-ops)
89. `RobotaxiPrototypeDriverDocuments` (driver-ops)
90. `RobotaxiPrototypeDriverOffer` (driver-ops)
91. `RobotaxiPrototypeDriverPanel` (driver-ops)
92. `RobotaxiPrototypeDriverSearch` (driver-ops)
93. `RobotaxiPrototypeDriverTrip` (ride-lifecycle)
94. `RobotaxiPrototypeDriverWaitlist` (driver-ops)
95. `RobotaxiPrototypeDriverWaitlistStatus` (driver-ops)
96. `RobotaxiPrototypeInvites` (prototype)
97. `RobotaxiPrototypeMenu` (prototype)
98. `RobotaxiPrototypeNoDrivers` (driver-ops)
99. `RobotaxiPrototypePayment` (ride-lifecycle)
100. `RobotaxiPrototypePaymentFailed` (ride-lifecycle)
101. `RobotaxiPrototypePaymentSuccess` (ride-lifecycle)
102. `RobotaxiPrototypeProfile` (account-support)
103. `RobotaxiPrototypePublicTracking` (prototype)
104. `RobotaxiPrototypeRating` (prototype)
105. `RobotaxiPrototypeReceipt` (ride-lifecycle)
106. `RobotaxiPrototypeSettings` (account-support)
107. `RobotaxiPrototypeShareTrip` (ride-lifecycle)
108. `RobotaxiPrototypeSupport` (account-support)
109. `RobotaxiPrototypeSupportTicket` (account-support)
110. `RobotaxiPrototypeTrip` (ride-lifecycle)
111. `RobotaxiPrototypeVehicles` (driver-ops)
112. `Search` (account-support)
113. `Settings` (account-support)
114. `SettingsScreen` (account-support)
115. `Splash` (other)
116. `SubscriptionManagement` (other)
117. `Support` (account-support)
118. `SupportChat` (account-support)
119. `SupportTicket` (account-support)
120. `TabRoot` (other)
121. `TransactionHistory` (other)
122. `TransferMoney` (other)
123. `TripDetails` (ride-lifecycle)
124. `Trips` (ride-lifecycle)
125. `TripTracking` (ride-lifecycle)
126. `UpdateBankInfo` (other)
127. `UserInfo` (other)
128. `VehicleRegistration` (auth-onboarding)
129. `WaitList` (other)
130. `WalletDetails` (wallet-finance)
131. `WeeklyPayment` (ride-lifecycle)
132. `WeeklyPaymentScreen` (ride-lifecycle)
133. `WelcomeScreen` (auth-onboarding)
134. `WithdrawMoney` (wallet-finance)
135. `WooviDriverBalance` (driver-ops)

## Maestro Flows (One By One)

1. `.maestro/flows/account-deletion-direct-smoke.yaml` (other; android/ios; unknown; navigation; release-only)
2. `.maestro/flows/auth.yaml` (other; android/ios; driver/passenger; driver-online, login; blocked: payment-bypass-marker)
3. `.maestro/flows/auth/01-login-customer-real.yaml` (auth-onboarding; android/ios; passenger; login, navigation, rating, request-ride, support; blocked: dev-server-marker)
4. `.maestro/flows/auth/01-login-customer.yaml` (auth-onboarding; android/ios; passenger; login, request-ride; release-only)
5. `.maestro/flows/auth/02-login-driver.yaml` (auth-onboarding; android/ios; driver; driver-online, login, navigation; release-only)
6. `.maestro/flows/auth/03-phone-otp-login-new-ios.yaml` (auth-onboarding; ios; passenger; login, navigation, request-ride; blocked: dev-server-marker)
7. `.maestro/flows/auth/03-phone-otp-login-new.yaml` (auth-onboarding; android/ios; unknown; login, navigation; blocked: dev-server-marker)
8. `.maestro/flows/auth/04-phone-driver-home-online-ios.yaml` (auth-onboarding; ios; driver; driver-online, login, navigation; blocked: dev-server-marker)
9. `.maestro/flows/driver/01-driver-go-online.yaml` (driver-ops; android/ios; driver; driver-online; release-only)
10. `.maestro/flows/payments/01-payment-flow.yaml` (wallet-finance; android/ios; unknown; payment; release-only)
11. `.maestro/flows/qa/01-passenger-prototype-qa.yaml` (qa-auxiliary; android/ios; passenger; driver-online, login, navigation, payment, request-ride; blocked: dev-server-marker)
12. `.maestro/flows/qa/02-driver-prototype-qa.yaml` (qa-auxiliary; android/ios; driver; driver-online, login, navigation; blocked: dev-server-marker)
13. `.maestro/flows/qa/03-passenger-final-view.yaml` (qa-auxiliary; android/ios; passenger; navigation; release-only)
14. `.maestro/flows/qa/04-driver-final-view.yaml` (qa-auxiliary; android/ios; driver; navigation; release-only)
15. `.maestro/flows/qa/05-cleanup-driver-prompt.yaml` (qa-auxiliary; android/ios; driver; navigation; blocked: dev-server-marker)
16. `.maestro/flows/qa/06-passenger-prototype-refine.yaml` (qa-auxiliary; android/ios; passenger; login, navigation; blocked: dev-server-marker)
17. `.maestro/flows/qa/07-driver-prototype-refine.yaml` (qa-auxiliary; android/ios; driver; login, navigation; blocked: dev-server-marker)
18. `.maestro/flows/qa/08-passenger-voice-smoke.yaml` (qa-auxiliary; android/ios; passenger; login, navigation; blocked: dev-server-marker)
19. `.maestro/flows/qa/09-passenger-voice-tap.yaml` (qa-auxiliary; android/ios; passenger; smoke; release-only)
20. `.maestro/flows/qa/10-passenger-voice-after-login.yaml` (qa-auxiliary; android/ios; passenger; login; release-only)
21. `.maestro/flows/qa/11-passenger-menu-support-settings-audit.yaml` (qa-auxiliary; android/ios; passenger; chat, navigation, support; release-only)
22. `.maestro/flows/qa/12-passenger-rating-screen-audit.yaml` (qa-auxiliary; android/ios; passenger; navigation, rating; release-only)
23. `.maestro/flows/qa/90-play-video-passenger-voice-android.yaml` (qa-auxiliary; android; passenger; smoke; release-only)
24. `.maestro/flows/qa/91-play-video-driver-location-android.yaml` (qa-auxiliary; android; driver; driver-online; release-only)
25. `.maestro/flows/qa/e2e/01-driver-login-online-8082.yaml` (e2e-core; android/ios; driver; driver-online, login, navigation; blocked: dev-server-marker)
26. `.maestro/flows/qa/e2e/02-passenger-login-8081.yaml` (e2e-core; android/ios; passenger; login, navigation; blocked: dev-server-marker)
27. `.maestro/flows/qa/e2e/03-passenger-request-ride.yaml` (e2e-core; android/ios; driver/passenger; navigation, payment, request-ride; release-only)
28. `.maestro/flows/qa/e2e/04-driver-offer-trip-complete.yaml` (e2e-core; android/ios; driver/passenger; complete-ride, driver-online, navigation, trip-progress; release-only)
29. `.maestro/flows/qa/e2e/05-passenger-post-trip-verify.yaml` (e2e-core; android/ios; driver/passenger; complete-ride, navigation, request-ride; release-only)
30. `.maestro/flows/qa/e2e/06-passenger-navigation-audit.yaml` (e2e-core; android/ios; passenger; chat, complete-ride, navigation; release-only)
31. `.maestro/flows/qa/e2e/07-driver-navigation-audit.yaml` (e2e-core; android/ios; driver; driver-online, navigation; release-only)
32. `.maestro/flows/qa/e2e/20-passenger-signup-real-android.yaml` (e2e-core; android; passenger; login, rating, request-ride, signup, support; release-only)
33. `.maestro/flows/qa/e2e/20-passenger-signup-screenshots-android.yaml` (e2e-core; android; passenger; login, navigation, rating, request-ride, signup, support; blocked: dev-server-marker)
34. `.maestro/flows/qa/e2e/21-driver-signup-docs-real-android.yaml` (e2e-core; android; driver; driver-online, login, signup; release-only)
35. `.maestro/flows/qa/e2e/21-driver-signup-screenshots-android.yaml` (e2e-core; android; driver; driver-online, login, navigation, signup; blocked: dev-server-marker)
36. `.maestro/flows/qa/e2e/ideal/11-driver-login-online-ideal.yaml` (ride-lifecycle; android/ios; driver; driver-online, login, navigation; blocked: dev-server-marker)
37. `.maestro/flows/qa/e2e/ideal/12-passenger-login-ideal.yaml` (ride-lifecycle; android/ios; passenger; login, navigation, request-ride; blocked: dev-server-marker)
38. `.maestro/flows/qa/e2e/ideal/13-passenger-request-ideal.yaml` (ride-lifecycle; android/ios; driver/passenger; navigation, payment, request-ride; release-only)
39. `.maestro/flows/qa/e2e/ideal/14-driver-complete-ideal.yaml` (ride-lifecycle; android/ios; driver; accept-ride, complete-ride, navigation, trip-progress; release-only)
40. `.maestro/flows/qa/e2e/ideal/15-passenger-receipt-rating-ideal.yaml` (ride-lifecycle; android/ios; passenger; complete-ride, navigation, rating; release-only)
41. `.maestro/flows/qa/e2e/lifecycle/00-driver-offline-home.yaml` (ride-lifecycle; android/ios; driver; driver-online; release-only)
42. `.maestro/flows/qa/e2e/lifecycle/01-driver-online-home.yaml` (ride-lifecycle; android/ios; driver; driver-online; release-only)
43. `.maestro/flows/qa/e2e/lifecycle/01-driver-toggle-online.yaml` (ride-lifecycle; android/ios; driver; driver-online; release-only)
44. `.maestro/flows/qa/e2e/lifecycle/02-passenger-request-copacabana-release-direct.yaml` (ride-lifecycle; android/ios; driver/passenger; payment, request-ride; release-only)
45. `.maestro/flows/qa/e2e/lifecycle/02-passenger-request-copacabana.yaml` (ride-lifecycle; android/ios; driver/passenger; payment, request-ride; release-only)
46. `.maestro/flows/qa/e2e/lifecycle/02-passenger-request-home.yaml` (ride-lifecycle; android/ios; driver/passenger; payment, request-ride; release-only)
47. `.maestro/flows/qa/e2e/lifecycle/02-passenger-request-recent-destination.yaml` (ride-lifecycle; android/ios; driver/passenger; payment, request-ride; release-only)
48. `.maestro/flows/qa/e2e/lifecycle/03-driver-accept-offer.yaml` (ride-lifecycle; android/ios; driver; accept-ride; release-only)
49. `.maestro/flows/qa/e2e/lifecycle/03-driver-wait-offer.yaml` (ride-lifecycle; android/ios; driver; accept-ride; release-only)
50. `.maestro/flows/qa/e2e/lifecycle/04-driver-accept-offer.yaml` (ride-lifecycle; android/ios; driver; accept-ride, trip-progress; release-only)
51. `.maestro/flows/qa/e2e/lifecycle/04-driver-arrived.yaml` (ride-lifecycle; android/ios; driver; trip-progress; release-only)
52. `.maestro/flows/qa/e2e/lifecycle/05-driver-arrive-pickup.yaml` (ride-lifecycle; android/ios; driver; trip-progress; release-only)
53. `.maestro/flows/qa/e2e/lifecycle/05-driver-start-trip.yaml` (ride-lifecycle; android/ios; driver; trip-progress; release-only)
54. `.maestro/flows/qa/e2e/lifecycle/06-driver-complete-trip.yaml` (ride-lifecycle; android/ios; driver; complete-ride; release-only)
55. `.maestro/flows/qa/e2e/lifecycle/06-driver-start-trip.yaml` (ride-lifecycle; android/ios; driver; trip-progress; release-only)
56. `.maestro/flows/qa/e2e/lifecycle/07-driver-complete-trip.yaml` (ride-lifecycle; android/ios; driver; complete-ride; release-only)
57. `.maestro/flows/qa/e2e/lifecycle/07-passenger-rate-trip.yaml` (ride-lifecycle; android/ios; passenger; complete-ride, rating; release-only)
58. `.maestro/flows/qa/e2e/lifecycle/08-driver-rate-passenger.yaml` (ride-lifecycle; android/ios; driver/passenger; complete-ride, payment, rating; release-only)
59. `.maestro/flows/qa/e2e/lifecycle/09-driver-receipt-back-to-map.yaml` (ride-lifecycle; android/ios; driver/passenger; complete-ride, driver-online, payment, rating; release-only)
60. `.maestro/flows/qa/e2e/lifecycle/10-passenger-receipt-back-to-map.yaml` (ride-lifecycle; android/ios; passenger; complete-ride, request-ride; release-only)
61. `.maestro/flows/qa/e2e/lifecycle/11-driver-open-earnings.yaml` (ride-lifecycle; android/ios; driver; navigation; release-only)
62. `.maestro/flows/qa/e2e/wave4/00-passenger-quote-ready.yaml` (ride-lifecycle; android/ios; passenger; request-ride; release-only)
63. `.maestro/flows/qa/e2e/wave4/01-passenger-request-from-quote.yaml` (ride-lifecycle; android/ios; driver/passenger; request-ride; release-only)
64. `.maestro/flows/qa/e2e/wave4/02-passenger-cancel-search.yaml` (ride-lifecycle; android/ios; driver/passenger; smoke; release-only)
65. `.maestro/flows/qa/e2e/wave4/03-driver-interrupt-operational.yaml` (ride-lifecycle; android/ios; driver; smoke; release-only)
66. `.maestro/flows/qa/e2e/wave4/04-passenger-operational-continue.yaml` (ride-lifecycle; android/ios; driver/passenger; smoke; release-only)
67. `.maestro/flows/qa/e2e/wave4/05-passenger-end-early.yaml` (ride-lifecycle; android/ios; passenger; complete-ride; release-only)
68. `.maestro/flows/qa/e2e/wave4/06-passenger-request-extension.yaml` (ride-lifecycle; android/ios; driver/passenger; request-ride; release-only)
69. `.maestro/flows/qa/e2e/wave4/07-driver-accept-extension.yaml` (ride-lifecycle; android/ios; driver; smoke; release-only)
70. `.maestro/flows/ride_request.yaml` (other; android/ios; driver/passenger; payment, request-ride; blocked: payment-bypass-marker)
71. `.maestro/flows/rides/01-request-ride-real.yaml` (ride-lifecycle; android/ios; driver/passenger; login, payment, request-ride; release-only)
72. `.maestro/flows/rides/01-request-ride.yaml` (ride-lifecycle; android/ios; driver/passenger; login, request-ride; release-only)
73. `.maestro/flows/rides/02-chat-during-ride.yaml` (ride-lifecycle; android/ios; unknown; chat; release-only)
74. `.maestro/flows/rides/02-invalid-long-distance-guard.yaml` (ride-lifecycle; android/ios; passenger; chat, login, navigation, request-ride; blocked: dev-server-marker)
75. `.maestro/flows/screenshots-for-stores.yaml` (other; android/ios; driver; login, navigation, payment, request-ride; release-only)
76. `.maestro/flows/test-simple-launch.yaml` (other; android/ios; unknown; smoke; release-only)

## Category Breakdown

| Category | Product Routes | Maestro Flows |
|---|---:|---:|
| auth-onboarding | 23 | 6 |
| ride-lifecycle | 33 | 38 |
| driver-ops | 22 | 1 |
| wallet-finance | 4 | 1 |
| account-support | 28 | 0 |
| prototype | 7 | 0 |
| e2e-core | 0 | 11 |
| qa-auxiliary | 0 | 14 |
| other | 18 | 5 |

## Execution Notes

1. Route inventory is extracted from `src/navigation/AppNavigator.js`.
2. Flow inventory is extracted from `.maestro/flows/**/*.yaml` excluding debug/helper flows that start with `_`.
3. Use `node scripts/qa/generate-flow-inventory.js` from `mobile-app/` to regenerate after navigation or flow changes.
4. `releaseOnly=false` means the flow still exists, but has a static blocker for release evidence such as dev-server markers or payment mock/bypass markers.
