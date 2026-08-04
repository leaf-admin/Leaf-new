/** @jest-environment node */

const rootPackage = require('../../package.json');
const rootLock = require('../../package-lock.json');
const path = require('path');
const { createRequire } = require('module');

describe('mobile runtime transitive security contract', () => {
  it('keeps patched compatible transitive overrides', () => {
    expect(rootPackage.overrides).toMatchObject({
      'body-parser@^2.0.0': '2.3.0',
      'react-native-gifted-chat': { uuid: '11.1.1' },
      'react-native-google-places-autocomplete': { qs: '6.15.3' },
      xcode: { uuid: '11.1.1' },
    });
  });

  it('locks the resolved patched versions used by runtime and build tooling', () => {
    const expectedVersions = {
      'node_modules/xcode/node_modules/uuid': '11.1.1',
      'node_modules/react-native-gifted-chat/node_modules/uuid': '11.1.1',
      'node_modules/qs': '6.15.3',
      'node_modules/express/node_modules/body-parser': '2.3.0',
      'node_modules/@react-native-community/cli-server-api/node_modules/body-parser': '2.3.0',
    };

    for (const [packagePath, version] of Object.entries(expectedVersions)) {
      expect(rootLock.packages[packagePath]?.version).toBe(version);
    }

    expect(
      rootLock.packages['node_modules/react-native-google-places-autocomplete/node_modules/qs'],
    ).toBeUndefined();
  });

  it('preserves the APIs consumed by Xcode, Gifted Chat and Places', () => {
    const xcode = require('xcode');
    const project = xcode.project(
      path.join(__dirname, '../ios/Leaf.xcodeproj/project.pbxproj'),
    );
    project.parseSync();
    expect(project.generateUuid()).toMatch(/^[A-F0-9]{24}$/);

    const giftedChatRequire = createRequire(require.resolve('react-native-gifted-chat/package.json'));
    const placesRequire = createRequire(
      require.resolve('react-native-google-places-autocomplete/package.json'),
    );

    expect(giftedChatRequire('uuid').v4()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(placesRequire('qs').parse('types=address&types=establishment')).toEqual({
      types: ['address', 'establishment'],
    });
  });
});
