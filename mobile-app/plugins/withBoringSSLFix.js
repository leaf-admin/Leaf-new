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
    # Fix for Xcode 16: BoringSSL-GRPC receives an invalid "-G" compiler flag
    installer.pods_project.targets.each do |target|
      next unless target.name == 'BoringSSL-GRPC'
      target.build_configurations.each do |build_config|
        %w[OTHER_CFLAGS OTHER_CPLUSPLUSFLAGS OTHER_LDFLAGS].each do |flag|
          value = build_config.build_settings[flag]

          if value.is_a?(Array)
            build_config.build_settings[flag] = value.reject do |item|
              token = item.to_s
              token.start_with?('-G') || token.include?('-GCC_WARN_INHIBIT_ALL_WARNINGS')
            end
          elsif value.is_a?(String)
            build_config.build_settings[flag] = value
              .split(' ')
              .reject { |token| token.start_with?('-G') || token.include?('-GCC_WARN_INHIBIT_ALL_WARNINGS') }
              .join(' ')
          end
        end
      end
    end
`;

      const anchor = '    # This is necessary for Xcode 14, because it signs resource bundles by default';
      if (podfile.includes(anchor)) {
        podfile = podfile.replace(anchor, `${patch}\n${anchor}`);
      } else {
        const postInstallStart = podfile.indexOf('  post_install do |installer|');
        if (postInstallStart === -1) {
          return config;
        }
        const endIndex = podfile.lastIndexOf('  end');
        if (endIndex === -1 || endIndex <= postInstallStart) {
          return config;
        }
        podfile = `${podfile.slice(0, endIndex)}${patch}\n${podfile.slice(endIndex)}`;
      }

      fs.writeFileSync(podfilePath, podfile);
      return config;
    },
  ]);

module.exports = withBoringSSLFix;
