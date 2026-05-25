# Runtime Config Validate Diagnostic - 2026-05-23

## Scope

Backend/financial/config audit for `npm run config:validate --workspace leaf-websocket-backend`.
No mobile UI files were touched. No secret values were copied into this report.

## Files Loaded By The Validator

- Default validation loads `leaf-websocket-backend/.env`.
- Real sandbox validation loads `leaf-websocket-backend/.env.production.sandbox` through `ENV_FILE=.env.production.sandbox`.

## Initial Blockers Identified

`leaf-websocket-backend/.env`:

- `NODE_ENV=production`
- `WOOVI_ENVIRONMENT=production`
- Woovi API token and Leaf Pix key were present.
- No webhook verifier env was configured:
  - `WOOVI_WEBHOOK_PUBLIC_KEY`
  - `OPENPIX_WEBHOOK_PUBLIC_KEY`
  - `WOOVI_WEBHOOK_SIGNATURE_SECRET`
  - `OPENPIX_WEBHOOK_SIGNATURE_SECRET`
  - `WOOVI_WEBHOOK_HMAC_SECRET`
  - `OPENPIX_WEBHOOK_HMAC_SECRET`
- `WOOVI_WEBHOOK_REQUIRE_SIGNATURE` was absent, so the validator resolved it to false without a verifier.
- `WOOVI_WEBHOOK_ALLOW_UNSIGNED` was absent, so the validator resolved it to true without a verifier.
- `PAYMENT_BYPASS_ON_WOOVI_FAILURE=true` was active.

`leaf-websocket-backend/.env.production.sandbox`:

- `NODE_ENV=production`
- `WOOVI_ENVIRONMENT=sandbox`
- Woovi API token and Leaf Pix key were present.
- No webhook verifier env was configured.
- Signature flags were absent, producing the same effective unsafe defaults for production-mode validation.
- The validator also warns because production runtime is pointed at Woovi sandbox.

## Safe Local Corrections Applied

The local ignored env files were adjusted without adding or inventing any secret:

- `leaf-websocket-backend/.env`
  - `PAYMENT_BYPASS_ON_WOOVI_FAILURE=false`
  - `PAYMENT_FORCE_BYPASS=false`
  - `WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true`
  - `WOOVI_WEBHOOK_ALLOW_UNSIGNED=false`
  - `WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED=true`
- `leaf-websocket-backend/.env.production.sandbox`
  - `WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true`
  - `WOOVI_WEBHOOK_ALLOW_UNSIGNED=false`
  - `WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED=true`

After the correction, both validation commands still fail intentionally because a real webhook verifier is still absent.

## Validator Changes

`leaf-websocket-backend/scripts/deploy/validate-runtime-config.js` now:

- Reports only `present` or `(empty)` for sensitive values.
- Emits `diagnostics.webhookSignature` with boolean value, source (`env` or `default`), and expected state.
- Emits `diagnostics.paymentBypass` for each backend/config bypass flag.
- Blocks each active payment bypass flag by exact env name.
- Also detects legacy/public bypass names if they are exported into the backend validation environment.

## Remaining Blocker

Production-mode validation requires at least one real webhook signature verifier in the runtime secret store or local ignored env file:

- `WOOVI_WEBHOOK_PUBLIC_KEY`
- `OPENPIX_WEBHOOK_PUBLIC_KEY`
- `WOOVI_WEBHOOK_SIGNATURE_SECRET`
- `OPENPIX_WEBHOOK_SIGNATURE_SECRET`
- `WOOVI_WEBHOOK_HMAC_SECRET`
- `OPENPIX_WEBHOOK_HMAC_SECRET`

Do not commit these values. Configure them through the deployment secret manager or a local ignored env file.

## Verification Commands

- `node --check leaf-websocket-backend/scripts/deploy/validate-runtime-config.js`
- `npx jest --config config/jest.unit.config.js tests/unit/scripts/validate-runtime-config.unit.test.js`
- `npm run config:validate --workspace leaf-websocket-backend`
- `npm run config:validate:real-sandbox --workspace leaf-websocket-backend`
