# Canonical Smoke Test Directives

This document defines the mandatory preconditions and evidence for real-device
Leaf smoke tests. A smoke attempt is only valid when these directives are met.

## Scope

These directives apply to Android/iOS passenger and driver smoke tests that touch
ride request, payment, dispatch, trip lifecycle, rating, receipt, dashboard, and
backend event monitoring.

## Non-Negotiable Preconditions

1. Device and tooling are ready before the smoke starts.
   - Android ADB must resolve from `/Users/izaakdias/Android/Sdk/platform-tools/adb`
     or from `ADB_BIN`.
   - Java/Maestro setup must be checked before the smoke. Do not spend smoke time
     searching for SDK paths.
   - Run `source mobile-app/scripts/source-local-build-env.sh` before local
     Android automation when available.

2. Passenger and driver test identities are known.
   - Passenger and driver must be distinct users.
   - Both users must be in the same test region.
   - The driver must be online, dispatch eligible, and close enough to the pickup
     before payment or ride request is opened.
   - The managed driver must expose plate, model, and color from the canonical
     active vehicle. Real CRLV OCR uses `crlv_pdf_ocr`; controlled test-user
     fixtures must be labeled `qa_crlv_fixture` and must never impersonate OCR.

3. Payment sandbox is confirmed by backend policy.
   - Woovi sandbox mode must be active for the test user/profile by backend flag
     or user-level configuration.
   - The test must have a direct sandbox approval path before opening payment.
   - If sandbox mode is not confirmed, stop before payment.

4. Geofence state is known before payment.
   - The pickup and destination must be inside an enabled test area, or the
     geofence must be explicitly disabled/expanded for the test.
   - A geofence failure after payment is a product failure, not an acceptable
     smoke outcome.

5. Fare and route are canonical.
   - Passenger UI must not show a provisional fare after destination entry.
   - The fare shown at quote, payment, receipt, dashboard, and driver settlement
     must reconcile across gross amount, net amount, and explicit fees.
   - The route preview must be backend/provider-derived. A synthetic straight or
     fallback route is not valid evidence for ride request.
   - Polyline traffic coloring must reflect available backend route traffic data.

## Blocking Rules

Stop and mark the run as `blocked_precondition` when any precondition fails.

- `blocked_precondition:driver_unavailable`
- `blocked_precondition:driver_vehicle_identity_incomplete`
- `blocked_precondition:driver_vehicle_identity_not_canonical`
- `blocked_precondition:driver_vehicle_identity_not_crlv`
- `blocked_precondition:geofence_not_ready`
- `blocked_precondition:payment_sandbox_not_confirmed`
- `blocked_precondition:toolchain_not_ready`
- `blocked_precondition:device_not_ready`

Do not label a blocked precondition as a failed smoke test. Do not continue into
payment or dispatch when the block is known up front.

## Smoke Levels

- L0 quote smoke: validates device launch, destination entry, quote stability,
  route preview, and backend quote request count. It does not validate a ride.
- L1 payment smoke: validates Pix sandbox creation and confirmation. It does not
  validate dispatch or trip completion.
- L2 full ride smoke: validates passenger plus driver, payment confirmation,
  dispatch offer, driver accept, arrival, trip start, trip completion, rating,
  receipt, dashboard, backend events, and reconciliation. Only L2 can be called a
  complete ride smoke.

## Canonical Commands

```bash
git status --short
source mobile-app/scripts/source-local-build-env.sh
export ADB_BIN=/Users/izaakdias/Android/Sdk/platform-tools/adb
"$ADB_BIN" devices -l
npm --prefix mobile-app run qa:production-guards
node scripts/maintenance/security/scan-secrets.cjs --tracked-only
bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh
```

For a full ride smoke, first confirm the driver is available through the current
backend smoke/preflight script or driver dispatch bot using the same pickup
coordinates that the passenger device will use. The run is blocked if this cannot
be proven before payment.

## Required Evidence

Every real smoke report must include:

- Date/time, app version, runtime version, OTA update group or native build id.
- Device serial, OS version, package id, passenger test user, driver test user.
- Pickup/destination coordinates and geofence mode.
- Driver availability evidence before request/payment.
- Canonical driver vehicle identity, provenance, and reconciliation across the
  accepted trip UI, receipt, and dashboard projection.
- Quote id/session id, gross fare, net fare, fee/tax breakdown, expiration time.
- Payment sandbox charge id and confirmation event.
- Booking id and ordered lifecycle events.
- Route source and whether traffic segments were rendered.
- Rating and receipt result.
- Dashboard fare and status reconciliation.
- Backend logs or event stream correlation id.
- Final status: `passed`, `failed`, or `blocked_precondition:<reason>`.

## Failure Severity

- P0: payment confirmed before geofence/coverage block, fare mismatch across
  quote/payment/receipt/dashboard, ride state regression, duplicate or out-of-
  order transaction state, or trip cannot be finalized.
- P1: missing rating, receipt mismatch without money movement impact, dashboard
  lag that self-heals but produces operator confusion, or route traffic missing
  when backend traffic data exists.
- P2: copy, minor visual polish, non-blocking telemetry gaps.

## Cleanup

After each L1 or L2 smoke, record and clean test artifacts according to backend
policy: open payments, bookings, driver online state, dispatch bot sessions,
test geofence overrides, and dashboard notes.
