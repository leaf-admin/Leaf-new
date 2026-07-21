# KYC AWS driver preflight

`npm run ops:kyc-aws-preflight` is a fail-closed, read-only gate for one QA
driver before a real provider-backed KYC run. It does not create a Liveness
session, call CompareFaces, change driver state, clear ride data, approve a CNH
or reserve cost-guard budget.

Run it from the deployed backend runtime, where the existing Firebase and Redis
credentials are already available. Supply every target explicitly; there is no
production URL default:

```bash
export KYC_PREFLIGHT_BASE_URL='https://explicit-target.example'
export KYC_PREFLIGHT_DRIVER_ID='firebase-uid-of-the-qa-driver'
read -r -s KYC_PREFLIGHT_FIREBASE_ID_TOKEN
export KYC_PREFLIGHT_FIREBASE_ID_TOKEN
read -r -s KYC_PREFLIGHT_DRIVER_STATUS_TOKEN
export KYC_PREFLIGHT_DRIVER_STATUS_TOKEN
npm run ops:kyc-aws-preflight
```

Do not persist either token in a tracked env file or pass it as a command-line
argument. The Firebase token must belong to the exact UID in
`KYC_PREFLIGHT_DRIVER_ID`.

The command exits `0` only when all evidence is green:

- authenticated `GET /api/kyc/liveness/provider` reports AWS Liveness enabled
  in `us-east-1`, temporary-role credentials, no S3 output and cost guard;
- authenticated `GET /api/kyc/biometrics/readiness` reports strict AWS
  Liveness + CompareFaces readiness and the approved thresholds;
- `GET /health/runtime-flags` reports live `redis_noeviction` authority,
  online gate/cadence enabled and no verification during an active ride;
- protected `GET /api/driver-status/:driverId` proves the driver is offline,
  disconnected and absent from both geo indices;
- read-only Redis `GET`/`HGETALL` prove no canonical active-trip marker;
- one Firestore read proves the canonical CNH is approved and bound to its
  reviewed upload;
- two Firestore reads prove the daily and monthly cost-guard periods can fund
  one Liveness + CompareFaces bundle.

The successful report therefore accounts for three Firestore document reads
and zero paid AWS KYC calls. Any missing field, unavailable query, residual ride
marker, online signal, expired/mismatched token, noncanonical CNH or insufficient
budget returns `status=blocked` and exit code `2`; the script never repairs the
state automatically.
