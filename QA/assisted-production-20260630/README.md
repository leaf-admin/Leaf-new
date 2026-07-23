# Assisted Production RC - 2026-06-30

## Objective

Prepare the assisted Release Candidate for TestFlight and Android Internal Test with local native builds, production build profile, production OTA channel/runtime, and release evidence for a small assisted cohort.

## Release Position

- Decision: GO conditioned for assisted RC, not broad rollout.
- Branch: `codex/production-readiness-audit`
- Release base requested: `a1451fa6c`
- Store build-number commit: `6969a43e28b53a75139df66b03ddd12ee132f6e7`
- Store release versioning commit: `5314c88ff42e9928fbef8e4bf1e440bf5c62c7be`
- Canonical build method: local native build on the project workstation.
- Marketing version: `1.0.4`
- Runtime version: `1.0.3`
- OTA channel: `production`
- Android target: Google Play Internal Test, `versionCode 122`
- iOS target: TestFlight, build number `30`
- Reason for marketing-version bump: App Store Connect rejected new uploads for train `1.0.3` because that pre-release train is closed.

## Changes Applied

1. Store build numbers and marketing version updated in `mobile-app/config/AppConfig.js`.
   - `ios_app_version: '1.0.4'`
   - `ios_build_number: '30'`
   - `android_app_version: 122`
2. EAS archive hygiene updated so release builds do not upload local QA dumps, generated assets, test artifacts, or diagnostic archives.
3. Native store build numbers updated because this repository has checked-in native projects and EAS uses native values when `android/` and `ios/` exist.
   - `mobile-app/android/app/build.gradle`: `versionCode 122`, `versionName 1.0.4`
   - `mobile-app/ios/Leaf/Info.plist`: `CFBundleShortVersionString 1.0.4`, `CFBundleVersion 30`
   - `mobile-app/ios/Leaf.xcodeproj/project.pbxproj`: `MARKETING_VERSION 1.0.4`, `CURRENT_PROJECT_VERSION 30`
4. Local iOS archive/export validation now respects `LEAF_RUNTIME_VERSION` / `EXPO_RUNTIME_VERSION`, allowing marketing version `1.0.4` with OTA runtime `1.0.3`.

## Commits

- `7069ef246` - Bump mobile store build numbers
- `1b80653e4` - Trim EAS release archive
- `6969a43e2` - Track native store build numbers
- `5314c88ff` - Bump assisted RC store version

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

- Command: `EAS_BUILD_PROFILE=production EXPO_UPDATE_CHANNEL=production LEAF_UPDATES_CHANNEL=production LEAF_RUNTIME_VERSION=1.0.3 EXPO_RUNTIME_VERSION=1.0.3 npm --prefix mobile-app run build:local:android:aab`
- Result: PASS, `BUILD SUCCESSFUL`
- Artifact: `/Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/outputs/bundle/release/app-release.aab`
- Size: 136,673,907 bytes, 130 MB
- Created: `2026-06-30 18:44:28 -0300`
- SHA-256: `d34c55413df7f774a704c775cf1334d10ffb368ab05d57a2d14b4fd46a8ceb3d`
- Embedded config:
  - Package: `br.com.leaf.ride`
  - Version: `1.0.4`
  - Version code: `122`
  - Runtime version: `1.0.3`
  - OTA channel: `production`
- Signature validation: `jarsigner -verify` returned code 0 with `jar verified`.
- Non-blocking warnings: Android dependency/deprecation warnings and self-signed upload certificate chain warning from `jarsigner`.

iOS:

- Archive command: `FORCE_SIGNED_ARCHIVE=1 EAS_BUILD_PROFILE=production EXPO_UPDATE_CHANNEL=production LEAF_UPDATES_CHANNEL=production LEAF_RUNTIME_VERSION=1.0.3 EXPO_RUNTIME_VERSION=1.0.3 npm --prefix mobile-app run build:local:ios:archive`
- Archive result: PASS, `ARCHIVE SUCCEEDED`
- Archive: `/Users/izaakdias/Documents/Leaf-new/mobile-app/ios/build/Leaf.xcarchive`
- Export command: `EAS_BUILD_PROFILE=production EXPO_UPDATE_CHANNEL=production LEAF_UPDATES_CHANNEL=production LEAF_RUNTIME_VERSION=1.0.3 EXPO_RUNTIME_VERSION=1.0.3 npm --prefix mobile-app run build:local:ios:ipa`
- Export result: PASS, `EXPORT SUCCEEDED`
- IPA: `/Users/izaakdias/Documents/Leaf-new/mobile-app/ios/build/export-appstore/Leaf.ipa`
- Size: 69,182,855 bytes, 66 MB
- Created: `2026-06-30 18:56:36 -0300`
- SHA-256: `43bbdf88127ad128e388ea8583e630e1e2762313cab37c4c8462f7e72e29117d`
- Embedded config:
  - Bundle ID: `br.com.leaf.ride`
  - Version: `1.0.4`
  - Build number: `30`
  - Runtime version: `1.0.3`
  - OTA channel: `production`
- Exported provisioning profile: `iOS Team Store Provisioning Profile: br.com.leaf.ride`
- Signing validation: `get-task-allow=false`, no provisioned device list, no all-devices flag; suitable App Store/TestFlight profile.
- Non-blocking warnings: third-party pod deployment-target and run-script dependency warnings.

## Store Submission Evidence

Android:

- Command: `fastlane supply --aab /Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/outputs/bundle/release/app-release.aab --package_name br.com.leaf.ride --track internal --release_status draft --json_key /Users/izaakdias/Downloads/leaf-reactnative-455823-0e5c77cad705.json --skip_upload_metadata true --skip_upload_images true --skip_upload_screenshots true --skip_upload_changelogs true --timeout 600`
- Result: PASS, `Successfully finished the upload to Google Play`.
- Track: Google Play Internal Test.
- Initial release status: draft.
- Final track update: PASS via Android Publisher API; internal track now contains release `1.0.4`, `versionCode 122`, status `completed`.
- Submitted artifact: Android `1.0.4`, `versionCode 122`.

iOS:

- Upload command: local `xcodebuild -exportArchive` with `destination=upload`, using the Xcode account/session on this workstation.
- Result: PASS, `Upload succeeded`, `Uploaded package is processing`, `Uploaded Leaf`, `EXPORT SUCCEEDED`.
- Target: App Store Connect / TestFlight.
- Submitted artifact: iOS `1.0.4`, build `30`.
- Non-blocking warning: App Store Connect symbol upload reported missing dSYM entries for `React.framework`, `ReactNativeDependencies.framework`, and `hermes.framework`. The binary upload succeeded; crash symbolication for those frameworks may be degraded until dSYM handling is tightened.

## Invalid / Non-Canonical EAS Builds

The EAS builds and submissions created during the first release attempt are not canonical for this RC because the release path was corrected to local native builds. They must not be used for TestFlight, Google Play Internal Test, or release evidence.

- Android canceled build: `8a5d1ebd-ff1d-4b85-84dc-e2806f2c6cfa`, version code `119`
- iOS canceled build: `ed063cde-774d-4bdf-9682-74b06e75db2f`, build number `27`
- Android non-canonical EAS build: `821f16aa-cf2f-4501-8088-ce72f46345c5`, artifact `https://expo.dev/artifacts/eas/5ZrkeiXNIAztyrpsUCZTZ2BtwYVSkEulDdvVcwB8zW0.aab`
- iOS non-canonical EAS build: `84b57ba7-3264-4214-b1bc-64ee80f757d4`, artifact `https://expo.dev/artifacts/eas/Rx_Hq4Huc5MAYru6k31EJhc_zJGlgqGV-nTjBcOOeos.ipa`
- Local/store attempts superseded by the final RC:
  - Android `1.0.3 (120)` and iOS `1.0.3 (28)`: superseded after the release path was corrected and App Store Connect rejected the closed `1.0.3` train.
  - Android `1.0.3 (121)`: uploaded as internal draft during the transition, superseded by Android `1.0.4 (122)`.
  - iOS `1.0.3 (29)`: upload rejected by App Store Connect because train `1.0.3` is closed.

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

- TestFlight processing is not fully complete until App Store Connect shows iOS build `30` as available to testers.
- Google Play Internal Test is updated to Android `1.0.4 (122)` with status `completed`; allow normal Play Console propagation delay before tester install attempts.
- The KYC strict-biometric warning remains accepted only because driver active/KYC policy is backend-governed.
- Local artifacts are generated, validated, and uploaded; assisted users should not be invited until App Store Connect finishes processing iOS build `30` and Play Console propagation shows Android `122` to testers.
- iOS dSYM upload warning should be handled before broad rollout to improve crash diagnostics.

## Rollback

- If the native RC build fails: do not promote it; keep the previous store build active.
- If an OTA regression is found after install: publish or roll back the previous known-good update on `production` runtime `1.0.3`.
- If backend behavior diverges: stop assisted cohort, roll backend to the previous known-good deployment, and invalidate the RC notes.

## Next Step

Verify processing/visibility in:

- Google Play Console internal testing completed release for Android `1.0.4 (122)`.
- App Store Connect TestFlight build `1.0.4 (30)`.

Only after both are visible should the controlled assisted-production cohort start.
