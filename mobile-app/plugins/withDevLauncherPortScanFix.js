const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Reduz ruído de log no iOS (Expo Dev Launcher) limitando o scan de portas
 * de servidores de desenvolvimento para a porta 8081.
 *
 * Contexto:
 * - O Dev Launcher por padrão varre várias portas (8082-8085, 19000-19002).
 * - Em ambientes com Metro apenas na 8081 isso gera "Connection refused"
 *   recorrente no simulador, sem relação com o backend de negócio.
 */
const withDevLauncherPortScanFix = (config) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const candidates = [
        path.join(projectRoot, '../node_modules/expo-dev-launcher/ios/SwiftUI/DevLauncherViewModel.swift'),
        path.join(projectRoot, 'node_modules/expo-dev-launcher/ios/SwiftUI/DevLauncherViewModel.swift'),
      ];

      const swiftFile = candidates.find((candidate) => fs.existsSync(candidate));
      if (!swiftFile) {
        console.warn('[withDevLauncherPortScanFix] DevLauncherViewModel.swift não encontrado');
        return config;
      }

      const marker = '// LEAF_DEV_LAUNCHER_PORT_SCAN_FIX';
      let content = fs.readFileSync(swiftFile, 'utf8');

      if (content.includes(marker)) {
        return config;
      }

      const target = 'let portsToCheck = [8081, 8082, 8_083, 8084, 8085, 19000, 19001, 19002]';
      const replacement = `${marker}\n      let portsToCheck = [8081]`;

      if (!content.includes(target)) {
        console.warn('[withDevLauncherPortScanFix] Trecho alvo não encontrado; nenhuma alteração aplicada');
        return config;
      }

      content = content.replace(target, replacement);
      fs.writeFileSync(swiftFile, content);
      console.log(`[withDevLauncherPortScanFix] Patch aplicado em ${swiftFile}`);

      return config;
    },
  ]);

module.exports = withDevLauncherPortScanFix;
