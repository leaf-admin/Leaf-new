const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const allowInsecureHttp = String(process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP || 'false').toLowerCase() === 'true';
const DEV_HTTP_HOSTS = [
  'localhost',
  '127.0.0.1',
  '10.0.2.2',
  '192.168.0.37',
  '147.93.66.253',
  '147.182.204.181',
];

const DEFAULT_INSECURE_PROD_HTTP_HOSTS = ['147.93.66.253', '147.182.204.181'];
const insecureProdHttpHostsFromEnv = String(process.env.EXPO_PUBLIC_INSECURE_HTTP_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const PROD_ALLOWED_HTTP_HOSTS = allowInsecureHttp
  ? (insecureProdHttpHostsFromEnv.length > 0 ? insecureProdHttpHostsFromEnv : DEFAULT_INSECURE_PROD_HTTP_HOSTS)
  : [];

const buildDomainEntries = (hosts) =>
  hosts
    .map((host) => `        <domain includeSubdomains="true">${host}</domain>`)
    .join('\n');

const prodDomainConfig = PROD_ALLOWED_HTTP_HOSTS.length > 0
  ? `    <!-- Explicit dev override: allow HTTP only for the hosts below -->
    <domain-config cleartextTrafficPermitted="true">
${buildDomainEntries(PROD_ALLOWED_HTTP_HOSTS)}
    </domain-config>
`
  : '';

const mainNetworkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
${prodDomainConfig}
    <!-- Block cleartext for all other hosts -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

const debugNetworkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Dev/test hosts that still require HTTP -->
    <domain-config cleartextTrafficPermitted="true">
${buildDomainEntries(DEV_HTTP_HOSTS)}
    </domain-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const writeConfigFile = (filePath, content) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
};

const withNetworkSecurityConfig = (config) => {
  // 1) Write network_security_config per build type.
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;

      const mainConfigPath = path.join(projectRoot, 'app/src/main/res/xml/network_security_config.xml');
      const debugConfigPath = path.join(projectRoot, 'app/src/debug/res/xml/network_security_config.xml');
      const debugOptimizedConfigPath = path.join(
        projectRoot,
        'app/src/debugOptimized/res/xml/network_security_config.xml'
      );

      writeConfigFile(mainConfigPath, mainNetworkSecurityConfig);
      writeConfigFile(debugConfigPath, debugNetworkSecurityConfig);
      writeConfigFile(debugOptimizedConfigPath, debugNetworkSecurityConfig);

      console.log('✅ network_security_config.xml synchronized (main + debug + debugOptimized)');

      return config;
    },
  ]);

  // 2) Force safe defaults in main AndroidManifest.
  config = withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;

    // Find or create <application>.
    let application = androidManifest.manifest.application?.[0];
    if (!application) {
      application = {
        $: {},
        'meta-data': [],
      };
      androidManifest.manifest.application = [application];
    }

    // Release/main should never allow global cleartext.
    application.$['android:usesCleartextTraffic'] = 'false';

    if (!application.$['android:networkSecurityConfig']) {
      application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }

    console.log('✅ Network Security Config added to AndroidManifest.xml (secure defaults)');

    return config;
  });

  return config;
};

module.exports = withNetworkSecurityConfig;
