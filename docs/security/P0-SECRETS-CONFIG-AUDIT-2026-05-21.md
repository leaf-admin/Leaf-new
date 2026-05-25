# P0 Secrets and Production Config Audit - 2026-05-21

Objective: prevent accidental promotion of secrets, local production env files, Android signing material, and unsafe production fallbacks.

## What Was Checked

- Android signing artifacts and Firebase mobile configs by path: `.keystore`, `.jks`, `google-services.json`, `GoogleService-Info.plist`.
- Runtime env files by path: `.env`, `.env.production`, `.env.local`, `.env.production.local`, backup envs, and temporary envs.
- Backend production guardrails for CORS, JWT, Redis, Woovi webhook signature, and payment bypass flags.
- Existing scanner: `.github/workflows/secret-guard.yml` already ran `leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`.

## Guardrail Added

Run:

```sh
npm run security:scan
```

The scanner lives at `scripts/maintenance/security/scan-secrets.cjs`. It fails on critical sensitive artifacts by default, reports high/medium config warnings, and prints only path, line, rule id, and remediation hint. It does not print secret values.

The existing GitHub Actions secret guard now runs both the legacy backend guard and the workspace scanner.

For a blocking pass on historical high/medium config warnings too, run:

```sh
npm run security:scan -- --strict-content
```

For CI-like validation against Git-tracked files only:

```sh
npm run security:scan -- --tracked-only
```

## Current Findings From Local Workspace

The local worktree contains ignored sensitive files that must not be committed or copied into CI artifacts:

- `mobile-app/.env`, `.env.local`, `.env.production`, `.env.production.local`
- `mobile-app/leaf-production-release.keystore`, `mobile-app/leaf-release-key.keystore`, `mobile-app/@freedom-tech-organization__leaf.jks`
- `mobile-app/google-services.json`, `mobile-app/android/app/google-services.json`, `mobile-app/GoogleService-Info.plist`, `mobile-app/ios/Leaf/GoogleService-Info.plist`
- `mobile-app/config/leaf-reactnative-firebase-adminsdk-*.json`
- `config/firebase/GoogleService-Info.plist`
- `leaf-dashboard-js/.env.local`, `web-app/.env`
- `leaf-websocket-backend/.env`, `.env.production`, `.env.production.sandbox`, `.env.backup.*`
- `leaf-websocket-backend/firebase-credentials.json`, `leaf-websocket-backend/leaf-reactnative-firebase-adminsdk-*.json`

Operational action: keep these files out of Git, move operational secrets to the deployment secret manager, and rotate any value that may have been shared outside the intended operator machine.

## Production Config Notes

- CORS: backend has a whitelist implementation in `leaf-websocket-backend/utils/runtime-cors-config.js`; production compose requires `CORS_ORIGIN`. Local compose examples still contain wildcard CORS and dev JWT defaults and must stay non-production only.
- JWT: canonical backend routes use `leaf-websocket-backend/utils/jwt-secret-resolver.js`; production compose requires `JWT_SECRET`. Any fallback in maintenance or local-only servers should remain outside production paths.
- Redis: production Hostinger compose requires `REDIS_PASSWORD`; older local/simple docker compose files still use unauthenticated Redis URLs and should not be used for production.
- Woovi webhook: `leaf-websocket-backend/routes/woovi.js` supports authorization token, public-key signature, HMAC signature, idempotency, and amount validation. Production must set `WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true`, `WOOVI_WEBHOOK_ALLOW_UNSIGNED=false`, and at least one verifier secret/public key.
- Payment bypass: production must keep `PAYMENT_BYPASS_ON_WOOVI_FAILURE=false`, `PAYMENT_FORCE_BYPASS=false`, legacy `FORCE_PAYMENT_BYPASS=false`, and public build flags such as `EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=false`.

## Non-Destructive Operations Only

No history rewrite was attempted. If any secret was already committed or distributed, schedule external rotation and use a dedicated, reviewed history rewrite procedure outside this audit.
