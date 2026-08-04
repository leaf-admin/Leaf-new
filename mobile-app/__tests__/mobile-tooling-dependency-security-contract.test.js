const mobilePackage = require('../package.json');
const rootPackage = require('../../package.json');
const rootLock = require('../../package-lock.json');

describe('mobile tooling dependency security contract', () => {
  it('keeps the supported Appium and Playwright toolchain floors', () => {
    expect(mobilePackage.devDependencies.appium).toBe('^3.6.0');
    expect(mobilePackage.devDependencies['@playwright/experimental-ct-react']).toBe('^1.62.1');
    expect(mobilePackage.devDependencies['@playwright/test']).toBe('^1.62.1');
  });

  it('locks patched transitive tooling versions', () => {
    expect(rootPackage.overrides).toMatchObject({
      '@expo/cli': { undici: '6.28.0' },
      cheerio: { undici: '7.29.0' },
      'fast-uri': '3.1.5',
      postcss: '8.5.23',
      'shell-quote': '1.10.0',
      webdriver: { undici: '6.28.0' },
    });

    const expectedVersions = {
      'node_modules/appium': '3.6.0',
      'node_modules/@appium/support': '7.2.6',
      'node_modules/@playwright/experimental-ct-react': '1.62.1',
      'node_modules/vite': '8.2.0',
      'node_modules/postcss': '8.5.23',
      'node_modules/fast-uri': '3.1.5',
      'node_modules/shell-quote': '1.10.0',
      'node_modules/undici': '6.28.0',
      'node_modules/cheerio/node_modules/undici': '7.29.0',
    };

    for (const [packagePath, version] of Object.entries(expectedVersions)) {
      expect(rootLock.packages[packagePath]?.version).toBe(version);
    }
  });
});
