const { extractCriticalAppLines } = require('../scripts/qa/real-smoke-logcat.cjs');

describe('real smoke logcat analysis', () => {
  it('ignores uiautomator crashes caused by concurrent XML dumps', () => {
    const logcat = [
      '06-20 03:07:33.534 E/AndroidRuntime(28312): FATAL EXCEPTION: main',
      '06-20 03:07:33.534 E/AndroidRuntime(28312): java.lang.IllegalStateException: UiAutomationService already registered!',
      '06-20 03:07:33.534 E/AndroidRuntime(28312): at com.android.commands.uiautomator.DumpCommand.run(DumpCommand.java:78)',
    ].join('\n');

    expect(extractCriticalAppLines(logcat, 'br.com.leaf.ride')).toEqual([]);
  });

  it('keeps fatal crashes from the Leaf app package', () => {
    const logcat = [
      '06-20 03:07:33.534 E/AndroidRuntime(28312): FATAL EXCEPTION: main',
      '06-20 03:07:33.534 E/AndroidRuntime(28312): Process: br.com.leaf.ride, PID: 28312',
      '06-20 03:07:33.534 E/AndroidRuntime(28312): java.lang.RuntimeException: boom',
    ].join('\n');

    expect(extractCriticalAppLines(logcat, 'br.com.leaf.ride')).toHaveLength(1);
  });
});
