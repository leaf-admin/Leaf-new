const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Patches node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle
 * to fix a "Could not get unknown property 'release'" error in Gradle 8.
 * This happens because AGP 8 requires using findByName or similar for components.
 */
const withExpoModulesCoreFix = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const gradleFilePath = path.join(
        projectRoot,
        '../node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle'
      );

      if (fs.existsSync(gradleFilePath)) {
        let content = fs.readFileSync(gradleFilePath, 'utf8');
        
        // Find the problematic line: from components.release
        // and replace with: from components.findByName("release")
        const target = 'from components.release';
        const replacement = 'from components.findByName("release")';
        
        if (content.includes(target)) {
          console.log(`[withExpoModulesCoreFix] Patching ${gradleFilePath}`);
          content = content.replace(target, replacement);
          fs.writeFileSync(gradleFilePath, content);
        } else {
          console.log(`[withExpoModulesCoreFix] Marker not found in ${gradleFilePath}, maybe already patched?`);
        }
      } else {
        console.warn(`[withExpoModulesCoreFix] File not found: ${gradleFilePath}`);
      }
      return config;
    },
  ]);
};

module.exports = withExpoModulesCoreFix;
