# Project Sanitization Audit - 2026-06-19

## Objective

Run a conservative cleanup pass across the Leaf workspace, separating disposable local artifacts from versioned legacy code that still needs product or engineering decisions before removal.

## Safe Cleanup Applied

- Removed ignored `.DS_Store` files across the workspace, dependencies, native builds, and generated folders.
- Removed ignored backend runtime logs from `leaf-websocket-backend/logs/`.
- Removed ignored local build/cache artifacts:
  - `leaf-dashboard-js/.next/`
  - `leaf-websocket-backend/coverage/`
  - `mobile-app/.expo/`
  - `mobile-app/dist/`
- Added ignore protection for local generated asset and virtualenv folders:
  - `generated-assets/`
  - `.venv_image/`

## Keep For Now

- `mobile-app/test-results/`: contains recent real-device smoke evidence and should not be purged until the smoke report is archived elsewhere.
- Root `test-results/`: some files are already tracked and include historical runtime evidence. Removing them needs a dedicated artifact-retention decision.
- `mobile-app/src/services/canonical/legacyApiService.js`: still imported by active canonical services.
- `mobile-app/src/services/runtime/legacyRuntimeApiBridge.js`: still part of the runtime bridge surface.
- Legacy map UI files such as `NewMapScreen`, `PassengerUI`, and `DriverUI`: still referenced by app code and documentation as fallback/legacy surfaces.

## Candidate Cleanup Backlog

These are candidates for a dedicated follow-up, not automatic deletion:

- Consolidate or archive loose root-level test scripts under `leaf-websocket-backend/test-*.js`.
- Consolidate or archive loose root-level test scripts under `mobile-app/test-*.js`, `mobile-app/test-*.cjs`, and `mobile-app/test-*.sh`.
- Move long-lived runtime evidence out of tracked `test-results/` into an explicit QA evidence archive policy.
- Decide whether generated vehicle image assets should remain local-only, be curated into a versioned asset package, or be stored externally.
- Reassess legacy mobile fallback surfaces only after `rg` proves they are no longer imported or reachable from navigation/runtime flows.

## Guard Rails

- No business logic was changed.
- No payment, pricing, dispatch, geofence, balance, receipt, or KYC rules were changed.
- No tracked test evidence was deleted.
- No production credentials, deploy targets, store configuration, or external provider settings were touched.
