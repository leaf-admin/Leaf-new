# Ride smoke release - 2026-06-20

## Scope

- Passenger payment-to-booking guard after Pix confirmation.
- Real Android smoke with passenger, driver, sandbox payment, receipt, rating and dashboard reconciliation.
- Dashboard test role validation for financial evidence collection.
- Backend CRLV OCR vehicle data persistence endpoint.
- Mobile websocket-only runtime guard.

## Versioning

- Mobile runtime: `1.0.3`
- Expo update channel: `production`
- Expo update group: `31cb7f92-d712-40e7-976f-0836d84c9a55`
- Android update id: `019ee445-b6a8-7e1a-a9a8-c329a520dbfa`
- iOS update id: `019ee445-b6a8-7f4c-9aa7-0a544a3a67de`
- Expo update URL: `https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/updates/31cb7f92-d712-40e7-976f-0836d84c9a55`

## Backend deployment

- Deployment target: Contabo production container rollout.
- Backup path: `/opt/leaf-app/backups/modular-rollout-20260620-053731`
- Live route check: `POST https://api.leaf.app.br/api/vehicles/ocr-data` returned `401` without token, confirming the route is deployed and authenticated.

## Smoke evidence

- Real smoke artifacts: `mobile-app/test-results/android_real_smoke_20260620_090601`
- Booking id: `booking_1781946518336_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`
- Passenger gross amount: `83.60`
- Leaf/payment fees: `3.18`
- Driver net amount: `80.42`
- Dashboard evidence: `mobile-app/test-results/android_real_smoke_20260620_090601/dashboard-final-canonical/dashboard-evidence.md`

## Acceptance evidence

- Pix sandbox confirmed before dispatch.
- Driver accepted, arrived, started and completed the ride through the controlled driver bot.
- Passenger receipt showed the same gross amount as quote/payment/dashboard.
- Driver net and retained fees matched dashboard reconciliation.
- Passenger rating was submitted and persisted.
- Passenger returned to the clean map state after rating.
- Socket.IO polling probe returned `400`, expected because mobile runtime is websocket-only.

## Rollback

- Backend: restore Contabo backup `/opt/leaf-app/backups/modular-rollout-20260620-053731`.
- Mobile OTA: republish the previous production update group `980adb0e-9ed7-4ef1-a18b-69cbafca7f36` or revert this PR and publish a new OTA for runtime `1.0.3`.
- Dashboard test role: downgrade `codex-dashboard-smoke@leaf.app.br` from manager and remove financial access if the role should be retired.

## Known non-blockers

- One orphan sandbox payment holding remains from the earlier failed smoke and should be cleaned only as explicit test-data maintenance.
- KYC AWS warnings remain expected in config validation until the KYC provider rollout is completed.
