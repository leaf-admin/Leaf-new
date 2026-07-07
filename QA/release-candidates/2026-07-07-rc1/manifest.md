# Leaf Release Candidate Freeze - 2026-07-07 RC1

## Objective

Freeze and register the current source candidate before production closure work,
without modifying product behavior or absorbing unrelated user changes into a
generic commit.

## Candidate Identity

- Branch: `codex/p0-p1-no-regression-hardening`
- Approved baseline commit: `6b6e82db606854957cc0deddca13a923e7f748bb`
- Approved baseline tag: `baseline/e2e-approved-2026-06-30-6b6e82d`
- Candidate source commit: `f0974f7c162323a840cbb3e5ded863aac83d617d`
- Candidate Git tree: `6b959e355e838bcf87f3986da7e7c6c9d5c8f921`
- Tracked source patch SHA-256: `a9a9ecca150534f500d8d4c8ca817acbf63ee345e96d51fb3884d9c7a05ab712`
- Untracked source manifest SHA-256: `b71fdbc84c46a55f343ee2da1b22f5482665a44621c73d400840b81b46aec10f`
- Mobile version: `1.0.4`
- Expo runtime: `1.0.4`
- iOS build number: `30`
- Android version code: `122`

The candidate Git tree was first produced with a temporary index containing the
approved baseline plus all 24 changed source files listed below. The exact same
tree was then committed as `f0974f7c1` after three prerequisite commits. The
tree hash is the canonical identity for this source candidate; any source
change requires a new candidate tree and manifest entry.

Atomic source commits:

- `67492778e` - preserve AWS liveness package references.
- `d253555ad` - guard the optional face model resource.
- `7c2335165` - stabilize local Smithy codegen builds.
- `f0974f7c1` - integrate ride Live Activities.

## Scope Matrix

### Live Activities - Direct Scope

Backend integration and test:

- `leaf-websocket-backend/bootstrap/register-socket-fcm-handlers.js`
- `leaf-websocket-backend/server.vps.js`
- `leaf-websocket-backend/services/fcm-service.js`
- `leaf-websocket-backend/services/ride-live-activity-service.js`
- `leaf-websocket-backend/tests/unit/bootstrap/register-socket-fcm-handlers.unit.test.js`

Mobile runtime and configuration:

- `mobile-app/app.config.js`
- `mobile-app/plugins/withLeafRideLiveActivity.js`
- `mobile-app/src/services/FeatureFlagService.js`
- `mobile-app/src/services/PersistentRideNotificationService.js`
- `mobile-app/src/services/RideLiveActivityService.js`
- `mobile-app/src/services/WebSocketManager.js`

Native ActivityKit sources:

- `mobile-app/native/live-activity/ios/app/LeafRideActivityAttributes.swift`
- `mobile-app/native/live-activity/ios/app/LeafRideActivityModule.m`
- `mobile-app/native/live-activity/ios/app/LeafRideActivityModule.swift`
- `mobile-app/native/live-activity/ios/widget/Info.plist`
- `mobile-app/native/live-activity/ios/widget/LeafRideActivityAttributes.swift`
- `mobile-app/native/live-activity/ios/widget/LeafRideActivityWidget.entitlements`
- `mobile-app/native/live-activity/ios/widget/LeafRideActivityWidget.swift`
- `mobile-app/native/live-activity/ios/widget/LeafRideActivityWidgetBundle.swift`

### Mixed Generated Native Files

These files contain Live Activities changes and generated output from existing
canonical configuration. They are accepted in the native integration commit so
the committed tree remains byte-for-byte equal to the frozen candidate:

- `mobile-app/ios/Leaf.xcodeproj/project.pbxproj`
  - Live Activity app extension and native bridge.
  - Inter font resources.
  - AWS FaceLiveness package/project regeneration.
  - regenerated file and build reference identifiers.
- `mobile-app/ios/Leaf/Info.plist`
  - Live Activities capabilities.
  - Google OAuth URL scheme change.
  - expanded location disclosure copy.
  - Inter font registration.
  - `UIRequiresFullScreen` changed from `true` to `false`.

### Unrelated Native Build Support

These changes are not part of Live Activities and were preserved as separate
atomic prerequisite commits:

- `mobile-app/plugins/withLeafAwsLiveness.js`
- `mobile-app/plugins/withLeafFaceEmbedding.js`
- `mobile-app/scripts/build-local-ios.sh`

## Existing Release Evidence

- Production OTA runtime: `1.0.4`
- Production OTA group: `88335f5e-5e89-43fc-85aa-f93eb29970ec`
- Android update ID: `019f1df3-4a03-732d-be7e-daf54f913cee`
- iOS update ID: `019f1df3-4a03-7cfb-932d-d6ea84fc24e7`
- Last approved E2E report:
  `QA/current-e2e/2026-06-30-e2e-rating-timeout-report.md`

The OTA identifiers above describe the approved baseline already published.
They do not prove that the current Live Activities candidate is shipped or
production-ready; Live Activities requires a new native store build.

## Validation Status At Freeze

- `git diff --check`: pass.
- Backend socket handler test: 5 tests passed.
- JavaScript syntax, shell syntax and plist lint: pass.
- Product behavior tests: deferred to closure block 2.
- Native build: deferred to closure block 5.
- Real-device E2E for this exact candidate tree: not run.
- Atomic source commits: created; candidate source commit is `f0974f7c1`.
- Final release tag: not created yet.

## Risks

- Generated iOS project changes mix native concerns, although their canonical
  source changes are separated into atomic commits.
- The existing E2E baseline predates the current Live Activities source tree.
- A native build and store release are required; OTA cannot deliver the widget
  extension or ActivityKit bridge.

## Rollback Path

- Source rollback reference: tag
  `baseline/e2e-approved-2026-06-30-6b6e82d`.
- OTA rollback reference: production group
  `88335f5e-5e89-43fc-85aa-f93eb29970ec`.
- Do not reset or discard the current working tree. Preserve it until the
  Live Activities and unrelated native changes have been separated into
  reviewed atomic commits.

## Out Of Scope For This Freeze

- No UI or UX changes.
- No payment, fare, split, refund, toll, ledger, or KYC policy changes.
- No credentials, provider configuration, deploy, store submission, or OTA.
- No production environment mutation.
- No cleanup, deletion, rename, or legacy-code removal.

## Block 1 Gate

- [x] Working branch and base commit recorded.
- [x] Current source candidate registered with an immutable Git tree hash.
- [x] Version and build identifiers recorded.
- [x] Live Activities scope separated from unrelated native changes in the inventory.
- [x] Existing OTA and E2E baseline references recorded.
- [x] Evidence directory created.
- [x] Mixed generated native files explicitly accepted and documented.
- [x] Source changes converted into reviewed atomic commits.

Block 1 is closed. The evidence report itself is committed after the candidate
source commit and therefore is not part of the source tree hash above. Tests in
block 2 must run against this candidate commit or a documented successor.
