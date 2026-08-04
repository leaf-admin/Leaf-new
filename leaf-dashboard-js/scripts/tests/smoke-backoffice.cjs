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
  { path: "/drivers", heading: "Motoristas" },
  { path: "/drivers/review-queue", heading: "Fila de Revisão de Documentos" },
  { path: "/drivers/smoke-driver/documents", heading: "Documentos do Motorista" },
  { path: "/maps", heading: "Mapas e Geofence" },
  { path: "/metrics", heading: "Métricas" },
  { path: "/metrics/history", heading: "Historico de metricas" },
  { path: "/metrics/marketplace", heading: "Marketplace Health" },
  { path: "/observability", heading: "Console operacional" },
  { path: "/financial-reconciliation", heading: "Reconciliação financeira" },
  { path: "/financial-simulator", heading: "Simulador Financeiro" },
  { path: "/reports", heading: "Relatórios" },
  { path: "/notifications", heading: "Notificações" },
  { path: "/payment-runtime", heading: "Perfil de pagamento" },
  { path: "/programs", heading: "Programas de Convite" },
  { path: "/promotions", heading: "Promoções" },
  { path: "/runtime-flags", heading: "Perfil de pagamento" },
  { path: "/subscriptions", heading: "Assinaturas" },
  { path: "/tolls", heading: "Pedágios" },
  { path: "/users", heading: "Usuarios" },
  { path: "/users/smoke-user", heading: "Detalhes do Usuário" },
  { path: "/waitlist", heading: "Waitlist" },
  { path: "/audit", heading: "Auditoria e acesso" },
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

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    child.once("exit", onExit);
  });
}

function signalServerTree(server, signal) {
  try {
    if (process.platform === "win32") {
      server.kill(signal);
    } else {
      process.kill(-server.pid, signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function stopServerTree(server) {
  const gracefulExit = waitForChildExit(server, 5000);
  signalServerTree(server, "SIGTERM");
  const exitedGracefully = await gracefulExit;

  if (!exitedGracefully) {
    const forcedExit = waitForChildExit(server, 2000);
    signalServerTree(server, "SIGKILL");
    await forcedExit;
  }

  server.stdout?.destroy();
  server.stderr?.destroy();
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

function file(body, contentType, headers = {}) {
  return {
    status: 200,
    contentType,
    headers,
    body,
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

function opsOverviewFixture() {
  return {
    success: true,
    overview: {
      timestamp: new Date().toISOString(),
      scope: { hours: 1, city: null, regionHash: null },
      metrics: {
        rides: {
          requested: 4,
          accepted: 3,
          completed: 2,
          timeToAcceptAvgSec: 7.5,
        },
      },
      rideHealth: {
        reassignmentPending: {
          total: 1,
          stuck: 1,
          oldestAgeMs: 420000,
          oldestBookingId: "booking-reassign-stuck",
          bookingIds: ["booking-reassign-stuck"],
          stuckThresholdMs: 300000,
        },
        earlyEndedReview: {
          total: 1,
          recent: 1,
          oldestAgeMs: 180000,
          oldestBookingId: "booking-review-open",
          bookingIds: ["booking-review-open"],
          recentWindowMs: 3600000,
        },
        driverSignal: {
          total: 2,
          stale: 1,
          oldestAgeMs: 180000,
          oldestBookingId: "booking-signal-stale",
          bookingIds: ["booking-signal-stale"],
          staleThresholdMs: 60000,
        },
      },
      incidents: {
        openCount: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      },
      supportQueue: {
        totalOpenTickets: 1,
        backlogByPriority: { N1: 0, N2: 1, N3: 0 },
        overdueAckCount: 0,
        overdueFirstResponseCount: 0,
        ticketsWithoutOwner: 0,
        criticalBacklogCount: 0,
        medianFirstResponseMinutes: 4,
      },
      disputes: {
        openCount: 0,
        byStatus: {},
      },
      activePolicies: [],
    },
  };
}

function opsAlertsFixture() {
  return {
    success: true,
    alerts: [
      {
        severity: "warning",
        metric: "driver_signal_stale",
        value: 1,
        threshold: 1,
        service: "ride-health-monitor",
        message: "1 corrida ativa sem sinal recente do motorista acima de 1min. Mais antiga: 3min.",
        details: {
          bookingIds: ["booking-signal-stale"],
          oldestBookingId: "booking-signal-stale",
        },
      },
    ],
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

function supportTicketsFixture() {
  const createdAt = new Date().toISOString();
  return [
    {
      id: "ticket-smoke-payment-stuck",
      subject: "Pagamento confirmado, corrida travada",
      description: "Passageiro pagou Pix sandbox e a corrida ficou travada procurando motorista.",
      status: "open",
      priority: "N2",
      category: "payment",
      userId: "user-smoke",
      userType: "customer",
      user: {
        id: "user-smoke",
        name: "Passageiro Smoke",
        email: "smoke-passenger@leaf.app.br",
      },
      createdAt,
      updatedAt: createdAt,
      metadata: {
        bookingId: "booking-smoke-1",
        supportClassification: {
          priority: "N2",
          severity: "elevated",
          computedPriority: "N2",
          requestedPriority: "N3",
          requestedPriorityTrusted: false,
          prioritySource: "classifier",
          reasons: [
            "payment_account_document_or_stuck_flow_keyword",
            "payment_category_minimum",
          ],
        },
        queue: {
          ackTargetAt: createdAt,
          firstResponseTargetAt: createdAt,
        },
      },
      queue: {
        ageMs: 8 * 60 * 1000,
        ackTargetAt: createdAt,
        firstResponseTargetAt: createdAt,
        overdueAck: false,
        overdueFirstResponse: false,
      },
    },
  ];
}

function financialReconciliationReportFixture() {
  const checkedAt = new Date().toISOString();
  return {
    id: "financial-smoke-ride-1",
    rideId: "ride-financial-smoke-1",
    ok: true,
    severity: "info",
    checkedAt,
    checkedAtIso: checkedAt,
    totals: {
      paymentAmountCents: 2750,
      passengerGrossCents: 2750,
      distributionTotalCents: 2750,
      driverNetAmountCents: 2601,
      operationalFeeCents: 84,
      wooviFeeCents: 65,
      ledgerEventCount: 4,
    },
    issues: [],
    source: "backend_final",
  };
}

function financialReconciliationDetailFixture() {
  return {
    success: true,
    report: financialReconciliationReportFixture(),
    ledgerEvents: [
      { id: "evt-payment", type: "payment_captured", amountCents: 2750 },
      { id: "evt-driver", type: "driver_net_reserved", amountCents: 2601 },
      { id: "evt-leaf", type: "leaf_operational_fee_reserved", amountCents: 84 },
      { id: "evt-woovi", type: "woovi_fee_reserved", amountCents: 65 },
    ],
    sourceDocuments: {
      payment: {
        provider: "woovi",
        environment: "sandbox",
        amountCents: 2750,
      },
      staleEstimate: {
        estimatedFareCents: 8000,
        ignoredByReconciliation: true,
      },
      financialSnapshot: {
        financialSnapshotSource: "backend_final",
        authoritativeSnapshot: true,
      },
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
  if (apiPath.startsWith("/ops/overview")) return json(opsOverviewFixture());
  if (apiPath.startsWith("/ops/alerts")) return json(opsAlertsFixture());
  if (apiPath.startsWith("/ops/command-center")) return json(commandCenterFixture());
  if (apiPath.startsWith("/metrics/overview")) {
    return json({
      waitlistCount: 3,
      calculatorSimulations: 2,
      totalUsers: 12,
      totalDrivers: 4,
      totalCustomers: 8,
    });
  }
  if (apiPath.startsWith("/metrics/rides/daily")) {
    return json({
      totalToday: 1,
      completedToday: 1,
      cancelledAfterAcceptance: 0,
      cancellationRate: 0,
      averagePickupMinutes: 4,
      averageWaitMinutes: 2,
      averagePaymentApprovalToPickupMinutes: 3,
    });
  }
  if (apiPath.startsWith("/metrics/financial/rides")) {
    return json({
      totalValue: 27.5,
      averageValue: 27.5,
      totalRides: 1,
      reconciledRides: 1,
      pendingReconciliationRides: 0,
      reserveFundLosses: 0,
    });
  }

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
      tickets: supportTicketsFixture(),
      messages: [],
      pagination: { page: 1, limit: 25, total: 1, pages: 1 },
    });
  }
  if (apiPath.startsWith("/support/queue/summary")) {
    return json({
      success: true,
      summary: {
        totalOpenTickets: 1,
        n1: 0,
        n2: 1,
        n3: 0,
        backlogByPriority: { N1: 0, N2: 1, N3: 0 },
        overdueAckCount: 0,
        ticketsWithoutOwner: 0,
        medianFirstResponseMinutes: 0,
      },
    });
  }
  if (apiPath.startsWith("/support/queue/backlog")) {
    return json({
      success: true,
      tickets: supportTicketsFixture(),
      total: 1,
      hasMore: false,
    });
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
    const report = financialReconciliationReportFixture();
    return json({
      success: true,
      reports: [report],
      summary: {
        totalInPage: 1,
        divergentInPage: 0,
        okInPage: 1,
        totalIssueCount: 0,
        divergentCount: 0,
        okCount: 1,
        issueCount: 0,
      },
    });
  }
  if (apiPath.startsWith("/financial/reconciliation")) {
    return json(financialReconciliationDetailFixture());
  }

  if (apiPath.startsWith("/reports/predefined")) {
    return json({
      success: true,
      reports: [
        {
          id: "smoke-financial-report",
          name: "Relatório financeiro operacional",
          description: "Fixture autenticada do smoke backoffice",
        },
      ],
    });
  }
  if (apiPath.startsWith("/reports/generate/smoke-financial-report")) {
    return file("%PDF-1.4\n% leaf smoke report\n", "application/pdf", {
      "content-disposition": 'attachment; filename="smoke-financial-report.pdf"',
    });
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
      if (observed.apiPaths) {
        observed.apiPaths.push(apiPath);
      }
      if (apiPath.startsWith("/reports/generate/")) {
        observed.reportDownloadAuthorization = request.headers().authorization || "";
      }
      await route.fulfill(fixtureForApiPath(apiPath, request.method()));
      return;
    }

    await route.continue();
  });
}

function assertNoDeprecatedFinancialApiUse(observed) {
  const deprecatedPaths = (observed.apiPaths || []).filter((apiPath) =>
    apiPath === "/metrics/financial" ||
    apiPath.startsWith("/metrics/financial/advanced") ||
    apiPath.startsWith("/metrics/simulation/run")
  );

  if (deprecatedPaths.length) {
    throw new Error(
      `Current dashboard called deprecated financial/simulation endpoints: ${[...new Set(deprecatedPaths)].join(", ")}`,
    );
  }
}

async function assertVisibleHeading(page, routeConfig) {
  await page.goto(routeConfig.path, { waitUntil: "domcontentloaded" });
  const dashboardGeneration = await page.locator("html").getAttribute("data-leaf-dashboard-generation");
  if (dashboardGeneration !== "current-next") {
    throw new Error(
      `${routeConfig.path} did not render the current Next dashboard generation; received ${dashboardGeneration || "missing"}`,
    );
  }
  await page.locator("h1", { hasText: routeConfig.heading }).waitFor({ timeout: 15000 });
  const bodyText = await page.locator("body").innerText({ timeout: 5000 });
  if (/Application error|Unhandled Runtime Error|Internal Server Error/i.test(bodyText)) {
    throw new Error(`${routeConfig.path} rendered an application error`);
  }
  log(`${routeConfig.path} ok`);
}

async function assertFinancialReconciliationContract(page) {
  await page.goto("/financial-reconciliation", { waitUntil: "domcontentloaded" });
  await page.locator("h1", { hasText: "Reconciliação financeira" }).waitFor({ timeout: 15000 });
  await page.locator("body", { hasText: "ride-financial-smoke-1" }).waitFor({ timeout: 15000 });
  await page.locator(".metric-list .row", { hasText: "Bruto passageiro" }).waitFor({ timeout: 15000 });
  await page.locator(".metric-list .row", { hasText: "R$ 27,50" }).first().waitFor({ timeout: 15000 });
  await page.locator(".metric-list .row", { hasText: "Líquido motorista" }).waitFor({ timeout: 15000 });
  await page.locator(".metric-list .row", { hasText: "R$ 26,01" }).waitFor({ timeout: 15000 });
  await page.locator(".metric-list .row", { hasText: "Taxa operacional Leaf" }).waitFor({ timeout: 15000 });
  await page.locator(".metric-list .row", { hasText: "R$ 0,84" }).waitFor({ timeout: 15000 });
  await page.locator(".metric-list .row", { hasText: "Taxa Woovi" }).waitFor({ timeout: 15000 });
  await page.locator(".metric-list .row", { hasText: "R$ 0,65" }).waitFor({ timeout: 15000 });

  const bodyText = await page.locator("body").innerText({ timeout: 5000 });
  if (bodyText.includes("R$ 80,00")) {
    throw new Error("Financial reconciliation rendered a stale quote estimate as money evidence");
  }

  log("financial reconciliation renders backend money contract ok");
}

async function assertMetricsFinancialContract(page) {
  await page.goto("/metrics", { waitUntil: "domcontentloaded" });
  await page.locator("h1", { hasText: "Métricas" }).waitFor({ timeout: 15000 });
  await page.locator("body", { hasText: "Receita total" }).waitFor({ timeout: 15000 });
  await page.locator("body", { hasText: "R$ 27,50" }).waitFor({ timeout: 15000 });
  await page.locator("body", { hasText: "Corridas reconciliadas" }).waitFor({ timeout: 15000 });
  log("metrics page renders current financial fields ok");
}

async function assertFinancialSimulatorRequiresExplicitFlag(page) {
  await page.goto("/financial-simulator", { waitUntil: "domcontentloaded" });
  await page.locator("h1", { hasText: "Simulador Financeiro" }).waitFor({ timeout: 15000 });
  await page.locator("body", { hasText: "Simulador desativado" }).waitFor({ timeout: 15000 });
  log("financial simulator requires explicit launch flag ok");
}

async function assertObservabilityRideHealthContract(page) {
  await page.goto("/observability", { waitUntil: "domcontentloaded" });
  await page.locator("h1", { hasText: "Console operacional" }).waitFor({ timeout: 15000 });
  await page.locator("body", { hasText: "Sinal motorista stale" }).waitFor({ timeout: 15000 });
  await page.locator("body", { hasText: "driver_signal_stale" }).waitFor({ timeout: 15000 });
  await page.locator("body", { hasText: "booking-signal-stale" }).waitFor({ timeout: 15000 });
  log("observability renders ride health driver signal alert ok");
}

async function assertReportsDownloadContract(page, observed) {
  await page.goto("/reports", { waitUntil: "domcontentloaded" });
  await page.locator("h1", { hasText: "Relatórios" }).waitFor({ timeout: 15000 });
  await page.locator("body", { hasText: "Relatório financeiro operacional" }).waitFor({ timeout: 15000 });

  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/reports/generate/smoke-financial-report") &&
    response.status() === 200
  );
  await page.getByTestId("report-smoke-financial-report-pdf").click();
  await responsePromise;
  await page
    .locator("body", { hasText: "Relatório gerado com autenticação do dashboard." })
    .waitFor({ timeout: 15000 });

  if (observed.reportDownloadAuthorization !== "Bearer smoke-access-token") {
    throw new Error("Report export did not use the authenticated dashboard API client");
  }

  log("reports export uses authenticated dashboard API client ok");
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
      detached: process.platform !== "win32",
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
    const unauthObserved = { forbiddenRequests: [], apiPaths: [] };
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

    const observed = { forbiddenRequests: [], apiPaths: [] };
    const pageErrors = [];
    await installRoutes(context, observed);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));

    for (const routeConfig of routes) {
      await assertVisibleHeading(page, routeConfig);
    }

    await assertFinancialReconciliationContract(page);
    await assertMetricsFinancialContract(page);
    await assertFinancialSimulatorRequiresExplicitFlag(page);
    await assertObservabilityRideHealthContract(page);
    await assertReportsDownloadContract(page, observed);
    assertNoDeprecatedFinancialApiUse(observed);
    log("dashboard avoids deprecated financial metrics endpoints");

    await page.getByRole("link", { name: "Suporte" }).first().click();
    await page.locator("h1", { hasText: "Suporte" }).waitFor({ timeout: 15000 });
    await page
      .locator("[data-testid='support-freshness-status']", { hasText: "Dados: atualizados" })
      .waitFor({ timeout: 15000 });
    await page
      .locator("[data-testid='support-freshness-detail']", { hasText: "Tickets atualizado" })
      .waitFor({ timeout: 15000 });
    const classifiedTicketRow = page
      .locator(".support-thread-row", { hasText: /N2 .* elevated .* classifier/ })
      .first();
    await classifiedTicketRow.waitFor({ timeout: 15000 });
    await classifiedTicketRow.click();
    await page
      .locator(".support-conversation-panel", { hasText: "N2 · elevated · classifier" })
      .waitFor({ timeout: 15000 });
    await page
      .locator(".support-conversation-panel", {
        hasText: "payment_account_document_or_stuck_flow_keyword, payment_category_minimum",
      })
      .waitFor({ timeout: 15000 });
    const campaignsLink = page.getByRole("link", { name: "Campanhas" }).first();
    if (await campaignsLink.count()) {
      await campaignsLink.click();
      await page.locator("h1", { hasText: "Campanhas in-app" }).waitFor({ timeout: 15000 });
      log("top navigation to Campaign Center ok");
    } else {
      log("Campaign Center hidden by launch flag");
    }
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
    await stopServerTree(server);
  }
}

main().catch((error) => {
  process.stderr.write(`[backoffice-smoke] failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
