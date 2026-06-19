# P0 E2E Completion Plan - 2026-06-19

## Objective

Conclude the P0 ride-hailing validation with minimum human intervention, using
the Android device installed from Google Play, OTA runtime `1.0.3`, backend
sandbox payment policy by test user, and a driver bot or simulator-side driver
session in the same region as the passenger.

This plan is execution-first: every step either produces evidence, advances the
smoke, or blocks the run before money/dispatch state is mutated.

## Current Baseline

- Android package: `br.com.leaf.ride`
- Android build observed: `versionName=1.0.3`, `versionCode=119`
- Installer observed: `com.android.vending`
- OTA channel: `production`
- Latest OTA group validated on device: `f088bcad-7372-4c4c-b403-a273ad4cd20b`
- Last real-device smoke result: `passenger_searching_driver`
- Active ride visual state validated:
  - `Buscando motorista`
  - `Pagamento confirmado`
  - fare stable at `R$ 87,85`
  - map tap did not collapse the sheet or regress state

## Current Blocker Observed On 2026-06-19

Preflight stopped before payment because backend runtime config is no longer
routing the test passenger to Woovi sandbox.

Evidence:

- Artifacts:
  `mobile-app/test-results/real-smoke-preflight-20260619T224225Z`
- Backend health: OK
- Java: OK
- Maestro: OK
- ADB/device: OK
- Android app: `1.0.3` / versionCode `119`
- Payment runtime canary: BLOCKED
  - `effectiveEnvironment=production`
  - `profileId=env-default`
  - `canarySandboxEnabled=false`
  - `activeProfileCount=0`

This blocks L1/L2 smoke. Do not open Pix until the test passenger has an active
short-lived sandbox payment runtime profile again.

## Non-Negotiable Gates

The run must stop as `blocked_precondition:*` when any gate below fails.

1. Toolchain gate
   - `ADB_BIN=/Users/izaakdias/Android/Sdk/platform-tools/adb`
   - Java available
   - Maestro available when YAML flows are used
   - Android device in `device` state

2. Session gate
   - Passenger app must be either idle or in a known active test ride state.
   - If a previous active ride exists, close it through the safest available
     product path first:
     - driver bot accepts and completes, or
     - passenger cancels from UI if still searching, or
     - backend/admin cleanup only if confirmed test user and test ride.
   - Do not start a fresh payment while an old active ride is present.

3. Region/geofence gate
   - Pickup and destination must pass `/api/geofence/check`.
   - Driver and passenger must be in the same region.
   - A geofence block after payment is a P0 product failure.

4. Driver availability gate
   - Driver must be online, eligible, close to pickup, and listening before
     payment is opened.
   - If the driver bot cannot prove readiness, stop with
     `blocked_precondition:driver_unavailable`.

5. Payment sandbox gate
   - Backend runtime config for the passenger must report sandbox payment mode.
   - Sandbox auto-confirm must be available before opening Pix.
   - If sandbox is not confirmed, stop with
     `blocked_precondition:payment_sandbox_not_confirmed`.

6. Fare/route gate
   - UI cannot show a local provisional fare as final fare.
   - Fare must remain stable from quote to payment to receipt/dashboard.
   - Synthetic route must not be used as final preview.
   - Polyline must not render a straight-line placeholder before real route.

## Execution Plan

### Phase 0 - Freeze Evidence Context

Run:

```bash
git status --short
npm --prefix mobile-app run qa:production-guards
node --check mobile-app/scripts/qa/android-real-device-smoke.cjs
```

Expected result:

- production guards pass;
- QA runner syntax passes;
- dirty tree is known and unrelated dirty files are not touched.

### Phase 1 - Preflight Environment

Run:

```bash
ADB_BIN=/Users/izaakdias/Android/Sdk/platform-tools/adb \
PREPARE_DRIVER=true \
USE_DEVICE_LOCATION_FOR_PICKUP=false \
PICKUP_LAT=-22.999357 \
PICKUP_LNG=-43.357071 \
DESTINATION_LAT=-22.9673111 \
DESTINATION_LNG=-43.1789541 \
bash mobile-app/scripts/qa/prepare-real-smoke-env.sh
```

Expected result:

- device metadata captured;
- app version captured;
- backend health OK;
- payment runtime canary confirms sandbox;
- pickup/destination pass geofence;
- generated artifacts include:
  - `smoke-env.sh`
  - `start-driver-bot.sh`
  - `run-android-smoke.sh`

If the payment runtime canary fails with `effectiveEnvironment=production`,
stop here and reactivate a short-lived sandbox profile for the test passenger
before opening payment.

Prepared command, only after explicit authorization for the backend runtime
mutation:

```bash
ADMIN_TOKEN="$(jq -r '.accessToken // .token // .adminAccessToken // .session.accessToken // .session.token // empty' ~/.leaf/dashboard-session.json)"
EXPIRES_AT="$(node -e "console.log(new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString())")"

curl -fsS -X POST "https://api.leaf.app.br/api/payment/runtime-profiles" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  -d "$(jq -n \
    --arg expiresAtIso "${EXPIRES_AT}" \
    '{
      profileId: "real-smoke-passenger-sandbox",
      name: "Real smoke passenger sandbox",
      provider: "woovi",
      environment: "sandbox",
      status: "active",
      scope: "canary",
      priority: 100,
      reason: "real_smoke_payment_runtime",
      userIds: ["3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2"],
      phones: ["21102938475", "5521102938475"],
      expiresAtIso: $expiresAtIso
    }')" | jq .
```

Then rerun:

```bash
PAYMENT_RUNTIME_USER_ID=3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2 \
PAYMENT_RUNTIME_PHONE=21102938475 \
PAYMENT_RUNTIME_EXPECTED_ENVIRONMENT=sandbox \
bash mobile-app/scripts/qa/assert-backend-payment-runtime-canary.sh \
  https://api.leaf.app.br \
  /tmp/leaf-payment-runtime-canary.json
```

If the device location must be used instead of canonical Rio coordinates, set:

```bash
USE_DEVICE_LOCATION_FOR_PICKUP=true
```

and stop if the resolved coordinates are outside the intended test region.

### Phase 2 - Clear Or Complete Existing Active Ride

If the passenger app opens in `passenger_searching_driver`:

1. Start the generated driver bot:

```bash
<preflight-artifacts>/start-driver-bot.sh
```

2. Let the bot accept, arrive, start, update location, and complete the ride.
3. Capture passenger screenshots at:
   - accepted / driver approaching;
   - started;
   - completed;
   - rating;
   - receipt.

If no offer reaches the bot within timeout:

- stop as `blocked_precondition:driver_unavailable`;
- do not open a new payment;
- keep artifacts.

If the user/test owner prefers cancellation instead of completion:

- cancel from passenger UI while still searching;
- capture XML/screenshot before and after;
- verify passenger returns to idle;
- verify no dangling active booking in backend evidence.

### Phase 3 - Fresh L2 Smoke From Idle

Only start this phase when passenger is idle.

Run driver bot first:

```bash
<preflight-artifacts>/start-driver-bot.sh
```

Then run the Android smoke:

```bash
STRICT_QUOTE=true \
REAL_SMOKE_OPEN_PAYMENT=true \
REAL_SMOKE_AUTO_CONFIRM_SANDBOX_PAYMENT=true \
REAL_SMOKE_COLLECT_DASHBOARD_EVIDENCE=true \
REAL_SMOKE_DESTINATION="Copacabana Palace" \
ADB_BIN=/Users/izaakdias/Android/Sdk/platform-tools/adb \
npm --prefix mobile-app run qa:android:real-smoke
```

Expected sequence:

1. passenger home;
2. destination search;
3. backend quote;
4. stable fare display;
5. Pix modal opens;
6. sandbox charge is auto-confirmed;
7. dispatch starts only after payment confirmation;
8. driver receives offer;
9. driver accepts;
10. driver approaching screen shows route, ETA, plate, color, model;
11. trip starts;
12. trip completes;
13. passenger rating is available and submit works;
14. receipt opens;
15. dashboard reconciliation matches gross, fees, and driver net.

### Phase 4 - Manual-Minimum Visual Probes

During active ride states, run ADB taps that previously caused regressions:

```bash
ADB_BIN=/Users/izaakdias/Android/Sdk/platform-tools/adb
"$ADB_BIN" shell input tap 500 640
"$ADB_BIN" exec-out screencap -p > <artifacts>/after-map-tap.png
"$ADB_BIN" shell uiautomator dump /sdcard/leaf-after-map-tap.xml
"$ADB_BIN" pull /sdcard/leaf-after-map-tap.xml <artifacts>/after-map-tap.xml
```

Required assertion:

- active ride sheet remains visible;
- no map-only state;
- no previous lifecycle screen;
- no fare mutation.

Repeat at:

- searching driver;
- driver accepted / approaching;
- trip started;
- trip completed before rating;
- receipt.

### Phase 5 - Reconciliation Gate

Use the dashboard evidence collector when a ride id is available:

```bash
RIDE_ID=<ride-id> \
EXPECTED_GROSS=<gross> \
ARTIFACTS_DIR=<artifacts> \
node mobile-app/scripts/qa/collect-ride-dashboard-evidence.cjs
```

Required assertion:

- quote gross equals payment gross;
- payment gross equals receipt gross;
- dashboard gross equals receipt gross;
- driver net matches approved fee policy;
- fees/tolls/pass-through values are explicit.

Any mismatch is P0.

## Intervention Matrix

No intervention expected:

- ADB launch/relaunch;
- OTA application by reopening app;
- backend health checks;
- payment runtime sandbox canary;
- geofence check;
- driver bot accept/start/complete;
- sandbox payment webhook;
- dashboard reconciliation collection;
- screenshots/XML capture.

Minimal human intervention:

- approve using cancellation if an old active ride cannot be completed by bot;
- confirm when a production/admin cleanup endpoint would be needed;
- provide/refresh admin token if dashboard/Woovi evidence collection cannot load
  `~/.leaf/dashboard-session.json` or `~/.leaf/dashboard-admin.env`.

Hard stop:

- production credential rotation;
- store console action;
- real payment mode detected;
- driver not available;
- geofence blocks test area before payment;
- backend cleanup would affect a non-test user or ambiguous ride.

## Acceptance Criteria

The project is P0-ready only when one run produces all evidence below:

- clean preflight;
- Android Play build plus OTA id recorded;
- passenger and driver in same region;
- sandbox payment confirmed by backend before Pix;
- one canonical fare across quote/payment/ride/receipt/dashboard;
- driver offer received and accepted;
- no state regression on map taps;
- no bottomsheet collapse to map-only during active ride;
- accepted/approaching screen has ETA, route to pickup, plate, color, and model;
- trip start and completion events occur in order;
- rating can be submitted;
- receipt opens and reconciles;
- logcat has zero critical React/runtime errors;
- final report generated under `mobile-app/test-results/`.

## Rollback

- For app behavior regressions: publish a rollback OTA on `production` runtime
  `1.0.3` or revert the mobile guard files and republish.
- For QA runner regressions: revert
  `mobile-app/scripts/qa/android-real-device-smoke.cjs`.
- For backend test state: use only approved test cleanup paths and preserve all
  evidence before cleanup.
