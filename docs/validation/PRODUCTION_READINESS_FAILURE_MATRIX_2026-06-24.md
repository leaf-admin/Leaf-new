# Production Readiness Failure Matrix - 2026-06-24

## Purpose

This matrix is the decision layer before any new real-device smoke. Its job is
to stop the team from using one large L2 ride smoke as the main diagnostic tool.

The smoke is a final evidence gate. It is not the place to discover basic
tooling, backend config, payment sandbox, driver availability, location-provider,
or selector drift.

Canonical references:

- `docs/validation/PRODUCTION_READINESS_GOAL_LEDGER_2026-06-24.md`
- `docs/validation/CANONICAL_SMOKE_TEST_DIRECTIVES.md`
- `docs/QA_RIDE_STATE_GUARDRAILS.md`

## Classification Matrix

| Domain | Meaning | Current examples | Status | Required action |
| --- | --- | --- | --- | --- |
| Product | A real passenger, driver, or operator would see broken behavior in app, backend, or dashboard. | Ride state regression after map tap; active ride sheet collapsing to map-only; quote value visibly changing after being shown as final; straight-line route rendered as a valid route; payment UI opening without a valid canonical quote. | Locally guarded in several areas, but real-device proof is still required for the full ride cycle. | Fix product code only when evidence includes screen/XML/log/backend event for the same ride id. |
| Business rule | A canonical Leaf policy is violated. | Pix before eligible driver; Pix before geofence is known; passenger gross differs across quote, Pix, receipt, and dashboard; driver active without required KYC/CNH/CRLV/liveness/face compare; driver balance exceeds ledger-backed net balance. | Policy is defined and several guards are implemented locally. Full same-ride evidence is still pending. | Backend must enforce. Mobile may present/guard, but frontend-only validation is not enough. |
| Test harness | Automation, selectors, waits, parser, or test assumptions do not match the current product surface. | Old Maestro flow cannot read a new screen; dashboard collector lacks auth; smoke expected pickup source was not certified; runner classifies a visible device advance as failure because screen classifier is stale. | Actively being hardened. The runner now emits `failureClassification`. | Fix scripts/selectors/reporting. Do not change product code to satisfy stale automation. |
| Execution environment | Device, simulator, provider sandbox, backend deploy, or local tooling is not ready. | ADB/device unavailable; Java/Maestro missing; Play build/OTA mismatch; Android `gps`/`network` coordinates diverge from `fused mock`; backend health unavailable; payment sandbox profile absent; driver runtime not installed or version-matched. | Current hard blocker: Android `gps/network` are in Pastorinhas while `fused mock` is in another point, about 11.6 km away. | Stop before smoke. Align the environment or change the test pickup to the actual certified device location. |

## Current State

| Area | Current classification | What is known | What is not proven yet |
| --- | --- | --- | --- |
| Android pickup location | Execution environment | App is reading Android real providers. Current device `gps/network` point to Pastorinhas; previous preflight used `fused mock` as expected pickup. | A valid smoke pickup where `gps`, `network`, and `fused` agree, or a conscious decision to use the real `gps/network` location as canonical pickup. |
| No-driver before Pix | Business rule | The rule is canonical: no eligible driver means no Pix. Runner and backend guards exist locally. | Real L2 evidence with an eligible driver before payment, plus separate no-driver negative proof. |
| Geofence before Pix | Business rule | Geofence must block before payment. A post-payment geofence block is product/business failure. | Real L2 preflight evidence for pickup and destination in the test area before Pix. |
| Sandbox payment | Execution environment / test harness | Sandbox must be backend/user-profile controlled, not app-build controlled. Manual dashboard payment can validate flow, but auto-confirm is better for repeatability. | Fully automated Woovi sandbox confirmation for the canary user in the same L2 run. |
| Fare consistency | Business rule / product | Passenger gross is canonical for passenger surfaces. Driver net, Leaf fee, Woovi fee, tolls, and pass-throughs are separate fields. | Same ride id proving quote gross = Pix gross = receipt gross = dashboard passenger gross, and driver net/fees from backend-final snapshot. |
| Ride lifecycle state | Product | State must be monotonic. Active ride cannot regress via map tap, back, backdrop, or bottomsheet collapse. Exit is completion or allowed cancel/safety flow. | Real device proof across accepted, arriving, arrived, started, completed, rating, receipt, post-rating map, relaunch. |
| Route and traffic rendering | Product | One route only. No straight-line placeholder can appear as a valid route. Traffic coloring should reflect backend/provider traffic data when available. | L0 route proof with known route traffic ratio before full L2; screenshot/video that first visible route is the provider/backend route. |
| Dashboard observation | Test harness / product | Dashboard must observe the same ride id and the same financial snapshot. | Authenticated dashboard evidence in the same L2 run. If auth/tooling blocks, classify as harness/precondition, not product. |
| Driver app evidence | Product / execution environment | Backend bot can support dispatch evidence, but is not full driver-app UI evidence. | Driver app runtime on simulator/emulator/device with same app version and visible offer/accept/arrive/start/complete screens. |

## Decision Rules

1. If the issue can be proven without a real ride, use the smallest local gate.
2. If the preflight fails, classify as `blocked_precondition:*` and stop.
3. If the device visibly advances but the automation cannot classify it, record
   screenshot/XML/logs as `automation_inconclusive`; do not call it product
   failure yet.
4. If the failure happens before Pix and is driver/geofence/sandbox/device
   related, do not open payment and do not start a driver bot to push through.
5. If money moves, all fare claims must use the same ride/payment id.
6. If state regression is suspected, the evidence must include current screen,
   route name, booking id, latest backend event, and gesture that caused it.
7. Do not change business rules during QA unless explicitly approved.
8. Do not touch product code to satisfy old scripts unless current UI/product
   evidence proves the app is wrong.

## Execution Ladder

Run from smallest to largest. Stop at the first failed or blocked step.

| Level | Goal | Required proof | If blocked |
| --- | --- | --- | --- |
| L-1 Local gates | Prove code/config baseline before device work. | `git diff --check`, governance, secret scan, backend config, mobile guards, backend/dashboard focused tests as relevant. | Fix code/config locally. No device smoke. |
| L0 Quote and route | Prove destination entry, stable quote, one canonical route, and no duplicate quote churn. | Screenshot/XML, quote id, route source, backend quote count, route traffic metadata when available. | Product if app shows wrong value/route; harness if selector/read failed; environment if location/geofence unavailable. |
| L1 Payment | Prove Pix sandbox creation and confirmation after driver/geofence availability. | Sandbox profile canary, charge id, payment status, no Pix before preconditions. | Business rule if Pix opens too early; environment if sandbox unavailable; harness if auto-confirm script cannot operate but manual proof works. |
| L2 Ride lifecycle | Prove passenger plus driver full ride cycle. | Same ride id through payment, dispatch, driver offer, accept, arrival, start, complete, rating, receipt, dashboard, backend events. | Product only with same-ride evidence. Otherwise classify narrower domain. |

## Mandatory Preflight Before Next L2

The next L2 cannot start until all items below are true:

- Android physical device is connected and app version/runtime are recorded.
- Passenger and driver runtimes are distinct.
- If Android physical device is passenger, Android `gps`, `network`, and `fused`
  providers must converge within tolerance, or the test must explicitly use the
  real `gps/network` location as pickup.
- Driver is online, eligible, close to the same pickup, and in the same region.
- Pickup and destination geofence pass before payment.
- Passenger payment runtime is sandbox by backend/user profile.
- Dashboard auth and collector are ready before the ride.
- Quote route can be captured in L0 before Pix.

## Current Recommendation

Do not run another full L2 smoke until the Android location source is made
canonical.

Choose exactly one pickup strategy before the next attempt:

| Strategy | Use when | Tradeoff |
| --- | --- | --- |
| Real GPS pickup | We accept the phone's actual `gps/network` location as the test pickup. | Fastest. Destination and driver must be moved to that region. |
| Controlled mock pickup | We need a specific pickup such as Carioca Shopping. | Requires all Android providers to agree, not only `fused mock`; may need mock-location app/device setup. |
| Simulator-controlled pickup | We need deterministic coordinates and repeatability. | Better for automation; less representative than physical passenger GPS. For this project, use iOS simulator when Android physical remains passenger. |

Until one strategy is chosen and preflight passes, a blocked L2 is not evidence
of product regression.

## Do Not Do

- Do not keep rerunning the full smoke against a failing preflight.
- Do not seed later lifecycle states after a blocked payment/search state.
- Do not treat missing driver as a smoke failure; it is a precondition unless
  Pix was already opened.
- Do not compare passenger gross against driver net.
- Do not call a dashboard collector failure a product bug unless the dashboard
  UI itself shows wrong same-ride data.
- Do not publish OTA or deploy backend for QA-only script/document changes.

## Next Concrete Step

Before the next smoke, run only the preflight and decide the pickup strategy
from its provider report. A full L2 run should be authorized only after the
preflight is green and the expected pickup is certified.
