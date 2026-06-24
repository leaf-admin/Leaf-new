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
   - Local/backend validations must finish before a real device/simulator L2
     ride attempt. Do not use the smoke to discover backend syntax, unit, config,
     or dashboard-contract failures that have an existing local gate.

2. Passenger and driver test identities are known.
   - Passenger and driver must be distinct users.
   - Both users must be in the same test region.
   - The driver must be online, dispatch eligible, and close enough to the pickup
     before payment or ride request is opened.
   - The L2 ride smoke must run with one role on the connected Android device and
     the other role on a simulator/emulator when available. Record which runtime
     owns passenger and which runtime owns driver before the run starts.
   - For Android L2, `prepare-real-smoke-env.sh` must generate and pass the
     role-runtime verification before any ride action: passenger and driver
     serials must be distinct, the physical-device role must not resolve to an
     `emulator-*` serial, the Leaf package must be installed on both runtimes,
     passenger/driver app versionName and versionCode must match, and
     `android-role-runtime-verification.json` must be captured.
   - When a matching local driver APK exists, the generated smoke helper should
     install it on the driver emulator before L2 runtime verification; a stale
     driver emulator build is a blocked precondition, not a smoke attempt.
   - A managed driver dispatch bot is allowed only as backend/dispatch support
     evidence. It is not accepted as driver-app UI evidence for full app-to-app
     L2 validation.
   - The managed driver must expose plate, model, and color from the canonical
     active vehicle. Real CRLV OCR uses `crlv_pdf_ocr`; controlled test-user
     fixtures must be labeled `qa_crlv_fixture` and must never impersonate OCR.

3. Geofence state is known before payment.
   - The pickup and destination must be inside an enabled test area, or the
     geofence must be explicitly disabled/expanded for the test.
   - `prepare-real-smoke-env.sh` must validate pickup and destination geofence
     before the payment runtime sandbox canary.
   - A geofence failure after payment is a product failure, not an acceptable
     smoke outcome.

4. Payment sandbox is confirmed by backend policy.
   - Woovi sandbox mode must be active for the test user/profile by backend flag
     or user-level configuration.
   - The test must have a direct sandbox approval path before opening payment.
   - If sandbox mode is not confirmed, stop before payment.
   - Use `activate-payment-runtime-sandbox-profile.sh` in `DRY_RUN=true` first
     when a short-lived user sandbox profile is needed. The real backend mutation
     requires explicit operator approval plus `DRY_RUN=false` and
     `CONFIRM_PAYMENT_RUNTIME_MUTATION=true`.

5. Fare and route are canonical.
   - Passenger UI must not show a provisional fare after destination entry.
   - Passenger gross fare is the canonical user-facing amount. It must match
     quote, Pix charge, passenger receipt, and dashboard passenger gross.
   - Driver net, Leaf fee, Woovi fee, tolls, and pass-through values are separate
     canonical fields. They must add up from the same backend-final snapshot, not
     appear as alternate passenger fares.
   - Passenger UI must never describe fare as "in reconciliation". If the
     backend-final financial snapshot is missing, the UI must fail closed with no
     alternate currency amount and no rating release.
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
- `blocked_precondition:android_role_pair_not_ready`

Do not label a blocked precondition as a failed smoke test. Do not continue into
payment or dispatch when the block is known up front.

## Runner Interpretation Rules

- A smoke runner must classify only observed product failures as `failed`.
- If automation cannot identify the current screen but the device visibly
  advanced, record the current screen, screenshot/XML, backend status, and
  classify the step as `automation_inconclusive` until evidence is reviewed.
- Do not seed or force a later lifecycle state to make a blocked run pass. Fix
  the precondition or stop with `blocked_precondition:<reason>`.
- Do not infer fare mismatch by comparing passenger gross to driver net. Compare
  passenger gross to passenger gross, driver net to driver net, and fees to their
  explicit backend-final fields.
- Do not report a state regression until the captured screen, route name, active
  booking id, and latest backend event all point to a previous lifecycle state.
- Every failed or blocked run must include a machine-readable
  `failureClassification` section with `status`, `domain`, `severity`, `owner`,
  and original message.

## Failure Domains

Use these domains before deciding what to fix:

- `product`: observed behavior that would affect a real passenger, driver, or
  operator in the app/backend/dashboard. Examples: stale pickup used for quote
  or payment, Pix modal failing to become usable, lifecycle state regression,
  quote instability, route fallback rendered as valid route, or critical runtime
  errors.
- `business_rule`: violation of a canonical product policy. Examples: payment
  before driver availability/geofence, fare mismatch across canonical gross
  surfaces, non-canonical driver vehicle identity, driver active without required
  KYC/CRLV/liveness, or missing explicit fee/toll fields.
- `test_harness`: automation could not read or drive the current product state
  reliably. Examples: selector/testID missing, ADB input failure, dashboard
  evidence collector unable to authenticate, log parser failure, or sandbox
  auto-confirm helper inconclusive while the product state is otherwise visible.
- `execution_environment`: device, build, provider sandbox, infra, or local
  tooling is not ready. Examples: disconnected device, stale app version,
  missing ADB/Java, existing active ride from a previous run, backend health
  unavailable, or provider sandbox outage.

Do not mix domains in the conclusion. A run may have several entries, but the
next action must target the highest-severity classified item, not the last screen
the script happened to capture.

## Smoke Levels

- L0 quote smoke: validates device launch, destination entry, quote stability,
  route preview, and backend quote request count. It does not validate a ride.
- L1 payment smoke: validates Pix sandbox creation and confirmation. It does not
  validate dispatch or trip completion.
- L2 full ride smoke: validates passenger plus driver, payment confirmation,
  dispatch offer, driver accept, arrival, trip start, trip completion, rating,
  receipt, dashboard, backend events, and canonical fare consistency. Only L2 can
  be called a complete ride smoke.

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
be proven before payment. Then verify the driver runtime itself before starting
the ride: `start-driver-emulator.sh` may be used to boot/warm the Android driver
emulator, and `verify-android-role-runtimes.sh` must pass before
`run-android-smoke.sh` proceeds. The verifier must keep
`ANDROID_EMULATOR_STABILITY_SECONDS` at the default 60 seconds or a stricter
value for L2; shorter overrides are for local troubleshooting only and are not
release evidence.

When a code change requires OTA, backend deploy, or a native build, record the
validation ladder used before the release action. Production deploys, OTA
promotion, store submission, and provider-console actions require an explicit
final operator approval after local/focused gates pass.

## Required Evidence

Every real smoke report must include:

- Date/time, app version, runtime version, OTA update group or native build id.
- Device serial, OS version, package id, passenger test user, driver test user.
- Passenger runtime/serial and driver runtime/serial, including proof that they
  are distinct for Android L2.
- Pickup/destination coordinates and geofence mode.
- Driver availability evidence before request/payment.
- Canonical driver vehicle identity and provenance across the
  accepted trip UI, receipt, and dashboard projection.
- Quote id/session id, gross fare, net fare, fee/tax breakdown, expiration time.
- Payment sandbox charge id and confirmation event.
- Booking id and ordered lifecycle events.
- Route source and whether traffic segments were rendered.
- Rating and receipt result.
- Dashboard fare/status consistency for the same ride id.
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
