# Phase 5 - Navigation and State Audit

Date: 2026-03-26
Scope: mobile app navigation, route reachability, screen state coverage, reachable mock/simulated data, role locks
Method: static audit of navigator plus core passenger/driver prototype screens and reachable shared modules
Verdict: GO
Remediation status: P0 fake-history fallback removed; public/private split applied; prototype flag reactivated; driver placeholder state removed; release-hardening of review/bypass paths applied

## Summary

The core runtime validated in Phases 2-4 remains healthy, but the app surface is still exposing wrong or overly broad UI states at the navigation layer.

The main release blockers found in this phase were:

1. A reachable fake history fallback is rendered when the account has no trips.
2. The navigator registers prototype/private routes even in the public stack.
3. The private stack still exposes role-unsafe and legacy aliases broadly.
4. Some driver screens synthesize placeholder ride data instead of rendering an explicit blocked or empty state.

## What Passed

- Passenger quote/search/trip screens contain explicit loading, failure, cancellation, and no-driver transitions.
- Driver activation is wired to remote document status and persists analysis state.
- Receipt and support flows have explicit empty/loading states instead of silently crashing.
- Backend-driven role resolution remains the source of truth in the navigator.

## Findings

### P0 - Fake trip history was reachable when the user had no real history

The menu screen previously rendered invented rides when `tripHistory` was empty. This was removed immediately after the audit and replaced by a true empty state.

References:
- [RobotaxiMenuScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiMenuScreen.js#L136)
- [RobotaxiMenuScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiMenuScreen.js#L361)

Impact:
- Breaks trust immediately.
- Invalidates operational review of receipts/history.
- Must be removed before store release.

Required fix:
- Replace `FALLBACK_HISTORY` with a true empty state and CTA to return to the map or receipts.

Status:
- Fixed after audit in [RobotaxiMenuScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiMenuScreen.js#L136)

### P1 - Prototype/private routes are registered in the unauthenticated navigator

The public stack still registers the full Robotaxi flow, including payment, trip, support, receipt, driver panel, and driver activation screens, even before authentication.

References:
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L192)
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L195)
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L265)
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L272)

Impact:
- Public surface is larger than intended.
- Makes auth boundary dependent on screen internals instead of navigation structure.
- Increases risk of deep-link or regression access into protected flows.

Required fix:
- Remove private/prototype booking flow routes from the public navigator.
- Keep only true public routes: splash, auth, legal/privacy.

Status:
- Fixed after refactor in [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L186)
- Public stack now contains only auth/onboarding/legal routes in [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L587)

### P1 - Feature flag for prototype UI is effectively dead

`prototypeUiEnabled` is loaded, but `allowPrototypeScreens` is hardcoded to `true`, so the flag cannot actually disable prototype route registration.

References:
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L192)
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L195)
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L214)

Impact:
- No safe switch exists to reduce route surface.
- Release hygiene depends on code edits instead of config.

Required fix:
- Make `allowPrototypeScreens` depend on the loaded flag and environment policy.

Status:
- Fixed after refactor in [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L567)
- Default prototype flag updated in [FeatureFlagService.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/FeatureFlagService.js#L26)

### P1 - Private stack still exposes role-unsafe legacy routes and aliases

The authenticated navigator registers a broad mixed stack with passenger routes, driver routes, onboarding legacy screens, compatibility aliases, and prototype routes in the same tree. Some driver-adjacent screens are registered even when the active role is not driver.

References:
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L487)
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L547)
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L562)
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L596)
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L633)

Examples:
- `EarningsReport` is globally registered.
- `DriverDocuments` is globally registered.
- Legacy aliases such as `MapScreen`, `TabRoot`, `DriverDashboard`, `TripTrackingScreen` remain reachable.

Impact:
- Harder to reason about backstack and deep links.
- Higher regression surface.
- Role safety relies on screen-level behavior instead of route-level control.

Required fix:
- Split navigator registration by role and remove obsolete aliases from the production graph.

Status:
- Partially fixed after refactor with explicit customer/driver route groups in [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L286) and [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js#L312)
- Remaining cleanup is legacy-screen debt reduction, not broad cross-role registration anymore

### P1 - Driver panel and trip screen still fabricate placeholder ride data

When real offer/ride state is absent, driver screens synthesize request content with placeholders such as `Passageiro Leaf`, `Origem atual`, and destination fallbacks. These screens should render explicit empty or resync states instead.

References:
- [RobotaxiDriverPanelScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverPanelScreen.js#L43)
- [RobotaxiDriverPanelScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverPanelScreen.js#L56)
- [RobotaxiDriverTripScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverTripScreen.js#L44)
- [RobotaxiDriverTripScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverTripScreen.js#L53)

Impact:
- Can show fake operational state during desync/reconnect.
- Confuses the driver about whether there is a real active ride or a stale local shell.

Required fix:
- Replace fabricated request objects with:
  - `syncing current ride`
  - `no active ride`
  - `offer expired`

Status:
- Fixed in [RobotaxiDriverPanelScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverPanelScreen.js#L43)
- Fixed in [RobotaxiDriverTripScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverTripScreen.js#L44)

### P2 - Profile and driver panel still rely on hardcoded presentation fallbacks

The driver panel hardcodes a `4.96` rating. The profile screen falls back to generic names, a placeholder avatar URL, and default ratings.

References:
- [RobotaxiDriverPanelScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverPanelScreen.js#L89)
- [RobotaxiDriverPanelScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverPanelScreen.js#L218)
- [RobotaxiProfileScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiProfileScreen.js#L37)
- [RobotaxiProfileScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiProfileScreen.js#L39)
- [RobotaxiProfileScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiProfileScreen.js#L41)

Impact:
- Weakens product credibility.
- Makes empty/uninitialized states look like valid account data.

Required fix:
- Use null states with clean placeholders, not fake metrics.

Status:
- Fixed in [RobotaxiDriverPanelScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverPanelScreen.js#L80)
- Fixed in [RobotaxiProfileScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiProfileScreen.js#L37)

### P2 - Dev/review bypass paths required central gating for release hygiene

The app previously spread review/e2e/payment-bypass rules across auth, OTP, payment, and legacy driver/test services. That made release behavior harder to reason about and increased the chance of a permissive fallback surviving outside the intended environment.

References:
- [runtimeAccessPolicy.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/runtimeAccessPolicy.js)
- [PhoneInputStep.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/PhoneInputStep.js)
- [OTPStep.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/OTPStep.js)
- [AuthFlow.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/AuthFlow.js)
- [WooviPaymentModal.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/payment/WooviPaymentModal.js)
- [PaymentBypassService.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/PaymentBypassService.js)
- [AuthProvider.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/AuthProvider.js)
- [DatabaseBypass.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/DatabaseBypass.js)
- [VehicleService.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/VehicleService.js)
- [VehicleNotificationService.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/VehicleNotificationService.js)
- [DriverUI.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/map/DriverUI.js)

Impact:
- Before the fix, release safety depended on several local checks and duplicated env parsing.
- Legacy driver/test code still had permissive fallbacks such as `review-`/`test-user-dev` approval and fake UID defaults.

Required fix:
- Centralize build-time gating for review, e2e, custom OTP, and payment bypass.
- Ensure legacy test/review helpers short-circuit to `false` outside `dev/e2e/review`.
- Remove fake UID defaults from runtime paths.

Status:
- Fixed with centralized policy in [runtimeAccessPolicy.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/runtimeAccessPolicy.js)
- Auth/review/custom OTP paths now consume the shared policy in [PhoneInputStep.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/PhoneInputStep.js), [OTPStep.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/OTPStep.js), and [AuthFlow.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/AuthFlow.js)
- Payment bypass now resolves only through the shared policy in [WooviPaymentModal.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/payment/WooviPaymentModal.js) and [PaymentBypassService.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/PaymentBypassService.js)
- Legacy test/review helpers are now gated in [AuthProvider.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/AuthProvider.js), [DatabaseBypass.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/DatabaseBypass.js), [VehicleService.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/VehicleService.js), [VehicleNotificationService.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/VehicleNotificationService.js), and [DriverUI.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/map/DriverUI.js)

## Risk Classification

- P0: 1
- P1: 4
- P2: 2

## Release Decision for Phase 5

Current status for navigation/state hygiene is `GO`.

The runtime itself is progressing correctly, and the app shell no longer carries open blockers in this phase. The remaining note is continued legacy cleanup, not a blocker from this phase:

1. Keep release verification explicit for review/bypass code paths.
2. Continue reducing legacy aliases as debt cleanup, not as a phase blocker.

## Recommended Execution Order

1. Run a release-profile build check to confirm the shared policy resolves all test/review gates to `false`.
2. Remove or quarantine legacy aliases not needed by the active runtime.
3. Run a targeted manual navigation pass after the cleanup.

## Notes

- This phase was primarily a static audit of reachability and state handling.
- Technical runtime validation from Phases 2-4 remains valid and is not contradicted by these findings.
