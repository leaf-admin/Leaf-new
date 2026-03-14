const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withNetworkSecurityConfig = (config) => {
  // 1. Adicionar arquivo network_security_config.xml
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;
      const resPath = path.join(projectRoot, 'app/src/main/res/xml');
      
      // Criar diretório se não existir
      if (!fs.existsSync(resPath)) {
        fs.mkdirSync(resPath, { recursive: true });
      }
      
      // Criar arquivo network_security_config.xml
      const networkConfigPath = path.join(resPath, 'network_security_config.xml');
      const networkConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Permitir cleartext traffic para localhost e IPs locais (desenvolvimento) -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">127.0.0.1</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
        <domain includeSubdomains="true">192.168.0.37</domain>
        <!-- Permitir IPs da VPS -->
        <domain includeSubdomains="true">147.93.66.253</domain>
        <domain includeSubdomains="true">147.182.204.181</domain>
        <!-- Permitir toda a faixa de IPs privados para desenvolvimento local -->
        <domain includeSubdomains="true">192.168.0.0</domain>
        <domain includeSubdomains="true">192.168.1.0</domain>
        <domain includeSubdomains="true">10.0.0.0</domain>
    </domain-config>
    
    <!-- Permitir acesso ao Google Maps e serviços do Google -->
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">googleapis.com</domain>
        <domain includeSubdomains="true">google.com</domain>
        <domain includeSubdomains="true">gstatic.com</domain>
        <domain includeSubdomains="true">googleusercontent.com</domain>
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </domain-config>
    
    <!-- Configuração base para dev/teste: permitir HTTP -->
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;
      
      fs.writeFileSync(networkConfigPath, networkConfigContent);
      console.log('✅ network_security_config.xml criado');
      
      return config;
    },
  ]);

  // 2. Atualizar AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    
    // Encontrar ou criar o elemento <application>
    let application = androidManifest.manifest.application?.[0];
    if (!application) {
      application = {
        $: {},
        'meta-data': []
      };
      androidManifest.manifest.application = [application];
    }
    
    // Adicionar usesCleartextTraffic e networkSecurityConfig
    if (!application.$['android:usesCleartextTraffic']) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    
    if (!application.$['android:networkSecurityConfig']) {
      application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }
    
    console.log('✅ Network Security Config adicionado ao AndroidManifest.xml');
    
    return config;
  });

  return config;
};

module.exports = withNetworkSecurityConfig;
