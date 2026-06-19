# Stuck Driver Search Root Cause - 2026-06-19

## Objective

Explain and prevent the passenger app from remaining indefinitely in driver search after the canonical search window ends.

## Production Evidence

- Booking: `booking_1781793127195_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`
- Gross fare: `R$ 87,85`
- Created at: `2026-06-18T14:32:07.711Z`
- Backend no-driver decision: `2026-06-18T14:35:08.084Z`
- Backend reason: `NO_ELIGIBLE_DRIVERS_IN_REGION`
- Passenger UI still showed `Buscando motorista` and `03:00` on 2026-06-19.
- Canonical cancellation was persisted at `2026-06-19T22:53:28.553Z`.
- Firestore payment status became `REFUNDED`, amount `8785` cents, immediately after canonical cancellation.
- After a cold launch, the passenger app returned to the idle home state with no active ride.
- The passenger active-booking index is now empty for the affected test user.

## Root Cause

1. The mobile search clock stopped and capped at 180 seconds without triggering reconciliation.
2. Passenger hydration intentionally preserved a local search when `activeRideSync` returned idle, with no deadline guard. A missed `noDriversFound` event therefore became an indefinite stale state.
3. Backend search finalization depended on process-local timers. A reconnect did not reconcile an already expired persisted search.
4. The legacy `cancelDriverSearch` handler returned success without changing booking state, clearing the active index, or reconciling payment.
5. The search screen fired cancellation without awaiting the backend ACK and navigated immediately. The runtime could also clear local state after a failed backend cancellation, creating divergence and a blank surface.

## Implemented Guard Rails

- Every passenger `syncActiveRide` now checks the persisted search deadline before returning the snapshot.
- Expired searches are finalized from Redis state, including after a backend process restart.
- A driver already assigned to the booking blocks timeout finalization.
- The mobile timer exposes a reconciliation state at the deadline instead of silently freezing.
- An idle authoritative sync can no longer preserve a passenger search after 180 seconds.
- Search cancellation waits for canonical `cancelRide` confirmation before navigation.
- Failed cancellation keeps the search visible and exposes the support route.
- Legacy `cancelDriverSearch` now fails explicitly instead of acknowledging a fake cancellation.
- The Android real-device smoke now blocks when it starts with an existing active ride instead of reporting a false pass or attempting to force dispatch.

## Validation

- Mobile focused: 37 tests passed.
- Backend focused: 14 tests passed.
- Backend full unit suite: 147 suites and 681 tests passed; Jest retained pre-existing async handles after the summary and required manual termination.
- Mobile full unit suite completed without test failures.
- Mobile production guards: passed.
- Backend runtime config validation: passed with the existing KYC strict-production warning.
- Governance, tracked-secret scan, hardcoded-secret guard, syntax checks, and `git diff --check`: passed.

## Remaining P0 Risk

The evidence proves that the payment was refunded by the later canonical cancellation. It does not prove that the original `noDriversFound` path automatically refunded the paid booking. That path must be validated explicitly in sandbox before production acceptance.

## Release Gate

Do not start another ride smoke until:

1. The backend changes are deployed and health-checked.
2. The mobile JavaScript changes are published by OTA and confirmed on the Play internal-test build.
3. Redis has no active booking for the passenger test user.
4. A real test driver is online, dispatch-eligible, and inside the same test region before the passenger requests the ride.
5. The no-driver timeout scenario is tested separately from the successful full-ride scenario.

## Rollback

- Backend: revert the active-ride reconciliation call and `reconcileExpiredSearchForCustomer` implementation.
- Mobile: revert the passenger search lifecycle guard and ACK-gated cancellation UI.
- No data migration is required.
