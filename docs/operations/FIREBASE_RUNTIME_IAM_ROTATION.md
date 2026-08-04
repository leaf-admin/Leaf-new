# Firebase runtime IAM rotation

Status: **versioned plan only; not applied to production**.

This runbook replaces the broad Firebase Admin runtime identity with a dedicated service account. It does not change application business rules, Firebase Security Rules, UI/UX, backup schedules or data retention.

## Fixed boundary

- Project role ID: `leafFirebaseRuntimeProject`.
- Bucket role ID: `leafFirebaseRuntimeStorage`.
- Default service account ID: `leaf-firebase-runtime`.
- The project role contains only FCM, Firestore, Firebase Auth, Realtime Database and project-read permissions.
- The storage role contains only object CRUD/list permissions and must be bound on the canonical bucket, not on the project.
- No `Editor`, `Owner`, Firebase admin, Storage admin, backup administration or IAM administration role is permitted.
- The previous key is disabled only after the candidate preflight, data-plane canary, rolling restart and stability window pass. It is not deleted during the initial rotation.

The two role files are accepted directly by `gcloud iam roles create/update --file`:

- `leaf-websocket-backend/config/iam/firebase-runtime-project-role.json`
- `leaf-websocket-backend/config/iam/firebase-runtime-storage-role.json`

## 1. Local validation — read-only

From the repository root:

```bash
FIREBASE_PROJECT_ID=leaf-reactnative \
FIREBASE_STORAGE_BUCKET='leaf-reactnative.firebasestorage.app' \
npm --prefix leaf-websocket-backend run ops:firebase-runtime-iam-plan
```

The expected output has `mode=plan_only`, `mutatesCloud=false`, 17 project permissions, five bucket permissions and no basic/admin role.

The required 22 permissions were queried against the IAM `queryTestablePermissions` API for `leaf-reactnative` on 2026-08-03. All were present, GA and supported in custom roles. Repeat that read-only query immediately before applying if the execution date changes materially.

## 2. Apply prerequisites — requires separate production authorization

Use an operator identity, never the existing runtime key, with narrowly time-bound permission to:

- create/update custom roles;
- create the dedicated service account;
- bind the project role on the project;
- bind the storage role on the canonical bucket;
- create and later disable a service-account key.

The operator must verify the active account and project before every mutation. The workstation used in the audit did not have `gcloud` installed, so Cloud Shell or an authenticated official Google Cloud CLI environment is required.

Set task-specific variables:

```bash
export LEAF_FIREBASE_PROJECT_ID='leaf-reactnative'
export LEAF_FIREBASE_BUCKET='leaf-reactnative.firebasestorage.app'
export LEAF_RUNTIME_SA_ID='leaf-firebase-runtime'
export LEAF_RUNTIME_SA_EMAIL="${LEAF_RUNTIME_SA_ID}@${LEAF_FIREBASE_PROJECT_ID}.iam.gserviceaccount.com"
```

Create the project and bucket roles from the versioned files. If a role already exists, use `gcloud iam roles update` with the same file instead of creating a second role.

```bash
gcloud iam roles create leafFirebaseRuntimeProject \
  --project="${LEAF_FIREBASE_PROJECT_ID}" \
  --file=leaf-websocket-backend/config/iam/firebase-runtime-project-role.json

gcloud iam roles create leafFirebaseRuntimeStorage \
  --project="${LEAF_FIREBASE_PROJECT_ID}" \
  --file=leaf-websocket-backend/config/iam/firebase-runtime-storage-role.json

gcloud iam service-accounts create "${LEAF_RUNTIME_SA_ID}" \
  --project="${LEAF_FIREBASE_PROJECT_ID}" \
  --display-name='Leaf Firebase Runtime'
```

Bind the project role only at project scope and the object role only on the canonical bucket:

```bash
gcloud projects add-iam-policy-binding "${LEAF_FIREBASE_PROJECT_ID}" \
  --member="serviceAccount:${LEAF_RUNTIME_SA_EMAIL}" \
  --role="projects/${LEAF_FIREBASE_PROJECT_ID}/roles/leafFirebaseRuntimeProject"

gcloud storage buckets add-iam-policy-binding "gs://${LEAF_FIREBASE_BUCKET}" \
  --member="serviceAccount:${LEAF_RUNTIME_SA_EMAIL}" \
  --role="projects/${LEAF_FIREBASE_PROJECT_ID}/roles/leafFirebaseRuntimeStorage"
```

## 3. Candidate key and canaries

Use a temporary directory with restrictive permissions. Never write the private key into the repository or command output.

```bash
LEAF_IAM_ROTATION_DIR="$(mktemp -d)"
chmod 700 "${LEAF_IAM_ROTATION_DIR}"

gcloud iam service-accounts keys create \
  "${LEAF_IAM_ROTATION_DIR}/firebase-runtime-next.json" \
  --iam-account="${LEAF_RUNTIME_SA_EMAIL}" \
  --project="${LEAF_FIREBASE_PROJECT_ID}"

chmod 600 "${LEAF_IAM_ROTATION_DIR}/firebase-runtime-next.json"
```

Allow for IAM/key propagation before classifying the first authentication failure. Google documents that a newly created key can require at least 60 seconds before it works.

Run the permission boundary with the candidate credential:

```bash
NODE_ENV=production \
FIREBASE_RUNTIME_IAM_PREFLIGHT_REQUIRED=true \
FIREBASE_PROJECT_ID="${LEAF_FIREBASE_PROJECT_ID}" \
FIREBASE_STORAGE_BUCKET="${LEAF_FIREBASE_BUCKET}" \
GOOGLE_APPLICATION_CREDENTIALS="${LEAF_IAM_ROTATION_DIR}/firebase-runtime-next.json" \
npm --prefix leaf-websocket-backend run ops:firebase-runtime-iam-preflight
```

Then run the isolated data-plane canary. It creates, reads, updates and removes one random canary record/object/user in Firestore, RTDB, Storage and Auth. FCM is permission-probed without sending a real notification.

```bash
CONFIRM_FIREBASE_RUNTIME_DATA_PLANE_CANARY=true \
FIREBASE_PROJECT_ID="${LEAF_FIREBASE_PROJECT_ID}" \
FIREBASE_STORAGE_BUCKET="${LEAF_FIREBASE_BUCKET}" \
FIREBASE_DATABASE_URL='https://leaf-reactnative-default-rtdb.firebaseio.com' \
GOOGLE_APPLICATION_CREDENTIALS="${LEAF_IAM_ROTATION_DIR}/firebase-runtime-next.json" \
npm --prefix leaf-websocket-backend run ops:firebase-runtime-data-plane-canary
```

Any failed cleanup is a hard failure. Do not rotate the runtime credential while a canary artifact remains.

## 4. Contabo rotation — separately authorized maintenance step

1. Record the current runtime SHA and health baseline.
2. Copy the candidate as `/opt/leaf-app/firebase-credentials.json.next` without printing it.
3. Preserve owner/group and mode from the current canonical file; the audited baseline was read-only mode `0440`.
4. Run the IAM preflight and data-plane canary with the exact deployed release and the `.next` credential.
5. Back up the current credential to the protected release rollback directory.
6. Atomically replace the canonical credential file.
7. Recreate/roll the Firebase-consuming containers one at a time. Do not tear down the compose project.
8. Require healthy containers, API/Socket HTTP 200, zero new critical logs and a second successful data-plane canary.
9. Observe a stability window before touching the previous key.

The pricing and ride-health workers do not currently mount the Firebase credential. Confirm the live compose mounts again at execution time instead of relying on this document.

## 5. Disable, do not delete, the previous key

After the stability window, list keys for the **previous** service account and identify the exact key used by the former canonical credential. Do not infer it by age and do not touch the other historical keys until their consumers are inventoried.

```bash
gcloud iam service-accounts keys disable '<previous-key-id>' \
  --iam-account='<previous-service-account-email>' \
  --project="${LEAF_FIREBASE_PROJECT_ID}"
```

Run health checks and the data-plane canary again. Keep the disabled key recoverable during the agreed rollback window. Deletion is a later, separately approved operation.

## Rollback

1. Re-enable the previous key if it was disabled.
2. Restore the previous canonical credential file atomically.
3. Roll the Firebase-consuming containers one at a time.
4. Validate health, critical logs, IAM preflight and data-plane canary.
5. Leave the new account and roles in place for audit; do not delete them during incident rollback.

## Primary references

- [Create and manage custom roles](https://cloud.google.com/iam/docs/creating-custom-roles)
- [Create service-account keys](https://cloud.google.com/iam/docs/keys-create-delete)
- [Disable and enable service-account keys](https://cloud.google.com/iam/docs/keys-disable-enable)
- [Set IAM policies on Cloud Storage buckets](https://cloud.google.com/storage/docs/access-control/using-iam-permissions)
