const fs = require('fs');
const path = require('path');

function readTemplate(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('AWS native liveness lifecycle contract', () => {
  test('iOS exposes cancellation and clears its active bridge state before dismissing', () => {
    const bridge = readTemplate('native/aws-liveness/ios/LeafAwsLivenessModule.swift');
    const exports = readTemplate('native/aws-liveness/ios/LeafAwsLivenessModule.m');

    expect(bridge).toContain('NSObject, RCTInvalidating');
    expect(bridge).toContain('@objc(cancel:rejecter:)');
    expect(bridge).toContain('activeResolve = nil');
    expect(bridge).toContain('activeReject = nil');
    expect(bridge).toContain('activeController = nil');
    expect(bridge).toContain('"AWS_LIVENESS_CANCELLED"');
    expect(bridge).toContain('disableStartView: true');
    expect(exports).toContain('RCT_EXTERN_METHOD(cancel:');
  });

  test('Android owns back, destroy and bridge cancellation with one terminal guard', () => {
    const activity = readTemplate(
      'native/aws-liveness/android/LeafAwsLivenessActivity.kt'
    );
    const bridge = readTemplate(
      'native/aws-liveness/android/LeafAwsLivenessModule.kt'
    );

    expect(activity).toContain('AtomicBoolean(false)');
    expect(activity).toContain('OnBackPressedCallback(true)');
    expect(activity).toContain('override fun onDestroy()');
    expect(activity).toContain('finishFromBridge()');
    expect(activity).toContain('disableStartView = true');
    expect(bridge).toContain('fun cancel(): Boolean');
    expect(bridge).toContain('pendingPromise = null');
    expect(bridge).toContain('override fun invalidate()');
  });

  test('JS enters the native surface directly and logs only a stable surface marker', () => {
    const screen = readTemplate('src/components/KYC/AWSNativeLivenessScreen.js');

    expect(screen).toContain("Logger.log('[KYC_SURFACE] aws_native_liveness')");
    expect(screen).toMatch(
      /Logger\.log\('\[KYC_SURFACE\] aws_native_liveness'\);\s*await nativeAwsLivenessService\.start/
    );
    expect(screen).not.toMatch(/\[KYC_SURFACE\][^\n]*(sessionId|driverId|credentials)/);
  });
});
