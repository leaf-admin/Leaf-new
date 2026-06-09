# LEAF Project Rules

This document defines how tasks move from idea to implementation without
letting agents drift outside scope.

## Recommended Operating Model

```text
Codex = plans and reviews
OpenCode = executes focused code tasks
GitHub = queue, branches, PRs, evidence
```

## Trade-offs

### Benefits

- Smaller tasks reduce agent hallucination and make review easier.
- One issue per task creates a durable audit trail.
- One branch per task keeps rollback simple.
- Codex review before merge keeps architecture and business rules centralized.
- OpenCode can move fast on implementation while Codex guards quality and scope.

### Costs

- More issues and PRs means more ceremony.
- Small tasks require better upfront slicing.
- Some tasks will need a second pass because agents should stop instead of guessing.
- Strict validation can slow down quick visual fixes.

### Decision

Use this model for product, backend, dashboard, payment, safety, KYC, release,
and cleanup work. For tiny copy-only edits, the same rules apply but the test
set can be smaller.

## Guard Rails

### 1. Task Contract Required

No agent should execute from a vague prompt. A task must define:

- Objective
- Context
- Scope
- Out of scope
- Business rules affected
- Likely files
- Acceptance criteria
- Required tests
- Risks

### 2. Scope Lock

Agents must not:

- Refactor unrelated files.
- Rename live routes, screens, events, collections, or services without approval.
- Change payment, balance, split, KYC, geofence, matching, or safety logic without explicit task scope.
- Introduce new dependencies or services without approval.
- Replace a working subsystem just because a new pattern looks cleaner.

### 3. Source of Truth

- Runtime policy lives in the backend.
- Feature flags and production behavior are backend-first where possible.
- Mobile can cache runtime config but must fail conservatively for payment, KYC, safety, and driver-online decisions.
- Dashboard must use Leaf APIs and backend aggregates.
- Direct paid provider calls from dashboard/browser are forbidden.

### 4. Cost Controls

Agents must assume every external API call costs money.

- Do not call Google Places, Routes, Maps web APIs, Woovi, AWS Rekognition, Firebase write-heavy paths, or other paid services in tests unless explicitly authorized.
- Prefer unit tests, mocks, cache-hit tests, local services, and backend cost guards.
- If a real provider test is required, state expected number of calls before running it.

### 5. Evidence Rules

- Mock evidence is acceptable only for unit/integration tests and must be labeled as mock.
- Production or canary claims require real environment evidence.
- Store-review claims require screenshots/video from the relevant build or device.
- Dashboard visual claims require real dashboard session, not synthetic API data.

### 6. Definition of Done

A task is done only when:

- The diff is limited to scope.
- Tests and guards ran or a clear reason explains why not.
- No secrets or unsafe fallbacks were added.
- Business rule changes are explicitly documented.
- Rollback is clear.
- PR description or task comment contains evidence.

## Stop Conditions

Stop immediately and ask when:

- The task is ambiguous.
- Required credentials are missing.
- A live dashboard/mobile state cannot be validated honestly.
- The change affects money, identity, safety, store compliance, or production infra beyond the task.
- `rg` shows a supposedly dead component is still referenced.
- Tests fail in an unrelated area after the change.

## Branch And PR Rules

- Branch format for agent work: `codex/<short-task>` or the explicit branch requested by the human.
- OpenCode branches may use `feature/<short-task>`, `fix/<short-task>`, or `chore/<short-task>`.
- One branch per issue.
- One PR per branch.
- PRs must link the issue and include tests/evidence.
- Do not merge without human approval when the task touches payment, KYC, safety, app store, deploy, or infra.

## Review Rubric

Codex review should prioritize:

- Business rule regressions.
- Money, ledger, withdrawal, Pix, fee, and receipt correctness.
- KYC, liveness, safety, and driver-online correctness.
- Paid API usage and cache behavior.
- Mobile state hydration, UI regressions, and cross-platform differences.
- Dashboard data correctness and no direct provider calls.
- Missing tests or fake evidence.
