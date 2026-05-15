#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const NAVIGATOR_FILE = path.join(ROOT, 'src/navigation/AppNavigator.js');
const MAESTRO_DIR = path.join(ROOT, '.maestro/flows');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUTPUT_MD = path.join(DOCS_DIR, 'QA_FLOW_INVENTORY.md');
const OUTPUT_JSON = path.join(DOCS_DIR, 'qa-flow-inventory.json');

const RELEASE_PRECONDITIONS = [
  'Executar somente build release instalado (`br.com.leaf.ride`), sem Expo Go/dev-client como alvo.',
  'Backend deve responder `/health/runtime-flags` com `realSandbox.ready=true`.',
  'Não usar payment mock, PaymentBypassService, E2E_TEST=true ou qualquer bypass de pagamento.',
  'Motorista deve estar online e elegível antes de qualquer flow de solicitação do passageiro.',
  'Evidências por rodada devem incluir JUnit XML, logs Maestro, screenshots e snapshot de runtime flags.',
];

const RELEASE_AREAS = [
  {
    id: 'passenger_signup',
    label: 'Cadastro passageiro',
    requiredRoles: ['passenger'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('signup') && flow.roles.includes('passenger');
    },
  },
  {
    id: 'driver_signup',
    label: 'Cadastro motorista',
    requiredRoles: ['driver'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('signup') && flow.roles.includes('driver');
    },
  },
  {
    id: 'login',
    label: 'Login passageiro/motorista',
    requiredRoles: ['passenger', 'driver'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('login');
    },
  },
  {
    id: 'driver_online',
    label: 'Motorista online antes da solicitação',
    requiredRoles: ['driver'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('driver-online');
    },
  },
  {
    id: 'request_ride',
    label: 'Passageiro solicita corrida',
    requiredRoles: ['passenger'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('request-ride');
    },
  },
  {
    id: 'driver_accept',
    label: 'Motorista aceita corrida',
    requiredRoles: ['driver'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('accept-ride');
    },
  },
  {
    id: 'navigation',
    label: 'Navegação passageiro/motorista',
    requiredRoles: ['passenger', 'driver'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('navigation');
    },
  },
  {
    id: 'chat',
    label: 'Chat em corrida ativa',
    requiredRoles: ['passenger', 'driver'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('chat');
    },
  },
  {
    id: 'support',
    label: 'Suporte/ticket',
    requiredRoles: ['passenger'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('support');
    },
  },
  {
    id: 'rating',
    label: 'Avaliação pós-corrida',
    requiredRoles: ['passenger', 'driver'],
    requiredPlatforms: ['android', 'ios'],
    match(flow) {
      return flow.capabilities.includes('rating');
    },
  },
];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function collectFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.yaml')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function routeCategory(routeName) {
  const key = routeName.toLowerCase();
  if (/auth|login|otp|registration|welcome|profileselection|driverterms|cnh|crlv|baas|referral|freetrial|plan/.test(key)) {
    return 'auth-onboarding';
  }
  if (/map|bookedcab|trip|ride|receipt|cancellation|feedback|complain|payment/.test(key)) {
    return 'ride-lifecycle';
  }
  if (/driver|vehicle|earnings|weeklypayment|woovidriverbalance/.test(key)) {
    return 'driver-ops';
  }
  if (/wallet|addmoney|withdrawmoney|paymentdetails|addpaymentmethod/.test(key)) {
    return 'wallet-finance';
  }
  if (/settings|help|about|legal|privacy|support|profile|editprofile|notifications|search|chat|messages/.test(key)) {
    return 'account-support';
  }
  if (/robotaxi|prototype/.test(key)) {
    return 'prototype';
  }
  return 'other';
}

function flowCategory(flowPath) {
  const key = flowPath.replace(/\\/g, '/');
  if (key.includes('/auth/')) return 'auth-onboarding';
  if (key.includes('/rides/')) return 'ride-lifecycle';
  if (key.includes('/payments/')) return 'wallet-finance';
  if (key.includes('/driver/')) return 'driver-ops';
  if (key.includes('/qa/e2e/lifecycle/')) return 'ride-lifecycle';
  if (key.includes('/qa/e2e/wave4/')) return 'ride-lifecycle';
  if (key.includes('/qa/e2e/ideal/')) return 'ride-lifecycle';
  if (key.includes('/qa/e2e/')) return 'e2e-core';
  if (key.includes('/qa/')) return 'qa-auxiliary';
  return 'other';
}

function unique(values) {
  return [...new Set(values)].sort();
}

function detectPlatforms(relPath, text) {
  const key = `${relPath}\n${text}`.toLowerCase();
  const pathKey = relPath.toLowerCase();
  if (pathKey.includes('ios') || key.includes('iphonesimulator') || key.includes('xcrun')) return ['ios'];
  if (pathKey.includes('android') || key.includes('adb')) return ['android'];
  return ['android', 'ios'];
}

function detectRoles(relPath, text) {
  const key = `${relPath}\n${text}`.toLowerCase();
  const roles = [];
  if (/passenger|customer|passageiro|viajar|robotaxiprototype|passenger-/.test(key)) roles.push('passenger');
  if (/driver|motorista|parceiro|driver-/.test(key)) roles.push('driver');
  if (roles.length === 0) roles.push('unknown');
  return unique(roles);
}

function detectCapabilities(relPath, text) {
  const key = `${relPath}\n${text}`.toLowerCase();
  const pathKey = relPath.toLowerCase();
  const caps = [];
  if (/signup|cadastro|registration|cnh|crlv/.test(pathKey)) {
    caps.push('signup');
  }
  if (/\/auth\/|login|otp|phone/.test(pathKey) || /auth-phone-input|auth-otp|auth-password|login/.test(key)) {
    caps.push('login');
  }
  if (/driver.*online|ficar online|toggle-online|set_online/.test(key)) caps.push('driver-online');
  if (/request.*ride|solicitar|destination|booking-request|create-booking|procurando motorista/.test(key)) caps.push('request-ride');
  if (/accept.*offer|accept.*ride|driver-live-offer-accept|accept_offer/.test(key)) caps.push('accept-ride');
  if (/arriv|pickup|start-trip|start_trip/.test(key)) caps.push('trip-progress');
  if (/complete-trip|complete_trip|receipt|recibo/.test(key)) caps.push('complete-ride');
  if (/navigation|navega|earnings|menu|history|settings/.test(key)) caps.push('navigation');
  if (/chat|message|mensage/.test(key)) caps.push('chat');
  if (/support|suporte|ticket/.test(pathKey) || /robotaxi-support|support-open|abrir ticket|falar com suporte/.test(key)) {
    caps.push('support');
  }
  if (/rating|rate-trip|rate-passenger/.test(pathKey) || /passenger-rating|driver-rating|rate-passenger/.test(key)) {
    caps.push('rating');
  }
  if (/payment|pix|pagamento/.test(key)) caps.push('payment');
  if (caps.length === 0) caps.push('smoke');
  return unique(caps);
}

function detectReleaseBlockers(text) {
  const blockers = [];
  if (!/appId:\s*br\.com\.leaf\.ride/.test(text)) blockers.push('missing-release-app-id');
  if (/payment[-_\s]?bypass|PaymentBypassService|(?:EXPO_PUBLIC_)?E2E_TEST\s*[:=]\s*"?true/i.test(text)) {
    blockers.push('payment-bypass-marker');
  }
  if (/mockPayment|paymentMock|mock-payment|pagamento.*mock|mock.*pagamento/i.test(text)) {
    blockers.push('payment-mock-marker');
  }
  if (/MAESTRO_METRO_URL|DEVELOPMENT SERVERS|No development servers found|Sign in to view updates|Connected to:|Enter URL manually|10\.0\.2\.2:8081|localhost:8081|:8082/i.test(text)) {
    blockers.push('dev-server-marker');
  }
  return unique(blockers);
}

function expectedEvidence(flow) {
  const slug = path.basename(flow.path, '.yaml');
  const evidence = [`junit:${slug}.xml`, `log:${slug}.log`];
  if (flow.hasScreenshots) evidence.push('screenshots:takeScreenshot outputs');
  if (flow.capabilities.includes('request-ride') || flow.capabilities.includes('payment')) {
    evidence.push('backend-runtime-flags.json');
  }
  if (flow.capabilities.includes('driver-online')) evidence.push('driver-online screenshot/runtime state');
  return evidence;
}

function buildCoverageMatrix(flows) {
  return RELEASE_AREAS.map((area) => {
    const candidates = flows.filter((flow) => flow.releaseOnly && area.match(flow));
    const platformCoverage = Object.fromEntries(
      area.requiredPlatforms.map((platform) => [
        platform,
        candidates.some((flow) => flow.platforms.includes(platform)),
      ])
    );
    const roleCoverage = Object.fromEntries(
      area.requiredRoles.map((role) => [
        role,
        candidates.some((flow) => flow.roles.includes(role)),
      ])
    );
    const missing = [];
    for (const [platform, ok] of Object.entries(platformCoverage)) {
      if (!ok) missing.push(`platform:${platform}`);
    }
    for (const [role, ok] of Object.entries(roleCoverage)) {
      if (!ok) missing.push(`role:${role}`);
    }
    return {
      id: area.id,
      label: area.label,
      status: missing.length === 0 ? 'GO' : 'GAP',
      missing,
      flows: candidates.map((flow) => flow.path),
    };
  });
}

function shouldIncludeFlow(flowPath) {
  const rel = path.relative(ROOT, flowPath).replace(/\\/g, '/');
  const base = path.basename(rel);
  if (base.startsWith('_')) return false;
  if (rel.includes('/qa/_debug')) return false;
  return true;
}

function extractRoutes() {
  const text = readText(NAVIGATOR_FILE);
  const regex = /<Stack\.Screen\s+name="([^"]+)"/g;
  const seen = new Set();
  const routes = [];
  let match;
  while ((match = regex.exec(text))) {
    const route = match[1];
    if (seen.has(route)) continue;
    seen.add(route);
    routes.push({
      name: route,
      category: routeCategory(route),
    });
  }
  return routes.sort((a, b) => a.name.localeCompare(b.name));
}

function extractFlows() {
  const files = collectFiles(MAESTRO_DIR).filter(shouldIncludeFlow);
  return files
    .map((filePath) => {
      const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
      const text = readText(filePath);
      const releaseBlockers = detectReleaseBlockers(text);
      const flow = {
        path: rel,
        category: flowCategory(rel),
        platforms: detectPlatforms(rel, text),
        roles: detectRoles(rel, text),
        capabilities: detectCapabilities(rel, text),
        releaseBlockers,
        releaseOnly: releaseBlockers.length === 0,
        hasScreenshots: /takeScreenshot/.test(text),
      };
      flow.expectedEvidence = expectedEvidence(flow);
      return {
        ...flow,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function groupByCategory(items, keyField = 'category') {
  return items.reduce((acc, item) => {
    const key = item[keyField];
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function toNumberedList(items, valueFn) {
  return items.map((item, idx) => `${idx + 1}. ${valueFn(item)}`).join('\n');
}

function buildMarkdown(routes, flows, coverageMatrix) {
  const routesByCategory = groupByCategory(routes);
  const flowsByCategory = groupByCategory(flows);
  const categories = [
    'auth-onboarding',
    'ride-lifecycle',
    'driver-ops',
    'wallet-finance',
    'account-support',
    'prototype',
    'e2e-core',
    'qa-auxiliary',
    'other',
  ];

  const lines = [];
  lines.push('# QA Flow Inventory');
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Total navigation routes: ${routes.length}`);
  lines.push(`Total maestro flows (non-debug): ${flows.length}`);
  lines.push(`Release-only eligible flows: ${flows.filter((flow) => flow.releaseOnly).length}`);
  lines.push('');
  lines.push('## Release Preconditions');
  lines.push('');
  lines.push(toNumberedList(RELEASE_PRECONDITIONS, (item) => item));
  lines.push('');
  lines.push('## Release Coverage Matrix');
  lines.push('');
  lines.push('| Area | Status | Release-only flows | Gaps |');
  lines.push('|---|---|---:|---|');
  for (const row of coverageMatrix) {
    lines.push(`| ${row.label} | ${row.status} | ${row.flows.length} | ${row.missing.join(', ') || '-'} |`);
  }
  lines.push('');
  lines.push('## Product Routes (One By One)');
  lines.push('');
  lines.push(toNumberedList(routes, (route) => `\`${route.name}\` (${route.category})`));
  lines.push('');
  lines.push('## Maestro Flows (One By One)');
  lines.push('');
  lines.push(toNumberedList(flows, (flow) => {
    const release = flow.releaseOnly ? 'release-only' : `blocked: ${flow.releaseBlockers.join(', ')}`;
    return `\`${flow.path}\` (${flow.category}; ${flow.platforms.join('/')}; ${flow.roles.join('/')}; ${flow.capabilities.join(', ')}; ${release})`;
  }));
  lines.push('');
  lines.push('## Category Breakdown');
  lines.push('');
  lines.push('| Category | Product Routes | Maestro Flows |');
  lines.push('|---|---:|---:|');
  for (const category of categories) {
    const routeCount = (routesByCategory[category] || []).length;
    const flowCount = (flowsByCategory[category] || []).length;
    lines.push(`| ${category} | ${routeCount} | ${flowCount} |`);
  }
  lines.push('');
  lines.push('## Execution Notes');
  lines.push('');
  lines.push('1. Route inventory is extracted from `src/navigation/AppNavigator.js`.');
  lines.push('2. Flow inventory is extracted from `.maestro/flows/**/*.yaml` excluding debug/helper flows that start with `_`.');
  lines.push('3. Use `node scripts/qa/generate-flow-inventory.js` from `mobile-app/` to regenerate after navigation or flow changes.');
  lines.push('4. `releaseOnly=false` means the flow still exists, but has a static blocker for release evidence such as dev-server markers or payment mock/bypass markers.');
  lines.push('');

  return lines.join('\n');
}

function main() {
  ensureDir(DOCS_DIR);
  const routes = extractRoutes();
  const flows = extractFlows();
  const coverageMatrix = buildCoverageMatrix(flows);
  const markdown = buildMarkdown(routes, flows, coverageMatrix);
  const json = {
    generatedAt: new Date().toISOString(),
    releasePreconditions: RELEASE_PRECONDITIONS,
    releaseCoverageMatrix: coverageMatrix,
    routes,
    flows,
  };

  fs.writeFileSync(OUTPUT_MD, markdown, 'utf8');
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(json, null, 2), 'utf8');

  process.stdout.write(
    `Generated ${path.relative(ROOT, OUTPUT_MD)} and ${path.relative(ROOT, OUTPUT_JSON)}\n`
  );
}

main();
