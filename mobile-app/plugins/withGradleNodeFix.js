const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Fix for expo-dev-launcher executing 'node' to find react-native version during build evaluation.
 * In some monorepo/EAS environments, this evaluation fails. Pre-setting 'reactNativeVersion'
 * in the project's ext properties allows expo-dev-launcher to skip the node execution.
 */
const withGradleNodeFix = (config) => {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      const contents = config.modResults.contents;
      const marker = '// LEAF_GRADLE_NODE_FIX';
      
      if (!contents.includes(marker)) {
        const versionMatch = contents.match(/reactNativeVersion\s*=\s*"([^"]+)"/);
        const rnVersion = versionMatch ? versionMatch[1] : '0.76.9'; // Fallback to our forced version

        const patch = `
    ${marker}
    allprojects {
        project.ext {
            reactNativeVersion = "${rnVersion}"
        }
    }
`;
        
        // Inject into the build.gradle
        config.modResults.contents = contents.replace(
          /allprojects\s*{/,
          `allprojects {\n${patch}`
        );
      }
    }
    return config;
  });
};

module.exports = withGradleNodeFix;
