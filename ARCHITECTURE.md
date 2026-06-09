# LEAF Architecture

This is the short architecture handoff for agents. Detailed historical notes
live under `docs/architecture/`.

## System Overview

LEAF is a ride-hailing platform with:

- Mobile app for passengers and drivers.
- Node.js backend for API, realtime socket, payment orchestration, ride lifecycle, support, campaigns, KYC policy, and runtime config.
- Next.js dashboard for daily operations.
- Firebase for auth, app data, realtime bridges, push, and storage where still active.
- Redis for realtime coordination, cache, queues, and geo/nearby-driver support.
- Woovi for Pix payment operations.
- Google Maps stack for map rendering and backend-governed Places/Routes policy.

## Runtime Backend-first

The backend is the source of truth for:

- Payment runtime.
- Feature flags.
- Driver online policy.
- KYC/liveness/face compare policy.
- Maps/routing policy.
- Notification policy.
- Campaign surfaces.
- Safety and support policy.

Mobile and dashboard must not decide critical production behavior alone.

## Primary Applications

### Mobile app

Path: `mobile-app/`

Responsibilities:

- Passenger and driver UX.
- Auth and OTP through approved Firebase/native flows.
- Map UI and ride state rendering.
- Pix payment initiation through Leaf backend only.
- Push and persistent notifications according to backend policy.
- Driver onboarding, KYC surfaces, and online/offline intent.

### Backend

Path: `leaf-websocket-backend/`

Responsibilities:

- Public API and admin API.
- Socket.IO realtime ride lifecycle.
- Payment and ledger orchestration.
- Driver matching and lifecycle state.
- Support, campaigns, waitlist, referrals, and dashboard aggregates.
- Runtime config and feature flags.
- Provider integrations behind cost guards.

### Dashboard

Path: `leaf-dashboard-js/`

Responsibilities:

- Command center.
- Support inbox and tickets.
- Campaign center.
- Driver review queue.
- Financial reconciliation.
- Runtime flags.
- Waitlist and programs.

Dashboard must consume Leaf APIs only. It must not call Woovi, Firebase, Google
Places/Routes, or other paid providers directly from browser code.

## Data Stores

- Firestore: durable app/admin data where already active.
- Realtime Database: legacy/live realtime bridge where still active; do not remove without proof.
- Redis: cache, realtime coordination, geospatial/matching support, and operational queues.
- Storage: documents, campaign assets, receipts, and user-uploaded files where approved.

## Payment Invariants

- Passenger pays before ride starts.
- Payment is initially held by backend/ledger until ride completion.
- Driver is attached to the ride after matching, not when Pix is created.
- Driver balance is credited only through idempotent ledger events.
- Withdrawals cannot exceed available net balance after applicable fees.
- Woovi sandbox/prod selection is governed by backend runtime, not mobile build constants.
- Mobile never calls Woovi directly.

## Ride Lifecycle Invariants

- Request quote.
- Confirm category and payment.
- Create Pix charge through backend.
- Confirm payment.
- Search/match driver.
- Driver accepts.
- Pickup and trip states progress through backend/socket.
- Completion writes receipt, ledger, driver earnings, and passenger history.
- Rating/support flows occur after completion or cancellation.

## KYC And Safety Invariants

- Driver online intent is checked by backend.
- Liveness and face compare policies are runtime-governed.
- Verification must not interrupt an active ride.
- Low confidence or support report can trigger soft block and revalidation between rides.
- Sensitive decisions must be audited.

## Notification Invariants

- Push templates and lifecycle notifications are backend-governed.
- Persistent ride notifications should update state instead of repeatedly closing/reopening.
- Smart push/ML stays disabled or dry-run until production data and approval exist.

## Legacy Policy

Some legacy paths are still live. Do not remove them without:

1. `rg` proof that no runtime path imports or navigates to them.
2. Tests for the replacement path.
3. Smoke or device evidence when mobile UI is affected.
4. A separate cleanup commit.

