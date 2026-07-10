# Production readiness execution status

Date: 2026-07-09
Branch: `codex/p0-p1-no-regression-hardening`
Strategy: controlled pilot by gates

## Implemented in this hardening wave

- Full mobile, backend, dashboard, governance, runtime configuration and secret gates are mandatory in CI.
- Unit tests no longer load a real Woovi production profile for payment runtime fixtures.
- Backend and mobile loggers redact authorization, tokens, keys, cookies and credentials recursively.
- FCM registration is bound to the authenticated socket identity; logs and provider results never expose raw tokens.
- Geofence is fail-closed for production/pilot, with stable reason codes, metrics and operational status.
- Passenger and driver pilot allowlists are backend-governed.
- Independent kill switches pause new Pix and bookings without interrupting active rides.
- Drivers outside the cohort cannot enter the online pool.
- Runtime config publishes only safe launch-control metadata: profile, cohort counts, region IDs, policy versions and geofence state.
- Readiness is runtime-role aware and checks the required Redis, Firebase, payment, maps, FCM, KYC, cohort and geofence dependencies.
- Production release scripts reject dirty worktrees; RC manifests require immutable SHA, build/OTA identifiers, rollback references and CI evidence.
- Observability images are pinned, host ports are loopback-only, Grafana anonymous/default access is disabled, and critical alerts have an external channel independent from the backend.
- Dependency triage reduced the workspace audit from 81 total/19 high to 36 total/1 high. The remaining `xlsx` advisory has no registry fix; XLSX export is fail-closed in production while PDF remains available.
- The lifecycle card/map matrix and centralized map presentation, vehicle heading and viewport contracts are implemented and covered by tests.

## Final local validation

- Backend unit: 202 suites, 1,048 tests passed.
- Backend integration: 5 suites, 41 tests passed.
- Mobile unit: 104 suites, 848 tests passed, with open-handle detection.
- Dashboard QA: lint, production build, 27 route checks and backoffice smoke passed.
- Mobile production guards, governance, observability invariants, tracked secret scan, hardcoded-secret guard, workflow YAML parsing and `git diff --check` passed.
- Current production runtime preflight intentionally returns `NO-GO`: `launchProfile=full` has no formal broad-launch approval, and production biometrics are not enabled.
- The current dirty worktree intentionally prevents creation of an RC manifest.

## Gates requiring authorized external evidence

- Deploy and physically validate the versioned `rio-zona-sul-centro-lapa-v1` geofence. The canonical GeoJSON contains Zona Sul RP 2.1 plus the bairros Centro and Lapa, explicitly excluding the broader RP Centro 1.1.
- Configure AWS liveness and the trusted face-match provider with production credentials; approve one controlled real driver for the bilateral E2E.
- Install the same RC on physical Android and iPhone, using one passenger and one driver; validate bilateral lifecycle, FCM, relaunch, network oscillation and record both devices.
- Execute payment, refund and toll transactional-integrity scenarios against the authorized provider environment, proving that quote, charge, payment, booking, receipt, ledger and provider states agree. This is a validation gate, not a statement that a known divergence exists.
- Configure the external alert-channel secret, start the private observability stack and prove delivery while the backend receiver is unavailable.
- Produce clean scoped commits and record build IDs, OTA groups, rollback references and CI URL in the immutable RC manifest.
- Conduct the operator tabletop and obtain product, operations, finance, security and engineering sign-off.
- Replace `xlsx` with an approved maintained exporter before re-enabling Excel reports.

## Accepted release-owner decisions

- Woovi credential rotation is intentionally deferred until after the final production monetary test. Until then, the credential remains an accepted owner risk and must never appear in logs, test fixtures or evidence. Rotation/revocation becomes the immediate post-test security action.
- The minimum bilateral E2E cohort is one passenger plus one approved driver. A second driver is not required for the lifecycle proof; it is only required later for simultaneous-acceptance/dispatch competition or operational redundancy testing.
- The term used for the financial gate is `transactional integrity validation`. Reconciliation remains an internal comparison technique, not an assertion that the current records are out of balance.

## Decision

`NO-GO` for a real pilot until every external-evidence item above is closed. `NO-GO` for broad launch until the P1 security, resilience, capacity, dashboard and maintainability gates are also signed off.
