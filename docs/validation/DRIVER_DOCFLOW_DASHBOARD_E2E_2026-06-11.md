# Driver Document Flow Dashboard E2E - 2026-06-11

## Objective

Validate the controlled driver onboarding/document-review flow using real local CNH and CRLV PDFs supplied for the test, without exposing personal document data in versioned evidence.

## Scope

- OCR extraction for CNH and CRLV through the public Leaf API.
- Storage upload for CNH and CRLV.
- Driver application visibility in the dashboard review queue.
- Dashboard document listing and signed file access.
- Background-check upload from the dashboard flow.
- Reject and approve review transitions for CNH and CRLV.
- Background-check approval.
- Final driver approval state.

## Source Assets

The test used local files outside the repository:

- `/Users/izaakdias/Desktop/assets/CNH.pdf`
- `/Users/izaakdias/Desktop/assets/CRLV.pdf`

The raw JSON report is intentionally ignored by Git because it contains signed URLs and document-derived metadata.

## Result

Status: passed

Synthetic test driver: `e2e_driver_1781183636933`

Validated checks:

- CNH OCR completed.
- CRLV OCR completed.
- CNH file access returned HTTP 200.
- CRLV file access returned HTTP 200.
- Background-check file access returned HTTP 200.
- Driver appeared in the dashboard application list as `in_review`.
- CNH rejection followed by approval ended as `approved`.
- CRLV rejection followed by approval ended as `approved`.
- Rejection reasons were cleared after approval.
- Background-check review ended as `approved`.
- Final driver approval state was `approved`.

## Timing Snapshot

- CNH OCR: 3863 ms.
- CRLV OCR: 3048 ms.
- CNH upload: 1347 ms.
- CRLV upload: 621 ms.
- Dashboard application mirror sync: 1987 ms.
- Admin login: 3525 ms.
- Dashboard application list: 2048 ms.
- Dashboard document load before upload: 2832 ms.
- Background-check upload: 2044 ms.
- Final driver approval: 3017 ms.

## Fixes Applied

- Updated `leaf-websocket-backend/scripts/tests/e2e-driver-docflow-dashboard.cjs` to sync the Firestore dashboard application mirror after RTDB seeding.
- Updated the same E2E script to read normalized dashboard document keys (`license`, `vehicle`, `backgroundCheck`) and `all_documents`, preserving compatibility with legacy type keys.
- Updated `leaf-websocket-backend/routes/dashboard.js` so approving a previously rejected document clears `rejectionReason`.

## Commands Run

```bash
E2E_API_BASE=https://api.leaf.app.br/api \
E2E_CNH_PATH=/Users/izaakdias/Desktop/assets/CNH.pdf \
E2E_CRLV_PATH=/Users/izaakdias/Desktop/assets/CRLV.pdf \
node leaf-websocket-backend/scripts/tests/e2e-driver-docflow-dashboard.cjs
```

```bash
node --check leaf-websocket-backend/routes/dashboard.js
node --check leaf-websocket-backend/scripts/tests/e2e-driver-docflow-dashboard.cjs
git diff --check
npm --prefix leaf-websocket-backend run test:unit -- --runInBand --runTestsByPath \
  tests/unit/services/driver-application-service.unit.test.js \
  tests/unit/services/dashboard-user-management-service.unit.test.js \
  tests/unit/services/waitlist-notification-service.unit.test.js \
  tests/unit/services/driver-document-analysis-queue-biometric-retry.unit.test.js
```

## Deployment Evidence

The dashboard route patch was deployed to the public backend containers and validated with:

```bash
curl -sS https://api.leaf.app.br/health/liveness
```

The response was healthy after redeploy.

## Risks And Follow-Up

- This was an API/dashboard E2E, not a full mobile UI signup smoke.
- The test creates synthetic QA driver records and files; they should be covered by a QA data-retention cleanup policy.
- A final mobile-device signup from the app should still be run before opening public driver intake broadly.

## Rollback

- Revert the route change in `leaf-websocket-backend/routes/dashboard.js` if document review behavior must return to the previous state.
- Revert the E2E script changes if the dashboard API contract is intentionally changed again.
