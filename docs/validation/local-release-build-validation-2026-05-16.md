# Local release build validation - 2026-05-16

Branch: `codex/clean-workbase-20260516`

Scope: local release validation for Apple and Android without EAS.

## Environment

- macOS local machine
- Xcode: 26.5 (Build 17F42)
- iOS simulator smoke device: iPad Air 11-inch (M3), iOS 26.3
- Android emulator smoke device: `Leaf_API_35`
- Java: local JDK 17 at `/Users/izaakdias/.local/mobile-build-tools/jdk-17`
- Android SDK: `/Users/izaakdias/Android/Sdk`

## Preflight

- `npm run env:local:doctor`: passed with 15 OK, 1 warning, 0 failures
- `bash -n mobile-app/scripts/build-local-android.sh mobile-app/scripts/build-local-ios.sh mobile-app/scripts/export-local-ios-ipa.sh`: passed
- `git diff --check`: passed

## iOS

Commands:

- `APP_REVIEW=true EXPO_PUBLIC_APP_REVIEW=true IOS_DEVELOPMENT_TEAM=DTA8W5KA5D FORCE_SIGNED_ARCHIVE=1 npm run build:local:ios:archive`
- `APP_REVIEW=true EXPO_PUBLIC_APP_REVIEW=true IOS_DEVELOPMENT_TEAM=DTA8W5KA5D npm run build:local:ios:ipa`
- `APP_REVIEW=true EXPO_PUBLIC_APP_REVIEW=true IOS_SIMULATOR_UDID=6F180BC1-A100-4338-BDF2-FF0F91364AD6 npm run build:local:ios:simulator`

Artifacts:

- Archive: `/Users/izaakdias/Documents/Leaf-new/mobile-app/ios/build/Leaf.xcarchive`
- IPA: `/Users/izaakdias/Documents/Leaf-new/mobile-app/ios/build/export-appstore/Leaf.ipa`
- IPA size: 50 MB
- IPA SHA-256: `60ab10cc21da80a899f8c8596327250d5e5318348d16fc7a23e0dabe00806671`

Validated from exported IPA:

- Bundle identifier: `br.com.leaf.ride`
- Marketing version: `1.0.1`
- Build number: `23`
- Team identifier: `DTA8W5KA5D`
- Signing authority: Apple Distribution
- Expo Updates channel: `production`
- `NSMicrophoneUsageDescription`: present

Smoke test:

- Installed the release simulator build on iPad Air 11-inch (M3)
- Launched `br.com.leaf.ride`
- App opened to the phone onboarding screen
- Screenshot: `/tmp/leaf-ios-smoke-20260516.png`

## Android

Commands:

- `APP_REVIEW=true EXPO_PUBLIC_APP_REVIEW=true npm run build:local:android:review:release`
- `APP_REVIEW=true EXPO_PUBLIC_APP_REVIEW=true npm run build:local:android:review:aab`

Artifacts:

- APK: `/Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/outputs/apk/release/app-release.apk`
- AAB: `/Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/outputs/bundle/release/app-release.aab`
- APK size: 191 MB
- AAB size: 119 MB
- APK SHA-256: `b4b0eb22116da864a1212d8f4c18fdcfa26c68ae16594f8b794ef9261d2186b8`
- AAB SHA-256: `8443b69a4fc4df5fe1c20b4733077735a689780225db11037c02340fc79c5860`

Validated from APK:

- Package name: `br.com.leaf.ride`
- Version code: `110`
- Version name: `1.0.3`
- Min SDK: 24
- Target SDK: 36
- Compile SDK: 36
- APK signature scheme: v2
- APK signer certificate SHA-256: `b8a2ed46343606a62cc12692be62323e2969cdf4c83fb54180d924738a7c9bf4`
- AAB signature verification command exited successfully; `jarsigner` emitted the expected local-signing warnings for the bundle stream.

Smoke test:

- Installed the release APK on `Leaf_API_35`
- Resolved launcher activity: `br.com.leaf.ride/.MainActivity`
- Launched with `adb shell am start -W -n br.com.leaf.ride/.MainActivity`
- Launch status: `ok`, activity `br.com.leaf.ride/.MainActivity`, total time 2129 ms
- Installed package reports `versionCode=110`, `versionName=1.0.3`, `apkSigningVersion=2`
- App rendered the in-app UI after launch
- Screenshot: `/tmp/leaf-android-smoke-20260516.png`

## Build script fixes included

- Android local release builds now synchronize native `android/app/build.gradle` `versionCode` from `config/AppConfig.js` before Gradle runs.
- iOS local archive, IPA, and simulator builds now set the local build environment before native sync and synchronize `ios/Leaf/Supporting/Expo.plist` with `expo-channel-name=production` for store artifacts.

