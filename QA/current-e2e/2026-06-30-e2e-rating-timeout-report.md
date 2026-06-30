# E2E ride smoke - 2026-06-30

## Context

- Branch: `codex/production-readiness-audit`
- Mobile runtime: `1.0.3`
- Payment mode: Woovi sandbox for test user, manually confirmed in dashboard during the run.
- Devices:
  - Passenger: Android physical device via USB-C.
  - Driver: iPhone/iOS session via mirrored device.

## OTA updates published

1. `Passenger search timeout decision modal`
   - Update group: `4be0ace8-0c1d-49d1-9c78-22f8921fa25d`
   - Android update: `019f19b3-6661-771e-b944-26a12bc19a5e`
   - iOS update: `019f19b3-6661-7530-9e31-f1cfdd7b12b5`

2. `Passenger rating return home reset`
   - Update group: `e2d2c155-fcb5-4256-9734-7cf5bec2952e`
   - Android update: `019f19cd-7a0a-7aeb-b338-184db557900f`
   - iOS update: `019f19cd-7a0a-7c93-ac07-baa42651e78e`

## Scope validated

- Passenger starts from clean home.
- Destination selection and quote render.
- Payment modal opens for Pix.
- Payment confirmation advances the flow.
- Driver receives ride offer after payment confirmation.
- Driver offer displays passenger name, route data, Pix status, net amount, pickup distance, trip distance, and trip duration.
- Driver accepts ride.
- Passenger moves to "driver on the way".
- Driver marks arrival at pickup.
- Passenger moves to "driver arrived".
- Driver starts trip.
- Passenger moves to in-trip progress state.
- Driver ends trip.
- Driver receipt renders final values.
- Passenger receipt renders final values.
- Passenger rating submits successfully.

## Versioning

- `9306288e` Harden backend socket session presence
- `268737b9` Enforce backend driver online policy
- `5595d501` Guard paid ride dispatch and refunds
- `8c8a33c3` Lock backend pricing routes and receipts
- `321f28fa` Stabilize mobile runtime sessions
- `20b95884` Stabilize passenger ride payment flow
- `3bdacb3a` Stabilize driver ride surfaces
- `33549030` Update QA runtime tooling
- QA evidence is curated under `QA/current-e2e`; historical raw QA dumps remain local and ignored.

## Financial reconciliation observed

- Passenger gross paid: `R$ 46,84`
- Passenger receipt:
  - Ride: `R$ 35,90`
  - Toll: `R$ 8,95`
  - Leaf fee: `R$ 1,99`
  - Total: `R$ 46,84`
- Driver receipt:
  - Passenger total: `R$ 46,84`
  - Toll: `R$ 8,95`
  - Leaf fee: `R$ 1,99`
  - Driver net: `R$ 44,85`
- Reconciliation:
  - `35,90 + 8,95 + 1,99 = 46,84`
  - `46,84 - 1,99 = 44,85`

## Evidence

- Passenger clean home after OTA: `QA/current-e2e/android-after-rating-reset-ota-home.png`
- Passenger quote before payment: `QA/current-e2e/android-retry-after-destination.png`
- Payment modal before confirmation: `QA/current-e2e/android-after-confirm-before-payment.png`
- Passenger after driver accepted: `QA/current-e2e/android-after-driver-accept.png`
- Passenger after driver arrived: `QA/current-e2e/android-after-driver-arrived.png`
- Passenger after trip start: `QA/current-e2e/android-after-trip-start.png`
- Driver receipt: `QA/current-e2e/iphone-driver-receipt.png`
- Passenger receipt: `QA/current-e2e/android-passenger-receipt.png`
- Passenger rating screen: `QA/current-e2e/android-passenger-rating-screen.png`
- Passenger after rating submit alert: `QA/current-e2e/android-passenger-after-rating-submit.png`
- Pre-fix bug evidence after rating OK: `QA/current-e2e/android-passenger-final-home-after-rating.png`
- Post-commit receipt replay: `QA/current-e2e/android-post-commit-open-receipt-attempt.png`
- Post-commit receipt close to clean home: `QA/current-e2e/android-post-commit-receipt-close-home-2.png`

## Fixes added during this closure

- Search timeout no longer forces a confusing terminal state at 3 minutes.
- At 3 minutes, passenger now gets a decision panel:
  - Cancel: cancels search, requests refund context, returns to clean home.
  - Continue: keeps search active.
- Rating completion now returns to passenger home with an explicit reset flag.
- Passenger home consumes the reset flag and clears pickup search, destination search, quote preview, availability notice, backend quote state, and keyboard state.

## Automated validation

- `git diff --check`
  - PASS
- `npm run governance:check`
  - PASS
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
  - PASS
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`
  - PASS
- `npm --prefix mobile-app run qa:production-guards`
  - PASS
- `npm --prefix leaf-websocket-backend run config:validate`
  - PASS
  - Warning only: `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`
- `npm --prefix mobile-app run test:unit -- --runInBand prototype-ride-screens.test.js passenger-search-lifecycle.test.js woovi-payment-modal.test.js driver-online-toggle.test.js`
  - PASS
  - 221 tests passed
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand`
  - PASS
  - 1014 tests passed
- Android physical device post-commit receipt replay
  - PASS for opening the persisted completed receipt.
  - PASS for closing the receipt back to clean home.
  - Exact rating replay was not repeated because the persisted receipt was already marked `Avaliação enviada`.

## Remaining risks

- The exact live passenger rating return was fixed after the completed ride where the bug appeared. The OTA was applied and the restarted Android returned to clean home. Post-commit receipt replay opened the persisted receipt and closed to clean home, but exact rating replay requires another completed ride because the persisted receipt was already marked as rated.
- No GPS mock was used. Navigation/camera looked correct in the observed flow and the trip could be completed, but real movement progress remains a later navigation-specific validation.
- Driver screen showed one transient "Não foi possível atualizar" alert around trip start/end timing. It did not block the E2E, but should stay on the watchlist for network retry/idempotency tuning.

## Rollback

- Mobile OTA rollback can be done by republishing the previous known-good update on `production` runtime `1.0.3`, or by disabling the latest update group in Expo if the release process allows it.
- The timeout/rating changes are JS-only and can be reverted without native rebuild.
