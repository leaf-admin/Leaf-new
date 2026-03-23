const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# LEAF_BORINGSSL_FIX';

const withBoringSSLFix = (config) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        return config;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf8');
      if (podfile.includes(MARKER)) {
        return config;
      }

      const patch = `
    ${MARKER}
    # Fix for Xcode 16: BoringSSL-GRPC and others receive an invalid "-G" compiler flag
    # This flag is often injected by older CocoaPods/tools and causes "unsupported option" errors.
    installer.pods_project.targets.each do |target|
      # Apply to ALL targets to be safe, as names can vary (e.g., BoringSSL-GRPC-openssl_grpc)
      target.build_configurations.each do |build_config|
        %w[OTHER_CFLAGS OTHER_CPLUSPLUSFLAGS OTHER_LDFLAGS].each do |flag|
          value = build_config.build_settings[flag]
          if value.is_a?(Array)
            build_config.build_settings[flag] = value.reject { |item| item.to_s.strip == '-G' || item.to_s.start_with?('-G') }
          elsif value.is_a?(String)
            build_config.build_settings[flag] = value.split(' ').reject { |token| token.strip == '-G' || token.start_with?('-G') }.join(' ')
          end
        end
        
        # Disable Index Store to avoid -G being re-injected or used by internal tools
        build_config.build_settings['COMPILER_INDEX_STORE_ENABLE'] = 'NO'

        # RNFirebase + use_frameworks(static) with newer Xcode can hit modular/header issues.
        build_config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'

        # Keep RNFirebase pods out of clang modules to avoid macro/protocol resolution breaks.
        if target.name.start_with?('RNFB')
          build_config.build_settings['CLANG_ENABLE_MODULES'] = 'NO'
        end
      end
    end
`;

      const postInstallMarker = 'post_install do |installer|';
      if (podfile.includes(postInstallMarker)) {
        podfile = podfile.replace(postInstallMarker, `${postInstallMarker}\n${patch}`);
      } else {
        // Fallback or potentially error out if no post_install found
        podfile += `\npost_install do |installer|\n${patch}\nend\n`;
      }

      fs.writeFileSync(podfilePath, podfile);
      return config;
    },
  ]);

module.exports = withBoringSSLFix;
