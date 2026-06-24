# Production Readiness Goal Ledger - 2026-06-24

## Purpose

This ledger freezes the current production-readiness goal into a finite closure
record. It exists to prevent the same ride-cycle topics from being reopened
without new evidence.

The broader audit remains in:

- `docs/validation/PRODUCTION_READINESS_CORE_AUDIT_2026-06-21.md`
- `docs/validation/CANONICAL_SMOKE_TEST_DIRECTIVES.md`
- `docs/QA_RIDE_STATE_GUARDRAILS.md`

## Current PR Snapshot

Pull request: `#52 Production readiness smoke guard rails`

Branch: `codex/production-readiness-audit`

Current PR size:

- Commits: `17`
- Changed files: `293`
- Additions: `39,348`
- Deletions: `4,202`
- Files by top-level area:
  - Backend: `170`
  - Mobile: `99`
  - Dashboard: `13`
  - Docs: `7`
  - Scripts: `4`
- Test files touched or added: `123`

## Commit Ledger

| Commit | Area | Purpose |
| --- | --- | --- |
| `e1127a30` | Backend | Harden ride lifecycle and payment invariants. |
| `48cc7a76` | Dashboard | Secure reports and ops surfaces. |
| `454f6db9` | Mobile/QA | Lock ride flow surfaces and smoke tooling. |
| `2b3c888f` | Docs | Record production-readiness validation gates. |
| `13bd62cb` | Backend/QA | Allow isolated canary mock payments. |
| `e27dd784` | Backend/QA | Align runtime canary ride fixture. |
| `8f187968` | Mobile/payment | Require fresh quote lock for Pix payments. |
| `0705baa6` | Payment/QA | Expose Pix failure causes for smoke. |
| `f9aec0cb` | Mobile/payment | Lock payment route snapshot. |
| `6b558ec2` | Backend/payment | Canonicalize quote lock car type. |
| `adbe2ce2` | Backend/payment | Canonicalize payment intent car type. |
| `d0ae00df` | Mobile/payment | Preserve quote locks for recovered Pix sessions. |
| `e1dc0b22` | Mobile/lifecycle | Separate booking finalization from driver search. |
| `7d593781` | Mobile/payment | Guard locked quote payment consistency. |
| `5f7f2efd` | QA/finance | Harden real-smoke payment and fare evidence. |
| `891b8118` | Mobile/receipt | Remove passenger-visible value reconciliation copy. |
| `27dfa31f` | Docs/QA | Clarify canonical smoke expectations. |

## Repetition Map

This table counts how often the current PR revisited the same product concern.
It is intentionally conservative: broad commits are counted once per concern
only when their headline or changed scope clearly matches that concern.

| Concern | Conservative revisit count | What happened | Current status |
| --- | ---: | --- | --- |
| Payment, quote lock, Pix, fare consistency | `11` | Backend and mobile were hardened around quote locks, payment intent binding, car type canonicalization, payment route snapshot, Pix failure evidence, recovered Pix sessions, and receipt authority. | Locally guarded. Needs one real L2 ride proving quote gross = Pix gross = receipt gross = dashboard gross, with driver net and fees from the same backend-final snapshot. |
| Lifecycle state, no passive regression, receipt/rating closure | `4` | Mobile surfaces were locked against passive navigation, booking finalization was separated from search, receipt/rating closure was protected, and backend lifecycle/payment invariants were tightened. | Locally guarded. Needs real device proof around accepted, arrived, started, completed, rating, relaunch, Android back, map tap, and sheet backdrop. |
| Smoke/QA criteria and false-failure handling | `7` | Smoke directives, canary fixtures, mock-payment isolation, Pix failure causes, payment/fare evidence, and runner interpretation rules were updated. | Criteria are now explicit. Do not treat blocked preconditions or automation-inconclusive screen reads as product failures. |
| Map route viewport and bottomsheet | `1` direct broad PR pass, many validation references | The audit records existing bottomsheet-aware viewport work and focused tests. The last user-facing action explicitly stopped new implementation without fresh device evidence. | Do not touch again unless screenshot/XML/video proves route hidden behind the sheet or map cannot be manipulated. |
| Dashboard/admin/security | `1` broad commit plus QA extensions | Current Next dashboard was secured and smoke coverage expanded for reports, support, financial fields, metrics and provider-call boundaries. | Local `qa:backoffice` evidence exists in the audit. Needs live same-ride dashboard observation during L2. |
| Support/chat/severity | `2` broad backend/dashboard passes | Support severity classification, support roles, chat sender scope, and visible failure behavior were tightened. | Local backend/mobile/dashboard guards exist. Needs real support actor evidence. |
| KYC/documents/vehicle identity | `2` broad backend passes | Driver activation, CRLV identity, quick approval, KYC availability fail-closed behavior, and document evidence were tightened. | Local guards exist. Provider-backed liveness/face-compare evidence remains pending. |
| Offline/local fallback | `1` broad backend/mobile pass plus study | Snapshot/outbox/replay/location buffering and stale-signal behavior were documented and guarded locally. | Needs device airplane-mode/reconnect evidence before production-ready claim. |

## What Is Done

The current branch has materially improved these areas:

- Backend enforcement for ride/payment lifecycle.
- Mobile protection against passive state regression.
- Backend-final financial snapshot requirements for receipt and dashboard.
- Quote lock and payment intent consistency.
- No-driver/payment precondition policy.
- Dashboard route/provider-call boundaries.
- Support/chat scope and severity classification.
- KYC/driver activation fail-closed behavior.
- CRLV vehicle identity normalization.
- Smoke directives for blocked preconditions and inconclusive automation reads.

## What Was Repeated Too Much

The following concerns were revisited repeatedly and should now be treated as
frozen unless new evidence contradicts the current guards:

1. Payment amount consistency.
2. Quote lock propagation.
3. Route viewport above bottomsheet.
4. Active ride state regression.
5. Smoke blocked by missing driver.
6. Smoke falsely marked as failed when automation could not read the device state.
7. Passenger receipt without backend-final financial authority.

## Finite Closure Gates

The current goal cannot be marked complete until these gates have direct
evidence:

1. Local baseline passes on the branch:
   - `git diff --check`
   - `npm run governance:check`
   - `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
   - `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`
   - `npm --prefix mobile-app run qa:production-guards`
   - `npm --prefix leaf-websocket-backend run config:validate`
   - `npm --prefix leaf-dashboard-js run qa:backoffice`
2. Full mobile unit suite passes.
3. Full backend unit suite passes.
4. Android L2 real smoke is explicitly authorized and starts only after:
   - passenger and driver runtimes are distinct;
   - driver is online, eligible, close to pickup, and in the same region;
   - geofence is valid before payment;
   - backend/user sandbox profile is confirmed before Pix;
   - dashboard monitoring is available.
5. Android L2 captures evidence for:
   - quote;
   - payment;
   - dispatch/search;
   - driver offer;
   - accepted;
   - arrived;
   - started;
   - completed;
   - receipt;
   - rating;
   - clean map after rating;
   - relaunch after completion.
6. Same ride id proves:
   - passenger gross quote equals Pix charge;
   - passenger gross receipt equals dashboard passenger gross;
   - driver net equals backend-final driver net;
   - Leaf fee, Woovi fee, tolls and pass-throughs are explicit fields;
   - no passenger surface shows alternate values.
7. Device evidence proves route visibility above bottomsheet:
   - first route render has no synthetic straight-line flash;
   - final route is provider/backend route;
   - active passenger and driver maps remain manipulable;
   - sheet tap/backdrop/back cannot collapse active ride to map-only.
8. Provider-backed KYC/face-compare/liveness evidence is collected or explicitly
   deferred as outside the current release closure.
9. Real support/chat/report-problem evidence is collected with:
   - passenger to driver chat;
   - driver to passenger chat;
   - support ticket;
   - severity classification;
   - dashboard/operator visibility.

## Stop Rules Going Forward

- Do not reopen map/bottomsheet code from theory. Require device evidence first.
- Do not reopen fare/payment code from a broad mismatch claim. Require same-ride
  quote, payment, receipt, dashboard, ledger and fee data.
- Do not run L2 smoke without a verified available driver.
- Do not classify `blocked_precondition` as a product failure.
- Do not seed or force lifecycle states to push a smoke forward.
- Do not publish OTA, deploy backend, create Pix, create booking, or run provider
  actions without explicit operator approval.

## Current Conclusion

The goal is not complete yet. The branch has strong local/unit/contract progress,
but the missing proof is real-device/provider evidence, not another round of
implementation on the same subjects.

## Financial Policy Approval - 2026-06-24

Decision:

- The current tiered financial policy is approved for the release line.
- Approved policy id: `runtime_tiered_percent_above_50_v1`
- Approval reference: `thread-2026-06-24-user-approved-current-tiered-policy`
- Approval actor: `izaak-dias`

Approved operational fee model:

- Up to `R$ 10,00`: `R$ 0,79`
- From `R$ 10,01` to `R$ 25,00`: `R$ 0,99`
- From `R$ 25,01` to `R$ 50,00`: `R$ 1,49`
- Above `R$ 50,00`: `3%`
- Woovi/payment intermediation remains separate: `0.8%`, minimum `R$ 0,50`

Required runtime envs:

```bash
LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1
LEAF_FINANCIAL_POLICY_APPROVAL_REF=thread-2026-06-24-user-approved-current-tiered-policy
LEAF_FINANCIAL_POLICY_APPROVAL_ACTOR=izaak-dias
```

Validation proof:

```bash
LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1 \
LEAF_FINANCIAL_POLICY_APPROVAL_REF=thread-2026-06-24-user-approved-current-tiered-policy \
LEAF_FINANCIAL_POLICY_APPROVAL_ACTOR=izaak-dias \
npm --prefix leaf-websocket-backend run config:validate
```

Result:

- `ok=true`
- financial policy `approved=true`
- Firebase configured: `true`
- Google Maps configured: `true`
- no financial-policy blockers
- remaining warning: `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`
- FCM configured: `false`

Interpretation:

The finance-policy decision is closed. Production/runtime still needs the envs
above applied before deploy validation. Same-ride L2 evidence is still required
to prove quote, Pix, receipt, dashboard, ledger, Leaf fee, Woovi fee, tolls and
driver net on one real ride id.

## Ride Extension Pricing Approval - 2026-06-24

Decision:

- Active-trip destination extension pricing is approved as backend-authoritative
  pricing from the current vehicle position to the new destination.
- The extension Pix charge is not only the pure fare delta.
- Approved charge formula:
  `extension Pix = positive fare delta + route recalculation operational cost + Pix processing fee`.

Implementation rule:

- `newFare` remains the backend route fare for the new destination.
- `fareDelta` is the pure positive delta between `newFare` and the current paid
  fare.
- `diffFare` remains the passenger-payable Pix complement for compatibility with
  existing mobile payment surfaces.
- The backend persists `routeRecalculationCost`,
  `paymentIntermediationFee`, `extensionOperationalCost`,
  `extensionChargeAmount`, and `passengerPayableFare`.
- On extension confirmation, the booking's paid amount is aggregated and the
  final backend financial snapshot retains extension operational costs so they
  do not become driver net.

Runtime/config:

- `RIDE_EXTENSION_ROUTE_RECALCULATION_COST_CENTS` sets the explicit route
  recalculation pass-through cost.
- If unset, the backend derives a conservative value from route SKU telemetry
  defaults and `RIDE_COST_TELEMETRY_USD_BRL_RATE`.

Validation proof:

```bash
npm --prefix leaf-websocket-backend run test:unit -- --runInBand \
  tests/unit/services/ride-financial-contract.unit.test.js \
  tests/unit/services/ride-lifecycle-service.unit.test.js \
  tests/unit/commands/RequestRideExtensionCommand.unit.test.js \
  tests/unit/commands/RespondRideExtensionCommand.unit.test.js \
  tests/unit/commands/CompleteTripCommand.unit.test.js
```

Result: `5` backend suites / `35` tests passed.

```bash
npm --prefix mobile-app run test:unit -- --runInBand \
  __tests__/destination-quote-recalculation.test.js \
  __tests__/websocket-manager-create-booking.test.js \
  __tests__/prototype-ride-screens.test.js
```

Result: `3` mobile suites / `173` tests passed.

Interpretation:

The extension-pricing decision is closed locally. Same-ride L2 evidence is still
required to prove extension Pix amount, webhook confirmation, receipt,
dashboard, ledger, retained operational costs, and driver net on the real flow.

## Validation Run - 2026-06-24 15:58 BRT

Run directory:
`reports/validation-runs/20260624_155808_production-readiness-goal-close`

Command:

```bash
RUN_EXTENDED_LOCAL_GATES=true RUN_L2_SMOKE=false bash scripts/validation/run-master-validation.sh --label production-readiness-goal-close --wave wave9
```

Result: `blocked`

This run did not execute backend deploy, OTA, native build, Pix creation,
booking creation, provider action, or real Android L2 smoke.

Passed local gates:

- `git diff --check`
- `npm run governance:check`
- tracked secret scan
- hardcoded secret guard
- mobile production guards
- backend route guards
- backend no-active-vps-runtime guard
- full mobile unit suite: `97` suites / `728` tests
- full backend unit suite: `191` suites / `942` tests
- dashboard backoffice QA, including protected routes, reports export, financial
  reconciliation, metrics, observability, runtime flags, and no direct browser
  calls to Google, Woovi/OpenPix, or Firebase providers

Runtime config classification:

- Firebase configured: `true`
- Google Maps configured: `true`
- Runtime config blocker: active financial policy needs explicit approval ref:
  `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1` and
  `LEAF_FINANCIAL_POLICY_APPROVAL_REF`
- KYC production biometrics enabled: `false`
- FCM configured: `false`

Blocked closure gates:

- Android L2 smoke was not run because `RUN_L2_SMOKE=false`.
- Same-ride financial consistency remains blocked until authorized L2 artifacts
  exist.
- Socket.IO lifecycle replay remains blocked until authorized L2 artifacts exist.
- KYC provider evidence remains blocked until production biometrics and provider
  evidence are available.
- FCM delivery remains blocked until FCM config plus real delivery evidence are
  available.

Interpretation:

No new implementation should be opened from this run. The local core gates are
green; remaining work is explicit approval/config/evidence collection.
