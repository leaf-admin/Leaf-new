const { withProjectBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Fixes Gradle/Node resolution issues in monorepo builds.
 * 1) Keeps a project-level reactNativeVersion ext value.
 * 2) Patches expo-dev-launcher to resolve react-native from workspace node_modules via NODE_PATH.
 */
const withGradleNodeFix = (config) => {
  config = withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      const contents = config.modResults.contents;
      const marker = '// LEAF_GRADLE_NODE_FIX';
      
      if (!contents.includes(marker)) {
        const versionMatch = contents.match(/reactNativeVersion\s*=\s*"([^"]+)"/);
        const rnVersion = versionMatch ? versionMatch[1] : '0.76.9'; // Fallback to our forced version

        const patch = `
    ${marker}
    project.ext {
        reactNativeVersion = "${rnVersion}"
    }
`;
        
        // Inject near the top-level ext block when available, fallback to prepend.
        if (/ext\s*{/.test(contents)) {
          config.modResults.contents = contents.replace(/ext\s*{/, `ext {\n${patch}`);
        } else {
          config.modResults.contents = `${patch}\n${contents}`;
        }
      }
    }
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const candidates = [
        path.join(projectRoot, '../node_modules/expo-dev-launcher/android/build.gradle'),
        path.join(projectRoot, 'node_modules/expo-dev-launcher/android/build.gradle'),
      ];
      const gradleFilePath = candidates.find((candidate) => fs.existsSync(candidate));
      if (!gradleFilePath) {
        console.warn('[withGradleNodeFix] expo-dev-launcher build.gradle not found');
        return config;
      }

      let content = fs.readFileSync(gradleFilePath, 'utf8');
      const marker = '// LEAF_DEV_LAUNCHER_NODE_PATH_FIX';
      if (content.includes(marker)) {
        return config;
      }

      const target = 'workingDir(projectDir)';
      const replacement = `workingDir(projectDir)\n    ${marker}\n    environment "NODE_PATH", "\${rootProject.projectDir}/mobile-app/node_modules:\${rootProject.projectDir}/node_modules"`;

      if (content.includes(target)) {
        content = content.replace(target, replacement);
        fs.writeFileSync(gradleFilePath, content);
        console.log(`[withGradleNodeFix] Patched ${gradleFilePath}`);
      } else {
        console.warn('[withGradleNodeFix] Marker target not found in expo-dev-launcher build.gradle');
      }

      return config;
    },
  ]);

  return config;
};

module.exports = withGradleNodeFix;
