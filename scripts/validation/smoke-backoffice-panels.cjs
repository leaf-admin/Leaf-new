#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const DASHBOARD_DIR = path.join(ROOT, 'leaf-dashboard-js');
const PORT = Number(process.env.LEAF_BACKOFFICE_SMOKE_PORT || 3913);
const BASE_URL = process.env.LEAF_BACKOFFICE_SMOKE_URL || `http://127.0.0.1:${PORT}`;
const OUT_DIR = process.env.LEAF_BACKOFFICE_SMOKE_OUT || path.join(ROOT, 'test-results', 'backoffice-smoke');
const BASIC_AUTH_USER = process.env.LEAF_BACKOFFICE_SMOKE_BASIC_USER || process.env.DASHBOARD_BASIC_AUTH_USER || '';
const BASIC_AUTH_PASSWORD = process.env.LEAF_BACKOFFICE_SMOKE_BASIC_PASSWORD || process.env.DASHBOARD_BASIC_AUTH_PASSWORD || '';
const BASIC_AUTH_ENABLED = Boolean(BASIC_AUTH_USER && BASIC_AUTH_PASSWORD);

const adminUser = {
  id: 'smoke-admin',
  name: 'Smoke Admin',
  email: 'smoke@leaf.app.br',
  role: 'development',
  roles: ['development'],
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode || 0));
    });
    request.on('error', reject);
    request.setTimeout(1000, () => {
      request.destroy(new Error('timeout'));
    });
  });
}

async function waitForServer(url, timeoutMs = 45000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await getJson(url);
      if (status >= 200 && status < 500) return;
    } catch (err) {
      lastError = err;
    }
    await wait(750);
  }
  throw new Error(`Dashboard local não respondeu em ${url}: ${lastError?.message || 'timeout'}`);
}

function json(payload) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  };
}

function mockCommandCenter() {
  return {
    status: 'healthy',
    generatedAt: new Date().toISOString(),
    scope: { ttlSeconds: 30 },
    cache: { status: 'hit', ageSeconds: 2 },
    dailyMetrics: {
      activeDrivers: 3,
      activeRides: 1,
      gmvCents: 125000,
      grossRevenueCents: 9900,
      operationalFeeCents: 9900,
      paymentPendingCount: 0,
    },
    paymentRuntime: {
      defaultEnvironment: 'sandbox',
      sandboxProfileCount: 1,
      globalSandboxEnabled: false,
      canarySandboxEnabled: true,
    },
    costControls: {
      externalPaidApisCalled: false,
      dashboardFanOutReduced: true,
      firestoreReadGuard: {
        budgetStatus: 'ok',
        budgetUsagePercent: 12.4,
        readsThisSnapshot: 24,
      },
      skuMonitor: {
        status: 'healthy',
        rows: [],
        totals: {
          estimatedCostBRL: 0.12,
          operationalFeeBRL: 9.9,
          netAfterInfraBRL: 9.78,
        },
      },
    },
    services: {
      domainHealth: [
        { id: 'api', label: 'API', status: 'healthy', action: 'Sem ação', source: 'mock' },
        { id: 'socket', label: 'Socket', status: 'healthy', action: 'Sem ação', source: 'mock' },
      ],
      sources: [
        { id: 'command-center', label: 'Command Center', status: 'ok', durationMs: 18 },
      ],
    },
    support: { openTickets: 1, unreadChats: 1 },
    campaigns: { active: 1, total: 1 },
    driverOnboarding: { pending: 1, approved: 0, rejected: 0 },
    actionItems: [
      { id: 'support', title: 'Responder suporte', description: '1 conversa com mensagem pendente', priority: 'media', href: '/support' },
    ],
    canaryPack: {
      paymentRuntime: {
        defaultEnvironment: 'sandbox',
        sandboxProfileCount: 1,
        canarySandboxEnabled: true,
        href: '/payment-runtime',
      },
      readiness: [
        { id: 'payment', label: 'Pagamento sandbox', status: 'ready', detail: 'Backend controla runtime' },
      ],
      links: [{ label: 'Suporte', href: '/support' }],
      flowSteps: ['Login', 'Destino', 'Pix sandbox', 'Suporte'],
      successCriteria: ['Sem chamada externa paga no browser'],
      failureCriteria: ['Erro visível ou redirect indevido'],
    },
  };
}

function mockCampaigns() {
  return {
    campaigns: [
      {
        id: 'campaign-smoke',
        name: 'Boas-vindas Leaf',
        status: 'active',
        template: 'home_banner_card',
        audience: { roles: ['customer'] },
        surfaces: ['passenger_home'],
        placements: ['below_search_card'],
        content: { title: 'Bem-vindo(a) à Leaf', imageUrl: 'https://leaf.app.br/smoke.png' },
        metrics: { impressions: 1200, clicks: 42 },
        startAt: new Date().toISOString(),
        endAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ],
    stats: { total: 1, active: 1, impressions: 1200, clicks: 42 },
  };
}

function mockCommercialReport() {
  return {
    report: {
      totals: {
        campaignValueCents: 50000,
        ctr: 0.035,
        effectiveCpmCents: 4167,
        effectiveCpcCents: 1190,
      },
      rows: [
        {
          id: 'campaign-smoke',
          name: 'Boas-vindas Leaf',
          advertiser: 'Leaf',
          costModel: 'internal',
          startAt: new Date().toISOString(),
          endAt: new Date(Date.now() + 86400000).toISOString(),
          remainingDays: 1,
          campaignValueCents: 50000,
          impressions: 1200,
          contractedImpressions: 2000,
          clicks: 42,
          contractedClicks: 60,
          ctr: 0.035,
          effectiveCpmCents: 4167,
          soldCpmCents: 4000,
          effectiveCpcCents: 1190,
          soldCpcCents: 1100,
          deliveryProgress: 0.6,
          pacing: 0.9,
        },
      ],
    },
  };
}

function mockRuntimeFlags() {
  return {
    launchFeatureFlags: {
      campaignCenterEnabled: true,
      adminMutationsEnabled: true,
    },
    features: {
      campaignCenterEnabled: true,
      adminMutationsEnabled: true,
    },
  };
}

function responseFor(requestUrl) {
  const url = new URL(requestUrl);
  const pathname = url.pathname.replace(/^\/api/, '') || '/';

  if (pathname === '/admin/auth/verify') return json({ success: true, user: adminUser });
  if (pathname === '/health/runtime-flags') return json(mockRuntimeFlags());
  if (pathname.startsWith('/ops/command-center')) return json(mockCommandCenter());
  if (pathname.startsWith('/campaign-center/campaigns')) return json(mockCampaigns());
  if (pathname.startsWith('/campaign-center/commercial-report')) return json(mockCommercialReport());
  if (pathname.startsWith('/campaign-center/slots')) {
    return json({
      slots: [
        {
          id: 'passenger_home_banner_stack',
          label: 'Passageiro home',
          surface: 'passenger_home',
          placement: 'below_search_card',
          role: 'customer',
          template: 'home_banner_card',
          maxItems: 3,
          autoRotateSeconds: 6,
          dimensions: { heightDp: 188, referenceFramePx: { width: 345, height: 188 }, exportPx: { '@3x': { width: 1035, height: 564 } } },
        },
        {
          id: 'driver_home_banner_stack',
          label: 'Motorista home',
          surface: 'driver_home',
          placement: 'below_home_card',
          role: 'driver',
          template: 'home_banner_card',
          maxItems: 3,
          autoRotateSeconds: 6,
          dimensions: { heightDp: 188, referenceFramePx: { width: 345, height: 188 }, exportPx: { '@3x': { width: 1035, height: 564 } } },
        },
      ],
    });
  }
  if (pathname.startsWith('/drivers/documents/review-queue')) {
    return json({
      data: {
        items: [
          {
            driverId: 'driver-smoke',
            documentType: 'cnh',
            status: 'pending',
            fileName: 'cnh.pdf',
            fileUrl: 'https://leaf.app.br/smoke/cnh.pdf',
            uploadedAt: new Date().toISOString(),
            driver: { name: 'Motorista Smoke', email: 'driver@leaf.app.br', phone: '+5521992000000' },
          },
        ],
        summary: { total: 1, byStatus: { pending: 1, approved: 0, rejected: 0 } },
        pagination: { page: 1, limit: 25, total: 1, pages: 1 },
      },
    });
  }
  if (pathname.startsWith('/support/queue/summary')) {
    return json({ summary: { total: 1, open: 1, byPriority: { N1: 1 } } });
  }
  if (pathname.startsWith('/support/queue/backlog') || pathname.startsWith('/support/admin/tickets') || pathname.startsWith('/support/tickets')) {
    return json({
      tickets: [
        {
          id: 'ticket-smoke',
          userId: 'customer-smoke',
          subject: 'Dúvida sobre corrida',
          description: 'Mensagem de smoke',
          priority: 'N1',
          status: 'open',
          createdAt: new Date().toISOString(),
          user: { name: 'Passageiro Smoke', phone: '+5521992000001' },
        },
      ],
      summary: { total: 1, open: 1 },
    });
  }
  if (pathname.startsWith('/support/chat/inbox')) {
    return json({
      chats: [
        {
          userId: 'customer-smoke',
          userName: 'Passageiro Smoke',
          lastMessage: 'Preciso de ajuda',
          unreadCount: 1,
          updatedAt: new Date().toISOString(),
          status: 'open',
        },
      ],
    });
  }
  if (pathname.includes('/support/chat/') && pathname.endsWith('/history')) {
    return json({ messages: [{ id: 'msg-smoke', text: 'Preciso de ajuda', senderType: 'customer', createdAt: new Date().toISOString() }] });
  }
  if (pathname.includes('/support/chat/') && pathname.endsWith('/status')) {
    return json({ status: { status: 'open' } });
  }
  if (pathname.includes('/support/') && pathname.endsWith('/messages')) {
    return json({ messages: [{ id: 'ticket-msg-smoke', body: 'Mensagem inicial', createdAt: new Date().toISOString() }] });
  }
  if (pathname.startsWith('/audit/logs')) return json({ logs: [] });

  return json({ success: true, data: {}, items: [], rows: [], messages: [] });
}

async function main() {
  ensureDir(OUT_DIR);

  const server = spawn('npm', ['--prefix', DASHBOARD_DIR, 'run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPPORT_ORCHESTRATOR_ENABLED: 'false',
      NEXT_PUBLIC_API_URL: `${BASE_URL}/api`,
      NEXT_PUBLIC_WS_URL: BASE_URL,
      NEXT_PUBLIC_WS_TRANSPORTS: 'polling',
      DASHBOARD_BASIC_AUTH_ENABLED: BASIC_AUTH_ENABLED ? 'true' : 'false',
      DASHBOARD_BASIC_AUTH_USER: BASIC_AUTH_USER,
      DASHBOARD_BASIC_AUTH_PASSWORD: BASIC_AUTH_PASSWORD,
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLog = [];
  server.stdout.on('data', (chunk) => serverLog.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverLog.push(chunk.toString()));

  let browser;
  const results = [];
  const consoleErrors = [];
  const pageErrors = [];

  try {
    await waitForServer(`${BASE_URL}/login`);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      httpCredentials: BASIC_AUTH_ENABLED
        ? { username: BASIC_AUTH_USER, password: BASIC_AUTH_PASSWORD }
        : undefined,
    });
    await context.addInitScript((user) => {
      window.sessionStorage.setItem('leaf_admin_access_token', 'smoke-token');
      window.sessionStorage.setItem('leaf_admin_refresh_token', 'smoke-refresh');
      window.sessionStorage.setItem('leaf_admin_user', JSON.stringify(user));
    }, adminUser);

    await context.route('**/api/**', async (route) => {
      await route.fulfill(responseFor(route.request().url()));
    });
    await context.route('**/socket.io/**', async (route) => {
      await route.fulfill(json({ sid: 'smoke-socket', upgrades: [], pingInterval: 25000, pingTimeout: 20000 }));
    });

    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const pages = [
      { path: '/dashboard', title: 'Operação diária' },
      { path: '/support', title: 'Suporte' },
      { path: '/campaign-center', title: 'Campanhas in-app' },
      { path: '/drivers/review-queue', title: 'Fila de Revisão de Documentos' },
    ];

    for (const target of pages) {
      await page.goto(`${BASE_URL}${target.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
      try {
        await page.locator('main h1').filter({ hasText: target.title }).first().waitFor({ timeout: 15000 });
      } catch (err) {
        const safeName = target.path.replace(/\//g, '_').replace(/^_/, '');
        await page.screenshot({ path: path.join(OUT_DIR, `${safeName}-failure.png`), fullPage: true }).catch(() => null);
        fs.writeFileSync(path.join(OUT_DIR, `${safeName}-failure.html`), await page.content().catch(() => ''));
        throw err;
      }
      const screenshotPath = path.join(OUT_DIR, `${target.path.replace(/\//g, '_').replace(/^_/, '')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const bodyText = await page.locator('body').innerText({ timeout: 5000 });
      results.push({
        path: target.path,
        title: target.title,
        screenshotPath,
        hasGenericError: /Application error|Unhandled Runtime Error|Falha ao carregar campanhas in-app/i.test(bodyText),
      });
    }

    const failed = results.filter((result) => result.hasGenericError);
    const summary = {
      ok: failed.length === 0 && pageErrors.length === 0,
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      results,
      consoleErrors,
      pageErrors,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'server.log'), serverLog.join(''));

    if (!summary.ok) {
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 1;
    } else {
      console.log(`Backoffice smoke PASS: ${OUT_DIR}`);
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    setTimeout(() => {
      if (!server.killed) server.kill('SIGKILL');
    }, 1500).unref();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
