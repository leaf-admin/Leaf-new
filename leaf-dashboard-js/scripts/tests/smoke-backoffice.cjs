#!/usr/bin/env node

const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { chromium } = require("playwright");

const dashboardRoot = path.resolve(__dirname, "..", "..");
const forbiddenPaidHosts = [
  "googleapis.com",
  "maps.googleapis.com",
  "maps.gstatic.com",
  "firebaseio.com",
  "firebase.googleapis.com",
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "woovi.com",
  "api.woovi.com",
  "openpix.com.br",
  "api.openpix.com.br",
];

const adminUser = {
  id: "smoke-admin",
  uid: "smoke-admin",
  name: "Leaf Smoke Admin",
  email: "smoke@leaf.app.br",
  role: "super-admin",
  permissions: ["*"],
};

const routes = [
  { path: "/dashboard", heading: "Operação diária" },
  { path: "/support", heading: "Suporte" },
  { path: "/campaign-center", heading: "Campanhas in-app" },
  { path: "/drivers/review-queue", heading: "Fila de Revisão de Documentos" },
  { path: "/financial-reconciliation", heading: "Reconciliação financeira" },
  { path: "/runtime-flags", heading: "Perfil de pagamento" },
];

function log(message) {
  process.stdout.write(`[backoffice-smoke] ${message}\n`);
}

function basicHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function waitForServer(url, authorization, timeoutMs = 60000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(
        url,
        {
          headers: {
            Authorization: authorization,
          },
        },
        (response) => {
          response.resume();
          if (response.statusCode >= 200 && response.statusCode < 500) {
            resolve();
            return;
          }
          retry();
        },
      );
      request.on("error", retry);
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Dashboard did not start within ${timeoutMs}ms`));
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
}

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function commandCenterFixture() {
  return {
    success: true,
    status: "healthy",
    generatedAt: new Date().toISOString(),
    scope: { ttlSeconds: 30 },
    cache: { status: "fresh", ageSeconds: 2 },
    dailyMetrics: {
      activeDrivers: 3,
      totalDrivers: 42,
      activeRides: 1,
      completedRidesToday: 7,
      gmvCents: 128000,
      averageRideTicketCents: 18285,
      grossRevenueCents: 9900,
      arpuBaseCents: 235,
      paymentPendingCount: 0,
    },
    paymentRuntime: {
      defaultEnvironment: "sandbox",
      globalSandboxEnabled: false,
      canarySandboxEnabled: true,
      sandboxProfileCount: 1,
    },
    costControls: {
      externalPaidApisCalled: false,
      dashboardFanOutReduced: true,
      firestoreReadGuard: {
        budgetStatus: "ok",
        dailyEstimatedFirestoreReads: 120,
        dailyBudgetReads: 10000,
        budgetUsagePercent: 1.2,
        dailyEstimatedUsd: 0.0007,
        routeKey: "ops-command-center",
        estimatedFirestoreReads: 8,
      },
      rideCostAnomaly: {
        status: "healthy",
        averageBrl: 0.08,
        averageGoogleBrl: 0.04,
        directionsPerRide: 1.8,
        maxBrl: 0.15,
        aboveWarningCount: 0,
        aboveCriticalCount: 0,
        completedRides: 7,
        warningThreshold: 0.2,
        criticalThreshold: 0.3,
        directionsWarningPerRide: 2.2,
        directionsCriticalPerRide: 3,
        generatedAt: new Date().toISOString(),
      },
      skuMonitor: {
        generatedAt: new Date().toISOString(),
        status: "healthy",
        sampledRides: 7,
        windowSize: 20,
        completedRidesToday: 7,
        exchangeRateUsdBrl: 5.18,
        rows: [
          {
            id: "google.directionsLegacy",
            provider: "Google Maps",
            family: "google",
            sku: "Directions/Routes",
            unitLabel: "request",
            accounting: "infra",
            detail: "Custo variável de mapa/places/routes capturado pela telemetria da corrida.",
            usage: 14,
            billableUnits: 14,
            unitCostBrl: 0.0259,
            totalCostBrl: 0.0518,
            totalCostCents: 5,
            projectedTodayBrl: 0.0518,
            projectedTodayCents: 5
          },
          {
            id: "woovi.pix-charge",
            provider: "Woovi",
            family: "woovi",
            sku: "Cobrança PIX",
            unitLabel: "cobrança",
            accounting: "payment_processor",
            detail: "Separado da infra",
            usage: 7,
            billableUnits: 7,
            unitCostBrl: 0.0,
            totalCostBrl: 0.0,
            totalCostCents: 0,
            projectedTodayBrl: 0.0,
            projectedTodayCents: 0
          }
        ],
        totals: {
          totalCostBrl: 0.0518,
          totalCostWithoutWooviBrl: 0.0518,
          wooviCostBrl: 0
        },
        finance: {
          operationalFeeTotalCents: 990,
          operationalFeeAverageCents: 141,
          variableCostPerRideCents: 1,
          variableCostWithoutWooviPerRideCents: 1,
          wooviCostPerRideCents: 0,
          projectedCostTodayCents: 7,
          projectedCostWithoutWooviTodayCents: 7,
          projectedWooviTodayCents: 0,
          fixedInfraDailyCents: 0,
          netAfterInfraCents: 983,
          netAfterAllCents: 983,
          marginAfterInfraPercent: 99.29,
          costRatioPercent: 0.71
        }
      },
    },
    services: {
      domainHealth: [
        { domain: "API", status: "healthy", detail: "smoke fixture" },
        { domain: "Socket", status: "healthy", detail: "smoke fixture" },
        { domain: "Woovi", status: "healthy", detail: "sandbox" },
      ],
      sources: [
        { name: "command-center", status: "cached", cost: "free" },
      ],
    },
    actionItems: [
      { label: "Operação pronta", status: "ready", detail: "Smoke sem fan-out pago" },
    ],
    canaryPack: {
      paymentEnvironment: "sandbox",
      users: [
        { role: "passageiro", phone: "+5521992000001" },
        { role: "motorista", phone: "+5521992000002" },
      ],
      checklist: ["login", "categoria", "pix sandbox", "dashboard"],
    },
    support: {
      openTickets: 1,
      unreadChats: 1,
    },
    campaigns: {
      active: 1,
      impressions: 12,
      clicks: 2,
    },
    driverOnboarding: {
      totalDocuments: 2,
      pendingDocuments: 1,
      approvedDocuments: 1,
      rejectedDocuments: 0,
      reviewQueueSource: "smoke",
    },
    finance: {
      reconciliationStatus: "healthy",
      divergentReports: 0,
    },
  };
}

function runtimeFlagsFixture() {
  return {
    success: true,
    environment: "smoke",
    launch: {
      launchProfile: "smoke",
      adminMutationsEnabled: false,
      referralProgramsEnabled: true,
    },
    paymentRuntime: {
      provider: "woovi",
      environment: "sandbox",
    },
  };
}

function fixtureForApiPath(apiPath, method) {
  if (apiPath === "/admin/auth/verify") return json({ success: true, user: adminUser });
  if (apiPath === "/admin/auth/login") {
    return json({
      success: true,
      accessToken: "smoke-access-token",
      refreshToken: "smoke-refresh-token",
      expiresIn: "1h",
      user: adminUser,
    });
  }
  if (apiPath === "/admin/auth/refresh") {
    return json({ success: true, accessToken: "smoke-access-token-2", expiresIn: "1h" });
  }
  if (apiPath === "/admin/auth/logout") return json({ success: true });
  if (apiPath === "/health/runtime-flags") return json(runtimeFlagsFixture());
  if (apiPath.startsWith("/ops/command-center")) return json(commandCenterFixture());

  if (apiPath.startsWith("/support/chat/inbox")) {
    return json({
      success: true,
      chats: [
        {
          userId: "user-smoke",
          userName: "Passageiro Smoke",
          preview: "Preciso de ajuda com minha corrida",
          unreadCount: 1,
          updatedAt: new Date().toISOString(),
          status: "open",
        },
      ],
    });
  }
  if (apiPath.includes("/support/chat/") && apiPath.endsWith("/history")) {
    return json({
      success: true,
      messages: [
        {
          id: "msg-smoke-1",
          senderType: "user",
          message: "Preciso de ajuda com minha corrida",
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }
  if (apiPath.includes("/support/chat/") && apiPath.endsWith("/status")) {
    return json({ success: true, status: { status: "open", tier: "N0" } });
  }
  if (apiPath.includes("/support/chat/") && method !== "GET") return json({ success: true });
  if (apiPath.startsWith("/support/admin/tickets") || apiPath.startsWith("/support/tickets")) {
    return json({
      success: true,
      tickets: [],
      messages: [],
      pagination: { page: 1, limit: 25, total: 0, pages: 0 },
    });
  }
  if (apiPath.startsWith("/support/queue/summary")) {
    return json({
      success: true,
      summary: {
        totalOpenTickets: 0,
        n1: 0,
        n2: 0,
        n3: 0,
        overdueAckCount: 0,
        ticketsWithoutOwner: 0,
        medianFirstResponseMinutes: 0,
      },
    });
  }
  if (apiPath.startsWith("/support/queue/backlog")) {
    return json({ success: true, backlog: [] });
  }
  if (apiPath.startsWith("/support-orchestrator/v1/status")) {
    return json({ success: true, status: "disabled", mode: "copilot" });
  }
  if (apiPath.startsWith("/support-orchestrator/v1/runs")) {
    return json({ success: true, runs: [] });
  }
  if (apiPath.startsWith("/audit/logs")) {
    return json({ success: true, logs: [], pagination: { total: 0 } });
  }

  if (apiPath.startsWith("/campaign-center/campaigns")) {
    return json({ success: true, campaigns: [], pagination: { page: 1, total: 0, pages: 0 } });
  }
  if (apiPath.startsWith("/campaign-center/commercial-report")) {
    return json({
      success: true,
      report: {
        totals: { impressions: 0, clicks: 0, conversions: 0, contractedValueBRL: 0 },
        campaigns: [],
      },
    });
  }
  if (apiPath.startsWith("/campaign-center/stats")) {
    return json({ success: true, stats: { total: 0, active: 0, impressions: 0, clicks: 0 } });
  }
  if (apiPath.startsWith("/campaign-center/slots")) {
    return json({ success: true, slots: [] });
  }

  if (apiPath.startsWith("/drivers/documents/review-queue")) {
    return json({
      success: true,
      items: [],
      summary: { total: 0, byStatus: { pending: 0, approved: 0, rejected: 0 } },
      pagination: { page: 1, limit: 25, total: 0, pages: 0 },
    });
  }

  if (apiPath.startsWith("/financial/reconciliation/reports")) {
    return json({
      success: true,
      reports: [],
      summary: { totalInPage: 0, divergentCount: 0, okCount: 0, issueCount: 0 },
    });
  }
  if (apiPath.startsWith("/financial/reconciliation")) {
    return json({ success: true, report: null, issues: [] });
  }

  if (apiPath.startsWith("/payment/runtime-profiles/resolve")) {
    return json({ success: true, profile: { environment: "sandbox", reason: "smoke" } });
  }
  if (apiPath.startsWith("/payment/runtime-profiles")) {
    return json({ success: true, profiles: [] });
  }

  return json({
    success: true,
    data: [],
    items: [],
    users: [],
    drivers: [],
    tickets: [],
    reports: [],
    summary: {},
  });
}

async function installRoutes(context, observed) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const host = url.hostname.toLowerCase();

    if (forbiddenPaidHosts.some((forbidden) => host === forbidden || host.endsWith(`.${forbidden}`))) {
      observed.forbiddenRequests.push(request.url());
      await route.abort("blockedbyclient");
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      const apiPath = url.pathname.replace(/^\/api/, "") || "/";
      await route.fulfill(fixtureForApiPath(apiPath, request.method()));
      return;
    }

    await route.continue();
  });
}

async function assertVisibleHeading(page, routeConfig) {
  await page.goto(routeConfig.path, { waitUntil: "domcontentloaded" });
  await page.locator("h1", { hasText: routeConfig.heading }).waitFor({ timeout: 15000 });
  const bodyText = await page.locator("body").innerText({ timeout: 5000 });
  if (/Application error|Unhandled Runtime Error|Internal Server Error/i.test(bodyText)) {
    throw new Error(`${routeConfig.path} rendered an application error`);
  }
  log(`${routeConfig.path} ok`);
}

async function main() {
  const port = await getFreePort();
  const baseURL = `http://localhost:${port}`;
  const basicUser = "leaf-smoke";
  const basicPassword = "leaf-smoke-password";
  const authorization = basicHeader(basicUser, basicPassword);

  const server = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--hostname", "localhost", "--port", String(port)],
    {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        DASHBOARD_BASIC_AUTH_ENABLED: "true",
        DASHBOARD_BASIC_AUTH_USER: basicUser,
        DASHBOARD_BASIC_AUTH_PASSWORD: basicPassword,
        NEXT_PUBLIC_API_URL: `${baseURL}/api`,
        NEXT_PUBLIC_WS_URL: baseURL,
        NEXT_PUBLIC_WS_TRANSPORTS: "websocket",
        NEXT_PUBLIC_SUPPORT_ORCHESTRATOR_ENABLED: "true",
        NEXT_PUBLIC_SUPPORT_ORCHESTRATOR_URL: `${baseURL}/api/support-orchestrator`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const serverOutput = [];
  server.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  try {
    await waitForServer(`${baseURL}/login`, authorization);
    log(`dashboard ready at ${baseURL}`);

    const noAuthResponse = await fetch(`${baseURL}/dashboard`);
    if (noAuthResponse.status !== 401) {
      throw new Error(`Expected basic auth 401 without credentials, received ${noAuthResponse.status}`);
    }
    log("basic auth blocks unauthenticated access");

    browser = await chromium.launch({ headless: true });

    const unauthContext = await browser.newContext({
      baseURL,
      httpCredentials: { username: basicUser, password: basicPassword },
    });
    const unauthObserved = { forbiddenRequests: [] };
    await installRoutes(unauthContext, unauthObserved);
    const unauthPage = await unauthContext.newPage();
    await unauthPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await unauthPage.getByRole("heading", { name: "Leaf Dashboard" }).waitFor({ timeout: 15000 });
    await unauthContext.close();
    log("protected app routes redirect to login without admin session");

    const context = await browser.newContext({
      baseURL,
      httpCredentials: { username: basicUser, password: basicPassword },
    });
    await context.addInitScript((user) => {
      window.sessionStorage.setItem("leaf_admin_access_token", "smoke-access-token");
      window.sessionStorage.setItem("leaf_admin_refresh_token", "smoke-refresh-token");
      window.sessionStorage.setItem("leaf_admin_user", JSON.stringify(user));
    }, adminUser);

    const observed = { forbiddenRequests: [] };
    const pageErrors = [];
    await installRoutes(context, observed);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));

    for (const routeConfig of routes) {
      await assertVisibleHeading(page, routeConfig);
    }

    await page.getByRole("link", { name: "Suporte" }).first().click();
    await page.locator("h1", { hasText: "Suporte" }).waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: "Campanhas" }).first().click();
    await page.locator("h1", { hasText: "Campanhas in-app" }).waitFor({ timeout: 15000 });
    log("top navigation between core areas ok");

    await context.close();

    if (observed.forbiddenRequests.length || unauthObserved.forbiddenRequests.length) {
      throw new Error(
        `Dashboard attempted paid provider calls: ${[
          ...observed.forbiddenRequests,
          ...unauthObserved.forbiddenRequests,
        ].join(", ")}`,
      );
    }
    if (pageErrors.length) {
      throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);
    }

    log("no direct browser calls to Google, Woovi/OpenPix, or Firebase providers");
    log("smoke passed");
  } catch (error) {
    const tail = serverOutput.join("").split("\n").slice(-80).join("\n");
    if (tail) {
      process.stderr.write(`\n[backoffice-smoke] server output tail:\n${tail}\n`);
    }
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  process.stderr.write(`[backoffice-smoke] failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
