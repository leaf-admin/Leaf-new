# Controlled pilot operations runbook

## Operating rule

Never mutate financial policy, KYC policy, geofence, or production credentials from an incident response without the authorized owner. Never stop an active ride to pause intake. All commands must be linked to a trace ID and incident record.

## Pause new activity

Use the runtime configuration mechanism to set:

```text
LEAF_ACCEPT_NEW_PIX=false
LEAF_ACCEPT_NEW_BOOKINGS=false
```

Restart/roll the gateways using the approved deployment mechanism, then verify:

- `/api/app/runtime-config` reports both switches as `false`;
- a new Pix attempt returns `NEW_PIX_PAUSED`;
- a new booking returns `NEW_BOOKINGS_PAUSED`;
- accepted/started rides continue to receive lifecycle events.

Resume in this order: first bookings, then Pix, after readiness and reconciliation are green. If payment creation is paused while bookings remain enabled, the app must still be unable to start a ride without confirmed payment.

## Block an operating region

Disable the polygon through the authenticated geofence admin surface. In production/pilot this returns `GEOFENCE_DISABLED` and blocks quote/payment/booking; it never permits the entire map. Verify `/api/geofence/check` returns HTTP 503 with `isAllowed=false`.

Do not delete the approved polygon during an incident. Preserve its version and last editor for rollback.

## Backend rollback

1. Pause new Pix and bookings.
2. Record active booking IDs and their states.
3. Use the immutable backend reference from the RC manifest.
4. Roll gateways one at a time; do not destroy Redis or named volumes.
5. Verify `/health/readiness`, Socket.IO Redis adapter, workers, webhook ingestion, and active rides.
6. Resume only after financial reconciliation confirms no orphan payment or booking.

## Dashboard rollback

Restore the dashboard reference from the RC manifest. Dashboard failure must not mutate or pause lifecycle state. Validate login, booking/payment lookup, live ride view, and reconciliation before handing control back to operations.

## OTA rollback

Publish or repoint to the Android/iOS OTA groups recorded under `rollback` in the RC manifest. Confirm runtime compatibility before publication. OTA rollback must not downgrade native code across an incompatible runtime version.

## Pix/provider incident

1. Set `LEAF_ACCEPT_NEW_PIX=false`.
2. Keep active rides running.
3. Identify payment intents by trace/payment/charge ID; never by raw PII in logs.
4. Compare Woovi, payment intent, booking, receipt, ledger, and refund states.
5. Replay only idempotent webhook or reconciliation commands.
6. Do not manually mark payment as confirmed.
7. Resume after the provider, webhook lag, and ledger alerts are healthy.

## Refund incident

Pause new Pix if the divergence is systemic. Record gross amount, approved fees, pass-throughs, driver net, charge, refund, ledger entries, provider status, and operator. Never create a new take-rate or compensating financial rule during response.

## KYC/provider incident

KYC remains fail-closed for entering the driver pool. Existing active rides continue. Drivers already in an active ride must not be forced into liveness or document revalidation. Escalate provider outage and resume onboarding/online admission only after trusted liveness and face comparison are healthy.

## Driver without communication

Use the booking trace and last confirmed socket/location event. Contact the driver and passenger through approved channels, preserve evidence, and follow the safety incident procedure. Do not synthesize location or advance lifecycle state merely to clear the dashboard.

## Incident closure evidence

Every incident record must include:

- severity and timeline;
- owner and acknowledgment time;
- trace, booking, payment, charge and refund IDs where relevant;
- before/after readiness and alert state;
- reconciliation result;
- rollback or recovery reference;
- remaining P0/P1 actions and sign-off.
