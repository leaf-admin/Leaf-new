# LEAF Agent Rules

This file is the operating contract for AI agents working in this repository.
It is intentionally short, strict, and scoped to prevent hallucinated work.

## Roles

- Codex: planning, architecture, review, QA, validation strategy, and final acceptance.
- OpenCode: code execution, focused fixes, and implementation inside the task scope.
- GitHub: issue queue, branch history, pull requests, review trail, and release evidence.

## Canonical Stack

- Mobile: React Native, Expo, Firebase Auth, Firestore, Realtime Database, FCM, Storage.
- Backend: Node.js, Express, Socket.IO, Redis, Firebase Admin, Woovi Pix.
- Dashboard: Next.js, React, Socket.IO Client.
- Maps: Google Maps SDK in app, backend/cache for Places, Routes, geocoding, and paid routing policy.
- KYC: AWS liveness when enabled, Leaf face compare service, backend policy as source of truth.

## Required Rules

- Always read the issue/task and this file before editing.
- Always work on a branch. Do not commit directly to `main`.
- Always keep the diff limited to the stated task.
- Always use `rg` before editing unfamiliar code.
- Always prefer existing services, adapters, routes, screens, and patterns.
- Always run the relevant lint, build, smoke, or test command when it exists.
- Always report summary, files changed, tests run, risks, and rollback path.
- Always preserve user changes and unrelated dirty work.
- Backend must enforce critical rules. Frontend-only validation is not enough.
- Dashboard and mobile must consume Leaf APIs. They must not call paid providers directly unless a task explicitly authorizes it.
- For live UI validation, use the real environment/session. Do not present mock data as production evidence.

## Business Rules

- Payment model is Pix-first.
- A ride only starts after payment is confirmed.
- The Leaf operational fee is fixed by approved policy, not a new unapproved percentage rule.
- Driver balance is ledger-backed and must not exceed the available net balance.
- Driver payout must consider applicable withdrawal fees.
- Passenger UI shows the gross amount paid by the passenger.
- Driver UI shows the driver's net amount where appropriate.
- Toll/pass-through values must remain explicit in receipts and reconciliation.
- Do not create or change take-rate, split, toll, refund, balance, or withdrawal rules without explicit approval.
- Driver identity, KYC, liveness, and safety checks are backend-governed and must never be triggered during an active ride unless an approved safety incident flow says otherwise.

## Scope Protocol

Before editing:

1. Restate the exact objective in your own words.
2. List files or domains likely to change.
3. List what is out of scope.
4. Inspect current code with `rg`, `git status`, and targeted file reads.
5. Identify tests that prove the change.

During editing:

- Make one small change at a time.
- Avoid broad refactors.
- Do not rename, move, or delete legacy code unless the task explicitly asks and `rg` proves no active use.
- Do not add new dependencies without justification and approval.
- Do not add paid API calls.
- Do not add new background jobs, workers, cron jobs, or external services without approval.

After editing:

- Run the relevant validation commands.
- Record evidence in the PR or task.
- If a critical test fails, fix or stop. Do not mark the task complete.

## Stop Conditions

Stop and ask for human direction when:

- A task requires changing a business rule.
- A task requires using production credentials, generating secrets, or rotating keys.
- A task could increase paid API usage.
- A task needs a store submission, production deploy, DNS, Cloudflare, Contabo, Firebase, Woovi, AWS, or Apple/Google console action.
- A task requires removing legacy code that still appears in `rg` results.
- A task requires a native build but the issue only authorized OTA or JS changes.
- Evidence cannot be collected honestly without a real device, real session, or real provider response.

## Validation Ladder

Use the smallest relevant set, then expand if risk increases.

Baseline:

```bash
git status --short
git diff --check
npm run governance:check
node scripts/maintenance/security/scan-secrets.cjs --tracked-only
bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh
```

Dashboard:

```bash
npm --prefix leaf-dashboard-js run qa:backoffice
```

Mobile:

```bash
npm --prefix mobile-app run qa:production-guards
npm --prefix mobile-app run test:unit -- --runInBand
```

Backend:

```bash
npm --prefix leaf-websocket-backend run config:validate
npm --prefix leaf-websocket-backend run test:unit -- --runInBand
```

Root:

```bash
npm run lint:dashboard
npm run build:dashboard
npm run test:mobile
npm run test:backend
```

## Agent Output Format

Every implementation response or PR description must include:

- Objective
- Scope completed
- Files changed
- Tests run
- Evidence
- Risks
- Rollback path
- Out-of-scope items left untouched

