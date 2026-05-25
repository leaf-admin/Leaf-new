const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Patches node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle
 * to fix a "Could not get unknown property 'release'" error in Gradle 8.
 * This happens because AGP 8 requires using findByName or similar for components.
 */
const withExpoModulesCoreFix = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const candidates = [
        path.join(projectRoot, '../node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle'),
        path.join(projectRoot, 'node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle'),
      ];

      const gradleFilePath = candidates.find((candidate) => fs.existsSync(candidate));
      if (!gradleFilePath) {
        console.warn('[withExpoModulesCoreFix] File not found in known locations');
        return config;
      }

      let content = fs.readFileSync(gradleFilePath, 'utf8');

      // AGP 8+: 'components.release' can fail and must use findByName.
      const target = 'from components.release';
      const replacement = 'from components.findByName("release")';

      if (content.includes(target)) {
        console.log(`[withExpoModulesCoreFix] Patching ${gradleFilePath}`);
        content = content.replace(target, replacement);
        fs.writeFileSync(gradleFilePath, content);
      } else {
        console.log(`[withExpoModulesCoreFix] Marker not found in ${gradleFilePath}, maybe already patched`);
      }

      return config;
    },
  ]);

module.exports = withExpoModulesCoreFix;
