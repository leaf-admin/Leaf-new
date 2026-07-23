const fs = require('fs');
const path = require('path');

describe('QA visual evidence overlay policy', () => {
  it('keeps LogBox visible by default and only suppresses it behind an explicit QA flag', () => {
    const appSource = fs.readFileSync(
      path.join(__dirname, '..', 'App.js'),
      'utf8',
    );

    expect(appSource).toContain('EXPO_PUBLIC_QA_HIDE_DEV_OVERLAYS');
    expect(appSource).toContain('LogBox.ignoreAllLogs(true)');
    expect(appSource).toContain('LogBox.ignoreLogs([');
  });
});
