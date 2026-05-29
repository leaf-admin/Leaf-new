# Dispatch hardening + benchmark (issue-by-issue)

Date: 2026-03-22
Environment: VPS real (`https://api.147.182.204.181.sslip.io`)
Test script: `leaf-websocket-backend/scripts/stress-test/sustained-active-rides-capacity.cjs`

## Scope executed

1. Remove legacy global fan-out on ride lifecycle events and target only ride parties.
2. Optimize `saveDriverLocation` / `updateLocation` hot path with fewer Redis round-trips.
3. Reduce N+1 transient lookups in dispatch scoring via Redis pipeline prefetch.
4. Fix idempotency metrics label cardinality (stable operation labels).
5. Run repeated post-patch benchmark with same baseline window and pool.

## Core code touchpoints

- `leaf-websocket-backend/server.vps.js`
  - booking party cache + resolver
  - targeted emits for `rideAccepted` and `tripLocationUpdated`
  - pipelined `saveDriverLocation` and preloaded driver-state reuse
- `leaf-websocket-backend/services/driver-notification-dispatcher.js`
  - `prefetchDriverTransientState()` batch read
  - dispatchability guard before/while notification
- `leaf-websocket-backend/services/idempotency-service.js`
  - `extractOperationFromKey()` + normalized operation labels
- `leaf-websocket-backend/utils/prometheus-metrics.js`
  - `sanitizeLabelValue()` for safe metric label cardinality

## Baseline

File: `reports/sustained-active-rides-1774170924050.json`

- sustainedActiveRidesEstimated: 59.68
- completionRate: 100%
- p95 createBooking: 548ms
- p95 confirmPayment: 470ms
- p95 bookingToDispatch: 368ms
- p95 acceptRide: 698ms
- p95 startTrip: 390ms
- p95 completeTrip: 465ms
- p95 fullFlowToStart: 1336ms

## Post-patch runs (same pool/windows)

Command profile:
- drivers: 240
- passengers: 320
- windows: `warmup:60:28:120:210,base:120:44:120:210,peak:180:60:120:210,cooldown:60:28:120:210`

Run files:
- `reports/sustained-active-rides-postpatch-1774205788.json`
- `reports/sustained-active-rides-postpatch-run1-1774206432.json`
- `reports/sustained-active-rides-postpatch-run2-1774206910.json`
- `reports/sustained-active-rides-postpatch-run3-1774207388.json`

### Run summary

- run A (`1774205788`)
  - sustained: 59.49
  - completion: 100%
  - topErrors: none
- run B (`run1-1774206432`)
  - sustained: 46.35
  - completion: 100%
  - topErrors: `create_booking:15` (`Timeout ao criar booking`)
- run C (`run2-1774206910`)
  - sustained: 43.99
  - completion: 100%
  - topErrors: `create_booking:14` (`Timeout ao criar booking`)
- run D (`run3-1774207388`)
  - sustained: 59.49
  - completion: 100%
  - topErrors: `driver_connect_or_auth_failed:1`, `passenger_connect_or_auth_failed:1`

## Comparative view

Average over 4 post-patch runs vs baseline:
- sustained capacity: 52.33 (vs 59.68, -12.32%)
- p95 createBooking: 462.75ms (vs 548ms, improved)
- p95 confirmPayment: 480.25ms (vs 470ms, slightly worse)
- p95 bookingToDispatch: 613ms (vs 368ms, worsened by outliers)
- p95 acceptRide: 652.25ms (vs 698ms, improved)
- p95 startTrip: 306.25ms (vs 390ms, improved)
- p95 completeTrip: 383ms (vs 465ms, improved)
- p95 fullFlowToStart: 1441.5ms (vs 1336ms, worsened by outliers)

Median over 4 post-patch runs vs baseline:
- sustained capacity: 52.92 (vs 59.68, -11.33%)
- p95 fullFlowToStart: 1280ms (vs 1336ms, improved)

## Interpretation

- Functional correctness stayed stable in all runs (100% completion and no no-driver capacity misses).
- Two runs were degraded by `create_booking` timeouts during peak, which pulled sustained estimate down.
- Two runs reached near-baseline sustained capacity (`59.49`), indicating no deterministic hard regression, but clear runtime instability under peak.

## Operational note

During test bootstrap, helper stack logs repeated local Redis pool reconnect warnings (`localhost:6380`).
Those warnings come from local helper initialization and do not change the tested backend URL, but they add noise and should be isolated from performance harness output.

## Next optimization focus

1. Stabilize `createBooking` peak latency path (investigate queueing/lock contention during peak window).
2. Add explicit booking creation timeout telemetry buckets (server-side) to correlate with benchmark outliers.
3. Isolate local helper Redis init from stress runner process to remove local-noise side effects.

## Post-fix run (createBooking critical path reduction)

Applied in `server.vps.js`:
- moved superseded lock release/cleanup out of createBooking critical path (background).
- pipelined backpressure counters (`zcard` + `scard`) in createBooking.
- pipelined driver state checks in `hasEligibleDriversForPickupFast` (remove Redis N+1).

Runs:
- `reports/sustained-active-rides-postfix-run1-1774213694.json`
- `reports/sustained-active-rides-postfix-run2-1774214173.json`

Results:
- run1 sustained: `59.52`, topErrors: none
- run2 sustained: `59.49`, topErrors: `passenger_connect_or_auth_failed:2`

Compared to previous post-patch average (`52.33`):
- sustained capacity: `59.505` (**+13.71%**)
- p95 createBooking: `424.5ms` (**-8.27%**)
- p95 bookingToDispatch: `390ms` (**-36.38%** vs previous unstable average)
- p95 fullFlowToStart: `1268.5ms` (**-12.00%**)

Compared to baseline (`59.68` sustained):
- sustained capacity is now effectively restored (`59.505`, delta `-0.175`).
