# Leaf RC2 - Block 2 Local Validation

Date: 2026-07-07

## Objective

Close the mandatory local technical baseline for the release candidate: source
guards, secret checks, mobile and backend unit suites, dashboard build/browser
smoke, reproducible dependency locks, and production dependency triage.

## Candidate Identity

- Branch: `codex/p0-p1-no-regression-hardening`
- RC1 source commit: `f0974f7c162323a840cbb3e5ded863aac83d617d`
- RC2 source commit: `e92ab4d5babc756d26fe578c6d2ec0eeeee45f54`
- RC2 Git tree: `6cb97f0aa7d00a463b2c8433aa74ecc1bb23c373`
- Mobile version/runtime: `1.0.4`
- iOS build: `30`
- Android version code: `122`

## Scope Completed

- Updated the stale active-route viewport contract to match the current
  `routeViewportOcclusion` and force-region behavior.
- Updated dashboard Next.js from `16.1.0` to `16.2.10`.
- Applied compatible dependency and lockfile security updates.
- Updated root Firebase Admin from `11.11.1` to `13.10.0`.
- Updated Axios to `1.18.1`, FormData 4.x to `4.0.6`, Lodash to `4.18.1`,
  Shell Quote to `1.9.0`, and Moment to `2.30.1` where applicable.
- Installed the Playwright Chromium runtime and completed the real browser smoke.
- Synchronized the canonical root lock and tracked backend/dashboard locks.

## Tests And Checks

| Validation | Result |
| --- | --- |
| `git diff --check` | pass |
| `npm run governance:check` | pass |
| tracked secret scan | pass |
| backend hardcoded-secret guard | pass |
| mobile production guards | pass |
| backend runtime config validation | pass with documented warnings |
| mobile unit suite | 100 suites, 823 tests passed |
| backend unit suite | 197 suites, 1,015 tests passed |
| dashboard lint | pass |
| dashboard Next `16.2.10` production build | pass, 27 pages generated |
| dashboard Playwright backoffice smoke | pass |
| canonical root `npm ci --dry-run` | pass |
| backend/dashboard local lock dry-runs | pass |

Dashboard smoke covered authentication boundaries, core operations routes,
financial reconciliation, metrics, runtime flags, reports, navigation, and the
guard against direct browser calls to Google, Woovi/OpenPix, or Firebase.

The mobile Jest process reports an open-handle warning after all tests pass.
This does not fail the suite but remains test-harness debt.

## Dependency Audit

After compatible fixes:

| Workspace | Critical | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: |
| Dashboard production dependencies | 0 | 0 | 2 | 0 |
| Backend production dependencies | 0 | 3 | 35 | 0 |
| Mobile production dependencies | 0 | 4 | 21 | 1 |
| Root aggregate | 0 | 7 | 56 | 1 |

Residual high findings:

- Backend: `@opentelemetry/sdk-node` and its Prometheus exporter. The audit
  recommends `0.220.0`, but installation fails because the referenced
  `@opentelemetry/api-logs@0.220.0` package is unavailable in the registry.
- Backend: `xlsx@0.18.5` has no npm fix. Current Leaf use is authenticated
  server-side report generation; it does not parse uploaded workbooks.
- Mobile: `react-native-masked-text` brings vulnerable `date-and-time`, and
  `react-native-elements` brings `react-native-vector-icons@9.0.0` and
  `lodash.pick`. These require parent-library migration; npm's suggested
  resolutions are breaking or produce an invalid dependency tree.

These findings are triaged but not accepted for broad production. They remain
P0 security decisions/remediation work for the final production gate.

## Runtime Configuration Warnings

- `KYC_PRODUCTION_BIOMETRICS_ENABLED=false` remains a formal policy decision.
- `push.fcmConfigured=false` remains open for block 3.
- Payment bypass guards are false and core payment-before-booking guards pass.
- Firebase, Maps, payment provider configuration, Redis adapter policy, and the
  approved financial policy validate successfully.

## Evidence

- RC1 freeze: `QA/release-candidates/2026-07-07-rc1/manifest.md`
- RC2 commits:
  - `352a83c1e` - align active route viewport contract.
  - `17be973e9` - reduce production audit exposure.
  - `e92ab4d5b` - remove critical audit findings.

## Risks

- Seven aggregate high dependency findings remain, grouped into the three
  backend and four mobile findings documented above.
- Full native builds and real-device behavior are not proven by this block.
- Playwright Chromium is installed in the local user cache, not committed.
- The mobile Jest open handle warning can hide future teardown leaks.

## Rollback Path

- Revert dependency commits `e92ab4d5b` and `17be973e9` independently.
- Revert test-only commit `352a83c1e` independently.
- RC1 source remains available at `f0974f7c1`.
- Approved pre-RC baseline remains tagged as
  `baseline/e2e-approved-2026-06-30-6b6e82d`.

## Out Of Scope

- No UI/UX behavior changes.
- No payment, fare, split, refund, ledger, toll, or KYC policy changes.
- No production credentials or provider configuration changes.
- No native Release build, deploy, OTA, store submission, or production E2E.

## Block 2 Gate

- [x] Mandatory source, governance, secret, and production guards pass.
- [x] Mobile and backend unit suites pass completely.
- [x] Dashboard lint, build, and browser smoke pass.
- [x] Lockfiles reproduce through the canonical installation paths.
- [x] Critical production dependency findings reduced to zero.
- [x] Remaining high findings classified with remediation boundaries.

Block 2 is complete. This is not a production GO decision.
