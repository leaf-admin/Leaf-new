# Assisted Production RC - 2026-06-30

## Objective

Prepare the `1.0.3` Release Candidate for TestFlight and Android Internal Test with new store build numbers, production build profile, production OTA channel/runtime, and release evidence for a small assisted cohort.

## Release Position

- Decision: GO conditioned for assisted RC, not broad rollout.
- Branch: `codex/production-readiness-audit`
- Release base requested: `a1451fa6c`
- Store build-number commit: `6969a43e28b53a75139df66b03ddd12ee132f6e7`
- Canonical build method: local native build on the project workstation.
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

## Local Build Evidence

EAS is not the canonical build source for this RC. Local native artifacts are the only release artifacts approved for TestFlight and Android Internal Test.

### Environment Doctor

- Command: `npm --prefix mobile-app run env:local:doctor`
- Result: PASS, 16 OK, 0 alerts, 0 failed.
- Toolchain:
  - Node: `/opt/homebrew/bin/node`
  - npm: `/opt/homebrew/bin/npm`
  - Xcode: `/usr/bin/xcodebuild`, Xcode 26.6 build 17F113
  - CocoaPods: `/Users/izaakdias/.gem/ruby/3.3.0/bin/pod`, version 1.16.2
  - Java: `/Users/izaakdias/.local/mobile-build-tools/jdk-17/bin/java`
  - Android SDK: `/Users/izaakdias/Android/Sdk`
  - iOS signing: valid local signing material detected for `br.com.leaf.ride`

### Canonical RC Artifacts

Android:

- Command: `ANDROID_BUILD_CLEAN=1 EAS_BUILD_PROFILE=production EXPO_UPDATE_CHANNEL=production LEAF_UPDATES_CHANNEL=production EXPO_RUNTIME_VERSION=1.0.3 npm --prefix mobile-app run build:local:android:aab`
- Result: PASS, `BUILD SUCCESSFUL`
- Artifact: `/Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/outputs/bundle/release/app-release.aab`
- Size: 136,674,119 bytes, 130 MB
- Created: `2026-06-30 17:37:47 -0300`
- SHA-256: `12f03782a6249177ae57e39f04fdf49dfff6decaed963e70e28bdf8fd63d8c68`
- Embedded config:
  - Package: `br.com.leaf.ride`
  - Version: `1.0.3`
  - Version code: `120`
  - Runtime version: `1.0.3`
  - OTA channel: `production`
- Signature validation: `jarsigner -verify` returned code 0 with `jar verified`.
- Non-blocking warnings: Android dependency/deprecation warnings and self-signed upload certificate chain warning from `jarsigner`.

iOS:

- Archive command: `FORCE_SIGNED_ARCHIVE=1 EAS_BUILD_PROFILE=production EXPO_UPDATE_CHANNEL=production LEAF_UPDATES_CHANNEL=production EXPO_RUNTIME_VERSION=1.0.3 npm --prefix mobile-app run build:local:ios:archive`
- Archive result: PASS, `ARCHIVE SUCCEEDED`
- Archive: `/Users/izaakdias/Documents/Leaf-new/mobile-app/ios/build/Leaf.xcarchive`
- Export command: `EAS_BUILD_PROFILE=production EXPO_UPDATE_CHANNEL=production LEAF_UPDATES_CHANNEL=production EXPO_RUNTIME_VERSION=1.0.3 npm --prefix mobile-app run build:local:ios:ipa`
- Export result: PASS, `EXPORT SUCCEEDED`
- IPA: `/Users/izaakdias/Documents/Leaf-new/mobile-app/ios/build/export-appstore/Leaf.ipa`
- Size: 69,182,954 bytes, 66 MB
- Created: `2026-06-30 17:51:46 -0300`
- SHA-256: `74e71913e1db938c38eeb955a34f246be28cddd6f08c00c8335515aeb9f76c85`
- Embedded config:
  - Bundle ID: `br.com.leaf.ride`
  - Version: `1.0.3`
  - Build number: `28`
  - Runtime version: `1.0.3`
  - OTA channel: `production`
- Exported provisioning profile: `iOS Team Store Provisioning Profile: br.com.leaf.ride`
- Signing validation: `get-task-allow=false`, no provisioned device list, no all-devices flag; suitable App Store/TestFlight profile.
- Non-blocking warnings: third-party pod deployment-target and run-script dependency warnings.

## Invalid / Non-Canonical EAS Builds

The EAS builds and submissions created during the first release attempt are not canonical for this RC because the release path was corrected to local native builds. They must not be used for TestFlight, Google Play Internal Test, or release evidence.

- Android canceled build: `8a5d1ebd-ff1d-4b85-84dc-e2806f2c6cfa`, version code `119`
- iOS canceled build: `ed063cde-774d-4bdf-9682-74b06e75db2f`, build number `27`
- Android non-canonical EAS build: `821f16aa-cf2f-4501-8088-ce72f46345c5`, artifact `https://expo.dev/artifacts/eas/5ZrkeiXNIAztyrpsUCZTZ2BtwYVSkEulDdvVcwB8zW0.aab`
- iOS non-canonical EAS build: `84b57ba7-3264-4214-b1bc-64ee80f757d4`, artifact `https://expo.dev/artifacts/eas/Rx_Hq4Huc5MAYru6k31EJhc_zJGlgqGV-nTjBcOOeos.ipa`

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

- Store/TestFlight availability is not confirmed until the local AAB and local IPA are uploaded and processed by Google Play Console and App Store Connect.
- The KYC strict-biometric warning remains accepted only because driver active/KYC policy is backend-governed.
- Local artifacts are generated and validated, but assisted users should not be invited until both store consoles show the exact build numbers: Android `120`, iOS `28`.

## Rollback

- If the native RC build fails: do not promote it; keep the previous store build active.
- If an OTA regression is found after install: publish or roll back the previous known-good update on `production` runtime `1.0.3`.
- If backend behavior diverges: stop assisted cohort, roll backend to the previous known-good deployment, and invalidate the RC notes.

## Next Step

Upload the local artifacts, then verify visibility in:

- Google Play Console internal testing draft for Android `1.0.3 (120)`.
- App Store Connect TestFlight build `1.0.3 (28)`.

Only after both are visible should the controlled assisted-production cohort start.
