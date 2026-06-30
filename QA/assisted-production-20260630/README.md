# Assisted Production RC - 2026-06-30

## Objective

Prepare the `1.0.3` Release Candidate for TestFlight and Android Internal Test with new store build numbers, production build profile, production OTA channel/runtime, and release evidence for a small assisted cohort.

## Release Position

- Decision: GO conditioned for assisted RC, not broad rollout.
- Branch: `codex/production-readiness-audit`
- Release base requested: `a1451fa6c`
- Release build commit: `6969a43e28b53a75139df66b03ddd12ee132f6e7`
- Marketing version: `1.0.3`
- Runtime version: `1.0.3`
- OTA channel: `production`
- Android target: Google Play Internal Test, `versionCode 120`
- iOS target: TestFlight, build number `28`

## Changes Applied

1. Store build numbers updated in `mobile-app/config/AppConfig.js`.
   - `ios_build_number: '28'`
   - `android_app_version: 120`
2. EAS archive hygiene updated so release builds do not upload local QA dumps, generated assets, test artifacts, or diagnostic archives.
3. Native store build numbers updated because this repository has checked-in native projects and EAS uses native values when `android/` and `ios/` exist.
   - `mobile-app/android/app/build.gradle`: `versionCode 120`
   - `mobile-app/ios/Leaf/Info.plist`: `CFBundleVersion 28`
   - `mobile-app/ios/Leaf.xcodeproj/project.pbxproj`: `CURRENT_PROJECT_VERSION 28`

## Commits

- `7069ef246` - Bump mobile store build numbers
- `1b80653e4` - Trim EAS release archive
- `6969a43e2` - Track native store build numbers

## Validation Commands

- `git diff --check`
  - PASS
- `npm run governance:check`
  - PASS
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
  - PASS
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`
  - PASS
- `npm --prefix mobile-app run qa:production-guards`
  - PASS
- `npm --prefix leaf-websocket-backend run config:validate`
  - PASS
  - Accepted warning only: `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`
- `npm --prefix mobile-app run test:unit -- --runInBand prototype-ride-screens.test.js passenger-search-lifecycle.test.js woovi-payment-modal.test.js driver-online-toggle.test.js`
  - PASS
  - 221 tests passed
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand`
  - PASS
  - 1014 tests passed

## EAS Build Evidence

### Valid RC Builds

Android:

- Build ID: `821f16aa-cf2f-4501-8088-ce72f46345c5`
- Status at final capture: `in queue`
- Profile: `production`
- Distribution: `store`
- Channel: `production`
- Runtime version: `1.0.3`
- Version: `1.0.3`
- Version code: `120`
- Commit: `6969a43e28b53a75139df66b03ddd12ee132f6e7`
- Logs: `https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/builds/821f16aa-cf2f-4501-8088-ce72f46345c5`
- Auto-submit target: Google Play internal track, draft release
- Submission details: `https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/submissions/8e310953-14fe-485e-af30-2157cc8c84e2`
- Note: Android remained in EAS queue through the final polling cycle. It must finish before Google Play Internal Test can be considered ready.

iOS:

- Build ID: `84b57ba7-3264-4214-b1bc-64ee80f757d4`
- Status at final capture: `finished`
- Profile: `production`
- Distribution: `store`
- Channel: `production`
- Runtime version: `1.0.3`
- Version: `1.0.3`
- Build number: `28`
- Commit: `6969a43e28b53a75139df66b03ddd12ee132f6e7`
- Logs: `https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/builds/84b57ba7-3264-4214-b1bc-64ee80f757d4`
- Application archive: `https://expo.dev/artifacts/eas/Rx_Hq4Huc5MAYru6k31EJhc_zJGlgqGV-nTjBcOOeos.ipa`
- Fingerprint: `dc7beb0505ca8329df73df749ff1628cde80ed5b`
- Finished at: `2026-06-30 17:02:04 America/Sao_Paulo`
- Auto-submit target: App Store Connect / TestFlight
- ASC App ID: `6757092661`
- Submission details: `https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/submissions/410adbba-833c-4579-ad3e-cd5fe7410647`

### Invalid / Canceled Builds

The first EAS build attempt was canceled because native project values still had the old store numbers. It must not be used for RC evidence.

- Android canceled build: `8a5d1ebd-ff1d-4b85-84dc-e2806f2c6cfa`, version code `119`
- iOS canceled build: `ed063cde-774d-4bdf-9682-74b06e75db2f`, build number `27`

## Backend / Runtime Gate

Before inviting real users, confirm the production backend is on the same logical state as the RC backend commits and policies:

- No payment bypass.
- Real users use Woovi production.
- Test users keep Woovi sandbox by user/profile flag.
- Geofence and operational radius are correct for the pilot region.
- Drivers are active, KYC-valid, online, and inside the eligible pickup radius.
- Pix is blocked before charge creation when no eligible driver exists.
- Post-payment dispatch, cancellation, refund, receipt, and rating events are observable.

## Assisted Cohort Plan

Initial cohort:

- 2 controlled passengers.
- 2 validated drivers.
- 1 operator monitoring Leaf dashboard, backend logs, sockets, Woovi, payment/refund/receipt events.

Required scenarios before expansion:

1. No eligible driver blocks payment before Pix.
2. Real passenger creates Pix in Woovi production.
3. Payment confirmation moves the ride to dispatch.
4. Driver offer shows passenger name, route, distance, ETA, and correct net amount.
5. Passenger cancellation before driver acceptance removes the offer from the driver and records refund/settlement correctly.
6. Complete ride: accept, arrive, start, finish, passenger receipt, driver receipt, rating.
7. Rating final returns to clean home.
8. No empty map-only state appears after payment failure, timeout, cancellation, receipt, or rating.
9. Values match across quote, Pix, passenger receipt, driver receipt, Leaf fee, tolls, and driver net.

## Stop Conditions

Stop inviting testers and open P0 if any of these happen:

- Fare divergence across quote, Pix, receipts, driver net, toll, or Leaf fee.
- Payment created without an eligible driver when the business rule should block it.
- Pix paid but dispatch does not start.
- Passenger cancellation leaves an active driver offer.
- Any state regression in active ride lifecycle.
- Empty map-only screen with no navigation path.
- Woovi sandbox is used for a real user or Woovi production is used for a test user.

## Current Risks

- EAS emitted an included-build-credit warning during build creation. The iOS build finished, but Android remained in queue during final polling. Android must be watched in EAS before testers are invited.
- Android and iOS submissions are tied to build completion. Store/TestFlight availability is not confirmed until EAS build and submit finish successfully.
- The KYC strict-biometric warning remains accepted only because driver active/KYC policy is backend-governed.

## Rollback

- If the native RC build fails: do not promote it; keep the previous store build active.
- If an OTA regression is found after install: publish or roll back the previous known-good update on `production` runtime `1.0.3`.
- If backend behavior diverges: stop assisted cohort, roll backend to the previous known-good deployment, and invalidate the RC notes.

## Next Step

Wait for the Android EAS build and both auto-submissions to finish, then verify visibility in:

- Google Play Console internal testing draft for Android `1.0.3 (120)`.
- App Store Connect TestFlight build `1.0.3 (28)`.

Only after both are visible should the controlled assisted-production cohort start.
