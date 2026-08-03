# Firestore and Storage recovery contract

## Current versioned guarantee

`scripts/ops/backup-daily.sh` creates and immediately verifies two local artifact sets:

1. Redis RDB, checksum and manifest, followed by an isolated Redis restore drill.
2. Firestore logical snapshot, checksum and manifest, followed by an offline logical decode drill.

The Firestore command is fail-closed. It paginates every configured top-level collection, aborts on any read error, refuses to overwrite an existing artifact and aborts instead of truncating when `FIRESTORE_BACKUP_MAX_DOCS` is explicitly configured and exceeded.

The default read budget remains the pre-existing five collections (`bookings`, `payment_holdings`, `payment_history`, `users`, `drivers`) and 20,000 documents per collection. Reaching that cap aborts the artifact because completeness cannot be proved without additional reads. Expanding `FIRESTORE_BACKUP_COLLECTIONS` or setting `FIRESTORE_BACKUP_MAX_DOCS=0` requires an approved operational cost change.

```bash
npm run backup:firestore-critical -- --out /var/backups/leaf/firestore/firestore-critical-YYYYMMDD_HHMMSS.json.gz
npm run verify:firestore-restore -- --backup /var/backups/leaf/firestore/firestore-critical-YYYYMMDD_HHMMSS.json.gz
```

Credentials must come from `FIREBASE_SERVICE_ACCOUNT_PATH`, `GOOGLE_APPLICATION_CREDENTIALS` or Application Default Credentials. The script has no repository-relative service-account fallback.

## Exact scope and limitations

The logical artifact is a verified emergency snapshot of configured top-level collections. Its manifest deliberately records:

- `includesSubcollections: false`;
- `includesFirebaseStorage: false`;
- the exact collection names and document counts;
- the SHA-256 of the compressed artifact.

It is not a complete Firebase disaster-recovery backup. In particular, it does not copy driver CNH/CRLV objects, rejected-biometric evidence, campaign assets or Firestore subcollections such as nested user documents. A green logical drill must never be presented as proof that those objects can be restored.

## Required managed layer before production recovery is considered complete

These actions require an approved Firebase/GCP change window and production credentials. They are intentionally not executed by repository tests.

1. Configure scheduled managed Firestore exports to a dedicated backup bucket using a retention policy that is independent from the application project lifecycle.
2. Enable object versioning or soft delete for the Firebase Storage bucket, with a documented retention and lifecycle policy appropriate for restricted KYC documents.
3. Copy or replicate backup data to a separate failure domain and ensure the application service account cannot delete retained recovery copies.
4. Run a quarterly restore drill into an isolated Firebase/GCP project. Verify top-level documents, subcollections, Storage object generations and signed-reference rebinding without exposing production KYC data.
5. Record measured RPO/RTO, artifact identifiers, counts, failures and the approver. Do not restore into production directly from an unverified artifact.

## Restore order

1. Quarantine the target environment and stop writes.
2. Restore the managed Firestore export into an isolated target first.
3. Restore or select the required Storage object generations.
4. Validate document-to-object bindings (`filePath`, generation and SHA-256) for CNH, CRLV and biometric evidence.
5. Restore Redis only after reconciling durable Firestore payment, ledger, subscription and ride state. Redis must start with a new recovery generation as defined in `REDIS_CRITICAL_AUTHORITY_RUNBOOK_2026-07-13.md`.
6. Reopen traffic only after reconciliation and explicit incident/change approval.

## Rollback

The scripts only create new artifacts and refuse overwrite. If a local snapshot is invalid, keep it for investigation, remove it from the eligible restore inventory and run a new backup. Do not weaken checksum, manifest or completeness validation to accept an artifact.
