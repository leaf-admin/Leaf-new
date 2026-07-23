const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const CURRENT_SUITE_DIR = path.join(
  MOBILE_ROOT,
  '.maestro',
  'flows',
  'current',
);
const CURRENT_MENU_RUNNER_DIR = path.join(
  MOBILE_ROOT,
  '.maestro',
  'flows',
  'current-menus',
);
const CURRENT_HOME_LINK = 'leafapp://robotaxi/home';
const LEGACY_MARKER = 'LEGACY_COMPAT_ONLY';
const FORBIDDEN_CURRENT_LINKS = [
  'leafapp://robotaxi/destination',
  'leafapp://robotaxi/booking',
  'leafapp://robotaxi/payment',
];
const FORBIDDEN_LEGACY_ROUTE_TOKENS = [
  'RobotaxiPrototypeDestination',
  'RobotaxiPrototypeBooking',
  'RobotaxiPrototypePayment',
  'RobotaxiMenuMessages',
  'MapScreen',
  'TabRoot',
];
const FORBIDDEN_MUTATION_TARGET_IDS = new Set([
  'robotaxi-settings-row-logout',
  'robotaxi-settings-row-delete-account',
  'privacy-delete-account-button',
  'profile-logout-shortcut',
  'profile-account-deletion-shortcut',
  'driver-activation-continue-button',
  'driver-earnings-withdraw-button',
  'driver-earnings-withdraw-confirm-button',
  'robotaxi-driver-waitlist-join-button',
  'robotaxi-driver-invite-create-button',
  'robotaxi-driver-invite-accept-button',
  'robotaxi-driver-invite-copy-button',
  'robotaxi-driver-invite-share-button',
  'robotaxi-support-primary-action',
  'robotaxi-support-open-complain',
]);
const FORBIDDEN_MUTATION_TAP_TEXT = [
  'Sair da conta',
  'Excluir conta',
  'Salvar dados',
  'Cadastrar veículo',
  'Adicionar veículo',
  'Selecionar veículo',
  'Remover do perfil',
  'Entrar na waitlist',
  'Continuar envio',
];

function yamlFiles(directory) {
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'))
    .map((entry) => path.join(directory, entry))
    .sort();
}

function inlineRunFlowReferences(source) {
  return [...source.matchAll(/^\s*-?\s*runFlow:[ \t]+([^\s#]+)[ \t]*$/gm)].map(
    (match) => match[1].replace(/^['"]|['"]$/g, ''),
  );
}

function leafLinks(source) {
  return [...source.matchAll(/leafapp:\/\/[A-Za-z0-9_?&=./:%-]+/g)].map(
    (match) => match[0],
  );
}

function tappedIds(source) {
  return [...source.matchAll(/-\s+tapOn:\s*\n\s+id:\s*["']?([^"'\n]+)["']?/g)].map(
    (match) => match[1].trim(),
  );
}

function tappedText(source) {
  return [...source.matchAll(/-\s+tapOn:\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
}

describe('current Maestro acceptance isolation', () => {
  it('routes default acceptance commands only to the current suite', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(MOBILE_ROOT, 'package.json'), 'utf8'),
    );

    expect(packageJson.scripts['test:e2e']).toBe(
      'maestro test .maestro/flows/current',
    );
    expect(packageJson.scripts['test:e2e:debug']).toBe(
      'maestro test .maestro/flows/current --debug',
    );
    expect(packageJson.scripts['test:e2e']).not.toBe(
      'maestro test .maestro/flows',
    );
    expect(packageJson.scripts['test:e2e:legacy']).toBe(
      'maestro test .maestro/flows',
    );
    expect(packageJson.scripts['test:e2e:legacy:debug']).toBe(
      'maestro test .maestro/flows --debug',
    );
  });

  it('keeps every current entry and direct dependency free from legacy surfaces', () => {
    const entries = yamlFiles(CURRENT_SUITE_DIR);
    expect(entries.length).toBeGreaterThan(0);

    entries.forEach((entryPath) => {
      const source = fs.readFileSync(entryPath, 'utf8');
      expect(source).toContain('CURRENT_PRODUCT_ONLY');
      expect(source).toContain('leafapp://robotaxi/home');
      expect(source).not.toContain(LEGACY_MARKER);
      FORBIDDEN_CURRENT_LINKS.forEach((link) => {
        expect(source).not.toContain(link);
      });

      inlineRunFlowReferences(source).forEach((reference) => {
        const dependencyPath = path.resolve(path.dirname(entryPath), reference);
        expect(fs.existsSync(dependencyPath)).toBe(true);
        const dependency = fs.readFileSync(dependencyPath, 'utf8');
        expect(dependency).not.toContain(LEGACY_MARKER);
        FORBIDDEN_CURRENT_LINKS.forEach((link) => {
          expect(dependency).not.toContain(link);
        });
      });
    });
  });

  it('keeps every explicitly tagged legacy compatibility flow outside current', () => {
    const flowsRoot = path.join(MOBILE_ROOT, '.maestro', 'flows');
    const stack = [flowsRoot];
    const taggedLegacyFlows = [];

    while (stack.length) {
      const current = stack.pop();
      const stat = fs.statSync(current);
      if (stat.isDirectory()) {
        fs.readdirSync(current).forEach((entry) => {
          stack.push(path.join(current, entry));
        });
        continue;
      }
      if (!current.endsWith('.yaml') && !current.endsWith('.yml')) continue;
      if (fs.readFileSync(current, 'utf8').includes(LEGACY_MARKER)) {
        taggedLegacyFlows.push(current);
      }
    }

    expect(taggedLegacyFlows.length).toBeGreaterThan(0);
    taggedLegacyFlows.forEach((legacyPath) => {
      expect(legacyPath.startsWith(`${CURRENT_SUITE_DIR}${path.sep}`)).toBe(false);
    });
  });
});

describe('CURRENT menu runners', () => {
  const runners = [
    {
      file: '01-passenger-dedicated-device.yaml',
      roleTag: 'passenger',
      homeTestId: 'passenger-home-destination-input',
      menuItemIds: [
        'robotaxi-menu-item-edit-profile',
        'robotaxi-menu-item-trip-history',
        'robotaxi-menu-item-privacy-account-deletion',
        'robotaxi-menu-item-settings',
        'robotaxi-menu-item-help',
      ],
      honestErrorIds: ['robotaxi-profile-error'],
    },
    {
      file: '02-driver-dedicated-device.yaml',
      roleTag: 'driver',
      homeTestId: 'driver-home-toggle-online',
      menuItemIds: [
        'robotaxi-menu-item-driver-earnings',
        'robotaxi-menu-item-driver-history',
        'robotaxi-menu-item-driver-activation',
        'robotaxi-menu-item-driver-documents',
        'robotaxi-menu-item-driver-vehicles',
        'robotaxi-menu-item-driver-waitlist-invites',
        'robotaxi-menu-item-edit-profile',
        'robotaxi-menu-item-privacy-account-deletion',
        'robotaxi-menu-item-settings',
        'robotaxi-menu-item-help',
      ],
      honestErrorIds: [
        'robotaxi-profile-error',
        'robotaxi-vehicles-error',
        'robotaxi-driver-waitlist-unavailable-state',
      ],
    },
  ];

  it('keeps passenger and driver audits in separate dedicated-device flows', () => {
    expect(yamlFiles(CURRENT_MENU_RUNNER_DIR).map(file => path.basename(file))).toEqual(
      runners.map(runner => runner.file),
    );

    runners.forEach((runner) => {
      const source = fs.readFileSync(path.join(CURRENT_MENU_RUNNER_DIR, runner.file), 'utf8');

      expect(source).toContain('CURRENT_PRODUCT_ONLY');
      expect(source).toContain(`  - ${runner.roleTag}`);
      expect(source).toContain('  - dedicated-device');
      expect(source).toContain(`id: "${runner.homeTestId}"`);
      expect(source).toContain('id: "prototype-top-right-control"');
      expect(leafLinks(source)).toEqual([CURRENT_HOME_LINK]);
      expect(inlineRunFlowReferences(source)).toEqual([]);

      runner.menuItemIds.forEach((testId) => {
        expect(source).toContain(`id: "${testId}"`);
      });
      runner.honestErrorIds.forEach((testId) => {
        expect(source).toContain(`id: "${testId}"`);
      });
    });
  });

  it('forbids legacy routes, sub-surface deep links, state seeds, and destructive taps', () => {
    runners.forEach((runner) => {
      const source = fs.readFileSync(path.join(CURRENT_MENU_RUNNER_DIR, runner.file), 'utf8');

      expect(source).not.toContain(LEGACY_MARKER);
      FORBIDDEN_CURRENT_LINKS.forEach((link) => expect(source).not.toContain(link));
      FORBIDDEN_LEGACY_ROUTE_TOKENS.forEach((route) => expect(source).not.toContain(route));
      expect(source).not.toMatch(/\b(?:launchApp|clearState|runScript|evalScript|inputText|eraseText|setLocation)\b/);

      tappedIds(source).forEach((testId) => {
        expect(FORBIDDEN_MUTATION_TARGET_IDS.has(testId)).toBe(false);
      });
      tappedText(source).forEach((label) => {
        expect(FORBIDDEN_MUTATION_TAP_TEXT).not.toContain(label);
      });
    });
  });

  it('keeps disabled and out-of-pilot entries out of CURRENT runner navigation', () => {
    runners.forEach((runner) => {
      const source = fs.readFileSync(path.join(CURRENT_MENU_RUNNER_DIR, runner.file), 'utf8');

      expect(source).not.toContain('robotaxi-menu-item-passenger-invites');
      expect(source).not.toContain('tapOn: "Em breve"');
      expect(source).not.toContain('tapOn: "Fora do piloto"');
    });
  });
});
