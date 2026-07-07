# Block 3 - Live Activities And Push Validation

Date: 2026-07-07
Branch: `codex/p0-p1-no-regression-hardening`

## Objective

Validate and harden the local contract for ride Live Activities and push diagnostics before device/provider E2E.

## Scope Completed

- Aligned runtime config validation with the real push provider model:
  - Firebase Admin credentials now count as `push.fcmConfigured=true`.
  - Legacy `FCM_SERVER_KEY` remains supported as `legacy-fcm-server-key`.
- Added redacted Live Activity APNs diagnostics to `config:validate`.
- Added backend unit coverage for:
  - Live Activity token persistence in Redis.
  - APNs content payloads for update/end events.
  - Safe skip when no token exists.
  - Safe skip when APNs credentials are absent.
  - APNs update dispatch when credentials and matching token exist.
- Added mobile unit coverage for:
  - iOS/feature-flag availability gate.
  - Native `startOrUpdate` payload and APNs push token registration.
  - Terminal ride status ending the native activity.

## Evidence

- `npm --prefix leaf-websocket-backend run config:validate`
  - PASS
  - `push.fcmConfigured=true`
  - `push.provider=firebase-admin`
  - `push.liveActivity.apnsConfigured=false` in the main `.env/.env.production` runtime.
- `ENV_FILE=.env.live-activity.local NODE_ENV=production RUNTIME_ROLE=sideeffects node scripts/deploy/validate-runtime-config.js`
  - PASS
  - `push.liveActivity.apnsConfigured=true`
  - This file is local validation evidence only; it is not the main production runtime env.
- `npx jest --config config/jest.unit.config.js tests/unit/bootstrap/register-socket-fcm-handlers.unit.test.js tests/unit/services/fcm-service.unit.test.js tests/unit/services/ride-live-activity-service.unit.test.js tests/unit/scripts/validate-runtime-config.unit.test.js --runInBand`
  - PASS: 4 suites, 43 tests.
- `npx jest --config jest.config.js __tests__/websocket-manager-fcm-actions.test.js __tests__/fcm-notification-service.test.js __tests__/ride-live-activity-service.test.js --runInBand`
  - PASS: 3 suites, 32 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand`
  - PASS: 198 suites, 1020 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand`
  - PASS: 101 suites, 826 tests.
  - Residual warning: Jest reported an existing open-handle warning after completion.
- `npm run governance:check`
  - PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
  - PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`
  - PASS.
- `npm --prefix mobile-app run qa:production-guards`
  - PASS.

## Open Items

- APNs is still not configured in the main backend runtime loaded by `.env/.env.production`.
- Real device Live Activity smoke must still be rerun after production APNs env is wired into the backend runtime.
- No Apple/Firebase console change, deploy, key rotation, or provider-side mutation was performed in this block.

## Risks

- Until `LEAF_APNS_KEY_ID`, `LEAF_APNS_TEAM_ID`, `LEAF_APNS_PRIVATE_KEY_PATH` or `LEAF_APNS_PRIVATE_KEY`, `LEAF_APNS_BUNDLE_ID`, and `LEAF_APNS_ENV=production` are loaded by the running backend, Live Activity server pushes will skip safely with `APNS_NOT_CONFIGURED`.
- Local tests prove payload/registration behavior, not successful delivery through Apple APNs on a physical device.

## Rollback

- Revert the validator/test commits from this block.
- Runtime behavior before this block already skipped APNs updates when credentials were absent; no production data migration is involved.
