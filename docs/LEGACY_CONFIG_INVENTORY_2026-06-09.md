# Legacy Config Inventory — 2026-06-09

Refs #8 (Slice 1 of LEA-8).
Objective: precise inventory of hardcoded/ambiguous legacy config references.

Update 2026-06-13: the provider-name compatibility layer described in the
original inventory was removed. The backend now uses
`docker-compose.production.yml` plus `docker-compose.gateway-scale.yml`, and
`scripts/deploy-contabo-docker.sh` performs a modular rolling deployment.

---

## Active/Live

These are production-critical references. Do not change without explicit approval and a separate runtime task.

| # | File | Line(s) | Pattern / Evidence | Risk if touched | Recommended next action |
|---|------|---------|--------------------|-----------------|------------------------|
| 1 | `leaf-websocket-backend/server.vps.js` | entire file (13051 lines) | Current production backend runtime. Referenced in deploy scripts, healthcheck, and multiple docs as the live VPS runtime | Any change risks production backend availability | Preserve as-is. Track in LEA-8 slice for modular migration. Already documented in `DEVKIT_TECNICO_LEAF` and `CLEANUP_TRACKER` |
| 2 | `leaf-websocket-backend/docker-compose.production.yml` | entire file | Canonical production compose. Combined with `docker-compose.gateway-scale.yml` during deploy | Breaking this breaks deployments | Keep as the single production base |
| 3 | `leaf-websocket-backend/scripts/deploy-contabo-docker.sh` | entire file | Canonical modular deploy script with backup, rolling gateway replacement and health checks | Breaking this breaks all deploys | Keep guarded by `CONFIRM_PRODUCTION_DEPLOY=true` |
| 4 | `mobile-app/src/services/WooviService.js` | entire file (252 lines) | Active payment service routing through Leaf backend (`/api/payment/advance`). Already guarded by `payment-no-direct-woovi-guard.test.js` | Low — already sanitized in LEA-7 | Already clean. Document as reference |
| 5 | `scripts/healthcheck-vps.sh` | entire file | Active VPS health check script | Breaking this breaks monitoring | Keep as-is. Consider renaming to `healthcheck-backend.sh` if VPS infra is generalized |
| 6 | `config/firebase/.firebaserc` | entire file | Active Firebase project config | Breaking this breaks Firebase CLI operations | Keep as-is |

### Resolved in follow-up

| File | Previous evidence | Resolution |
|---|---|---|
| `.github/workflows/eas-build.yml` | `CORS_ORIGIN: https://api.62.169.31.231.sslip.io` | Updated release gate validation to use `https://api.leaf.app.br`, matching the current public API domain. |

---

## Legacy-live

These are in use but are known legacy patterns or deprecation wrappers. They should be encapsulated or replaced, but they currently serve a real (if vestigial) purpose.

| # | File | Line(s) | Pattern / Evidence | Risk if touched | Recommended next action |
|---|------|---------|--------------------|-----------------|------------------------|
| 1 | `mobile-app/config/WooviConfig.js` | entire file (38 lines) | Hardcoded `baseUrl: 'https://api.woovi.com/api/v1'`, empty `apiKey: ''`, empty `appId: ''`, sandbox CNPJ `12345678000199` for beneficiary | Low — file is not imported by active payment path (guarded by test) | Add JSDoc `@deprecated` header and inline comment pointing to Leaf backend `/api/payment/advance` as the canonical path |
| 2 | `mobile-app/src/services/WooviDriverService.js` | entire file (238 lines) | Direct Woovi axios client using `WooviConfig.baseUrl`, `WooviConfig.apiKey`, `WooviConfig.appId`. Constructs direct Woovi API calls | Low — file is not imported by active payment path | Add JSDoc `@deprecated` header referencing the canonical backend-routed path |
| 3 | `mobile-app/src/hooks/useWooviDriver.js` | entire file (140 lines) | Consumes `WooviDriverService`. Provides driver Woovi client CRUD operations | Low — not in active payment flow | Add JSDoc `@deprecated` header |
| 4 | `mobile-app/config/FCMConfig.js` | 4 | `SERVICE_ACCOUNT_PATH: './config/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json'` — hardcoded path to a service account JSON file | Medium — path references a real credentials file that may or may not exist | Move to env-based config. Check if the referenced file actually exists before removing |
| 5 | `scripts/deploy-contabo-completo.sh` | entire file | Root-level convenience wrapper for Contabo deploys | Low | Keep as the supported repository entrypoint |

---

## Deprecated candidate

These are test-only or dev-only files that look production-like. They contain hardcoded placeholder credentials (`YOUR_PRIVATE_KEY`, `YOUR_CLIENT_EMAIL`) and hardcoded `databaseURL`. They pose no runtime risk but create noise for secret scanners.

| # | File | Line(s) | Pattern / Evidence | Risk if touched | Recommended next action |
|---|------|---------|--------------------|-----------------|------------------------|
| 1 | `mobile-app/test-firebase-auth.js` | 1, 4–15, 18–21 | `require('firebase-admin')`, hardcoded service account block with `YOUR_*` placeholders, `databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com"` | None — placeholders only, never executed in production | Add `@deprecated` comment header. Move to `mobile-app/scripts/legacy/` or `mobile-app/__tests__/legacy/` after confirming no active references |
| 2 | `mobile-app/get-real-fcm-tokens.js` | 9, 12–21, 25–28 | `require('firebase-admin')`, hardcoded `databaseURL: 'https://leaf-reactnative-default-rtdb.firebaseio.com'`, placeholder credentials with `firebase-adminsdk-xxxxx@leaf-reactnative.iam.gserviceaccount.com` | None — placeholders, but file name is dangerously close to a production script | Add header documenting test-only purpose. Consider archiving |
| 3 | `mobile-app/test-fcm.js` | 10, 13–23, 28–31 | `require('firebase-admin')`, hardcoded `projectId: 'leaf-reactnative'`, placeholder credentials (`YOUR_PRIVATE_KEY`, `YOUR_CLIENT_ID`), `firebase-adminsdk-xxxxx` style email | None — placeholders only | Add `@deprecated` or `@test-only` header |
| 4 | `mobile-app/test-whatsapp-otp.js` | 113, 149, 312, 343 | Contains `firebasePlan: 'blaze'` and `firebasePlan: 'spark'` references in mock classes. Entire file is mock/test only | None — purely mock | Consider marking `@test-only` at top of file |
| 5 | `mobile-app/routes/wooviWebhook.js` | entire file (12 lines) | Legacy Express webhook route inside `mobile-app/` (not backend). Requires Express and exposes `/woovi-webhook` POST endpoint | Low — not wired into any active app runtime | Add `@deprecated` header. Could be removed after confirming no production Express server in mobile-app uses it |
| 6 | `mobile-app/server.js` | 1–2 | Requires `./routes/wooviWebhook` and mounts it on `/api`. Only 2 lines. Legacy Express server entry point inside mobile-app | Low — not used by Expo/RN runtime | Add `@deprecated` header |
| 7 | `mobile-app/google-services.example.json` | 4–5 | Placeholder `project_id: "your-firebase-project-id"` and `storage_bucket: "your-firebase-project-id.appspot.com"` | None — example file | Already clearly an example. No action needed |
| 8 | `mobile-app/GoogleService-Info.example.plist` | entire file | Placeholder Firebase iOS config | None — example file | Already clearly an example. No action needed |
| 9 | `config/firebase/GoogleService-Info.example.plist` | entire file | Placeholder Firebase iOS config | None — example file | Already clearly an example. No action needed |

---

## Unknown / Needs human decision

These items require a human to determine whether they are still active or safe to deprecate.

| # | File | Line(s) | Pattern / Evidence | Risk if touched | Recommended next action |
|---|------|---------|--------------------|-----------------|------------------------|
| 1 | `mobile-app/src/screens/prototype/home/PassengerHomeOverlay.js` | 44 | Hardcoded Firebase Storage signed URL containing `firebase-adminsdk-fbsvc%40leaf-reactnative.iam.gserviceaccount.com` and signature parameters | Medium — exposed service account email in a signed URL. The URL itself is just a CDN resource, but leaks the SA identity | Verify if the signed URL is still valid. If yes, replace with an env-based URL. If not, remove the hardcoded URL |
| 2 | `mobile-app/src/screens/prototype/home/DriverHomeOverlay.js` | 33 | Same hardcoded Firebase Storage signed URL as above | Medium — same issue | Same as #1 |
| 3 | `internal-go-live-guide.sh` | 15, 19–20 | References VPS setup steps (`CONFIGURAÇÃO DO BACKEND (VPS)`), mentions `pm2 restart leaf-websocket-server` | Low — script is a guide, not executed automatically | Review if this guide is still accurate for the current production setup |
| 5 | `mobile-app/scripts/qa/preflight-dual-ios-vps.sh` | 18–19, 183, 187, 212, 298, 341, 347 | References `VPS_HOST`, `VPS_KEY`, `SSH_KEY_PATH` for QA tests against remote VPS | Low — QA scripts only, but references live VPS infrastructure | Human decision: are these QA scripts still actively used? |
| 6 | `mobile-app/scripts/run-mobile-only-rider-driver-4ios.sh` | 21–22, 203 | References `VPS_HOST`, `VPS_KEY`, `.tmp-contabo.env` | Low — QA scripts only | Same as #5 |
| 7 | `mobile-app/__tests__/google-api-functions.test.js` | 19, 21 | Mock config hardcodes `projectId: 'leaf-reactnative'` | None — test mock only | Already in test files. Consider centralizing Firebase mock config |
| 8 | `scripts/maintenance/test-server.js` | entire file | Legacy test server in scripts/maintenance | Unknown — check if actively used | Human decision |
| 9 | `scripts/maintenance/jwt-generator.js` | entire file | JWT generator utility | Unknown — check if actively used | Human decision |

---

## `rg` command summary (evidence collection)

Note: `rg` is not installed in this CI environment. The inventory was compiled using `grep -rn` with equivalent patterns.

```bash
# databaseURL hardcoded
grep -rn "databaseURL\|DATABASE_URL\|database_url" --include='*.js' --include='*.ts' --exclude-dir=node_modules --exclude-dir=.git

# Firebase config references
grep -rn "apiKey\|authDomain\|projectId\|storageBucket\|messagingSenderId\|appId\|measurementId\|firebase.initializeApp\|admin.initializeApp\|serviceAccount" --include='*.js' --include='*.ts' --include='*.json' --exclude-dir=node_modules --exclude-dir=.git | grep -v "__tests__"

# Legacy infrastructure / sslip / VPS
grep -rn "sslip\|contabo\|server\.vps\|VPS_HOST\|VPS_KEY" --include='*.js' --include='*.sh' --include='*.yml' --include='*.md' --exclude-dir=node_modules --exclude-dir=.git

# Woovi legacy files (LEA-7 follow-up)
grep -rn "WooviDriverService\|WooviConfig\|useWooviDriver\|WooviService" --include='*.js' --include='*.ts' --exclude-dir=node_modules --exclude-dir=.git -l

# Legacy compose/docker files
find . -name "docker-compose*" -not -path "*/node_modules/*" -not -path "*/.git/*"
```

---

## Recommended slice plan for LEA-8 (slices 2+)

### Slice 2: Documentation/comment-only (low risk)
- Add `@deprecated` JSDoc headers to:
  - `mobile-app/config/WooviConfig.js`
  - `mobile-app/src/services/WooviDriverService.js`
  - `mobile-app/src/hooks/useWooviDriver.js`
  - `mobile-app/routes/wooviWebhook.js`
  - `mobile-app/server.js`
- Add `@test-only` headers to:
  - `mobile-app/test-firebase-auth.js`
  - `mobile-app/get-real-fcm-tokens.js`
  - `mobile-app/test-fcm.js`
  - `mobile-app/test-whatsapp-otp.js`

### Slice 3: Config centralization (medium risk)
- Move `CORS_ORIGIN` from `.github/workflows/eas-build.yml` to a GitHub Actions secret
- Replace hardcoded `SERVICE_ACCOUNT_PATH` in `FCMConfig.js` with env-based resolution
- Replace hardcoded Firebase Storage signed URLs in prototype overlays with env variables
- Keep `docker-compose.production.yml` as the canonical base and
  `docker-compose.gateway-scale.yml` as the scale override
- Keep `deploy-contabo-docker.sh` as the single modular deployment script

### Slice 4: Remove deprecated files (requires human approval)
- Remove `mobile-app/routes/wooviWebhook.js` and `mobile-app/server.js` after confirming no runtime dependency
- Keep `scripts/deploy-contabo-completo.sh` as a thin supported wrapper
- Remove archived test scripts after a cooldown period
- Remove `scripts/maintenance/test-server.js`, `scripts/maintenance/jwt-generator.js` after confirming no active use

### Slice 5: Clean up legacy infra references (high risk — separate task)
- Evaluate `server.vps.js` modularization (tracked as separate effort in `DEVKIT_TECNICO_LEAF`)
- Clean up sslip references across the entire repo after confirming IP ownership
- Keep archived infrastructure notes neutral and clearly non-operational
- Consolidate multiple docker-compose files into a single compose with overrides

---

## Out of scope (this slice)

- No runtime code changes
- No file deletion
- No config behavior changes
- No new dependencies
- No RTDB/Firestore migration
- No changes to production env behavior
