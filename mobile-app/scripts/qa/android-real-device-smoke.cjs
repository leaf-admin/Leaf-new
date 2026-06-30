#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { PNG } = require("pngjs");
const { extractCriticalAppLines } = require("./real-smoke-logcat.cjs");
const { resolvePostSandboxPaymentStatus } = require("./real-smoke-payment-status.cjs");
const {
  compareRenderedVehicleIdentity,
  evaluateManagedDriverVehicleIdentity,
  managedDriverBlockFailure,
  managedDriverPaymentBlockStatus,
} = require("./real-smoke-driver-identity.cjs");

const mobileDir = path.resolve(__dirname, "../..");
const rootDir = path.resolve(mobileDir, "..");

const APP_PACKAGE = process.env.APP_PACKAGE || "br.com.leaf.ride";
const BACKEND_URL = process.env.BACKEND_URL || "https://api.leaf.app.br";
const SOCKET_URL = process.env.SOCKET_URL || BACKEND_URL;
const DESTINATION_QUERY = process.env.REAL_SMOKE_DESTINATION || "Copacabana Palace";
const STRICT_QUOTE = process.env.STRICT_QUOTE === "true";
const OPEN_PAYMENT = process.env.REAL_SMOKE_OPEN_PAYMENT === "true";
const AUTO_CONFIRM_SANDBOX_PAYMENT = process.env.REAL_SMOKE_AUTO_CONFIRM_SANDBOX_PAYMENT === "true";
const COLLECT_DASHBOARD_EVIDENCE = process.env.REAL_SMOKE_COLLECT_DASHBOARD_EVIDENCE === "true";
const ALLOW_EXISTING_QUOTE = process.env.REAL_SMOKE_ALLOW_EXISTING_QUOTE === "true";
const ALLOW_EXISTING_ACTIVE_RIDE =
  process.env.REAL_SMOKE_ALLOW_EXISTING_ACTIVE_RIDE === "true";
const SYNC_DRIVER_TO_APP_PICKUP =
  process.env.REAL_SMOKE_SYNC_DRIVER_TO_APP_PICKUP === "true";
const REQUIRE_DRIVER_CRLV_IDENTITY =
  process.env.REAL_SMOKE_REQUIRE_DRIVER_CRLV_IDENTITY !== "false";
const REQUIRE_CANONICAL_PICKUP =
  process.env.REAL_SMOKE_REQUIRE_CANONICAL_PICKUP !== "false";
const REQUIRE_POST_TRIP =
  process.env.REAL_SMOKE_REQUIRE_POST_TRIP === "true";
const VERIFY_ACTIVE_TRIP_MAP_TAP =
  process.env.REAL_SMOKE_VERIFY_ACTIVE_TRIP_MAP_TAP === "true";
const COMPLETE_EXISTING_RECEIPT =
  process.env.REAL_SMOKE_COMPLETE_EXISTING_RECEIPT === "true";
const POST_TRIP_WAIT_MS = Number(process.env.REAL_SMOKE_POST_TRIP_WAIT_MS || 150000);
const PAYMENT_RUNTIME_PHONE = process.env.PAYMENT_RUNTIME_PHONE || process.env.FIREBASE_TEST_PHONE || "";
const PAYMENT_PASSENGER_UID =
  process.env.REAL_SMOKE_PASSENGER_UID ||
  process.env.PASSENGER_UID_FILTER ||
  process.env.FIREBASE_TEST_UID ||
  process.env.PAYMENT_RUNTIME_UID ||
  "";
const TEST_DRIVER_UID = process.env.TEST_DRIVER_UID || "";
const MANAGED_DRIVER_RIDE_REQUEST_TIMEOUT_MS = String(
  Math.max(180000, Number(process.env.DRIVER_RIDE_REQUEST_TIMEOUT_MS || 600000)),
);
const FIRST_LAUNCH_WAIT_MS = Number(process.env.FIRST_LAUNCH_WAIT_MS || 15000);
const SECOND_LAUNCH_WAIT_MS = Number(process.env.SECOND_LAUNCH_WAIT_MS || 12000);
const QUOTE_STABILITY_WAIT_MS = Number(process.env.QUOTE_STABILITY_WAIT_MS || 18000);
const PAYMENT_WAIT_MS = Number(process.env.REAL_SMOKE_PAYMENT_WAIT_MS || 30000);
const CAPTURE_XML_SETTLE_MS = Number(process.env.REAL_SMOKE_CAPTURE_XML_SETTLE_MS || 700);
const CAPTURE_XML_RETRY_MS = Number(process.env.REAL_SMOKE_CAPTURE_XML_RETRY_MS || 1200);
const EXPECTED_PICKUP_LAT = Number(process.env.TEST_PICKUP_LAT);
const EXPECTED_PICKUP_LNG = Number(process.env.TEST_PICKUP_LNG);
const EXPECTED_PICKUP_SOURCE_CERTIFIED =
  process.env.REAL_SMOKE_EXPECTED_PICKUP_SOURCE_CERTIFIED === "true";
const CANONICAL_PICKUP_TOLERANCE_M = Number(
  process.env.REAL_SMOKE_CANONICAL_PICKUP_TOLERANCE_M || 300,
);
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
const artifactsDir = path.join(mobileDir, "test-results", `android_real_smoke_${RUN_ID}`);
const phoneScreenshotPath = "/sdcard/leaf-real-smoke-screen.png";
const phoneDumpPath = "/sdcard/leaf-real-smoke-window.xml";

fs.mkdirSync(artifactsDir, { recursive: true });

const evidence = [];
const commands = [];
const warnings = [];
const failures = [];
let lastCanonicalPickup = null;

function log(message) {
  console.log(`[real-smoke] ${message}`);
}

function resolveBinary(name, candidates) {
  if (process.env[`${name.toUpperCase()}_BIN`]) {
    return process.env[`${name.toUpperCase()}_BIN`];
  }

  const pathResult = spawnSync("bash", ["-lc", `command -v ${name} || true`], {
    encoding: "utf8",
  });
  const fromPath = String(pathResult.stdout || "").trim();
  if (fromPath) return fromPath;

  for (const candidate of candidates) {
    const resolved = candidate.replace(/^~/, os.homedir());
    if (fs.existsSync(resolved)) return resolved;
  }
  return "";
}

const adb = resolveBinary("adb", [
  path.join(rootDir, "platform-tools", "adb"),
  path.join(rootDir, "android-sdk", "platform-tools", "adb"),
  "~/Library/Android/sdk/platform-tools/adb",
  "~/Android/Sdk/platform-tools/adb",
]);

function run(cmd, args, options = {}) {
  commands.push(`${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    encoding: options.encoding === "buffer" ? undefined : "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (options.allowFailure !== true && result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr || "");
    throw new Error(`${cmd} ${args.join(" ")} failed: ${stderr.trim()}`);
  }
  return result;
}

function adbArgs(args) {
  return androidSerial ? ["-s", androidSerial, ...args] : args;
}

function adbRun(args, options = {}) {
  return run(adb, adbArgs(args), options);
}

function adbText(args, options = {}) {
  const result = adbRun(args, { ...options, encoding: "utf8" });
  return String(result.stdout || "").replace(/\r/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function coordinateDistanceMeters(first, second) {
  const firstLat = Number(first?.lat ?? first?.latitude);
  const firstLng = Number(first?.lng ?? first?.longitude);
  const secondLat = Number(second?.lat ?? second?.latitude);
  const secondLng = Number(second?.lng ?? second?.longitude);
  if (
    !Number.isFinite(firstLat) ||
    !Number.isFinite(firstLng) ||
    !Number.isFinite(secondLat) ||
    !Number.isFinite(secondLng)
  ) {
    return null;
  }

  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(secondLat - firstLat);
  const dLng = toRadians(secondLng - firstLng);
  const lat1 = toRadians(firstLat);
  const lat2 = toRadians(secondLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validateCanonicalPickupAgainstExpected(pickup) {
  if (!Number.isFinite(EXPECTED_PICKUP_LAT) || !Number.isFinite(EXPECTED_PICKUP_LNG)) {
    return {
      requested: false,
      ok: true,
      skippedReason: "TEST_PICKUP_LAT/LNG not provided",
    };
  }

  const expected = {
    lat: EXPECTED_PICKUP_LAT,
    lng: EXPECTED_PICKUP_LNG,
  };
  const distanceMeters = coordinateDistanceMeters(pickup, expected);
  const toleranceMeters =
    Number.isFinite(CANONICAL_PICKUP_TOLERANCE_M) && CANONICAL_PICKUP_TOLERANCE_M > 0
      ? CANONICAL_PICKUP_TOLERANCE_M
      : 300;

  return {
    requested: true,
    ok: Number.isFinite(distanceMeters) && distanceMeters <= toleranceMeters,
    expected,
    sourceCertified: EXPECTED_PICKUP_SOURCE_CERTIFIED,
    observed: pickup || null,
    distanceMeters: Number.isFinite(distanceMeters)
      ? Number(distanceMeters.toFixed(1))
      : null,
    toleranceMeters,
  };
}

function classifySmokeFailure(message) {
  const text = String(message || "");
  const lower = text.toLowerCase();
  const blockedMatch = text.match(/blocked_precondition:([a-z0-9_:-]+)/i);
  const base = {
    message: text,
    status: blockedMatch ? "blocked_precondition" : "failed",
    reason: blockedMatch ? blockedMatch[1] : "",
    domain: "product",
    severity: "P1",
    owner: "product_engineering",
  };

  if (blockedMatch) {
    if (
      lower.includes("driver_unavailable") ||
      lower.includes("geofence") ||
      lower.includes("payment_sandbox") ||
      lower.includes("driver_vehicle_identity")
    ) {
      return {
        ...base,
        domain: "business_rule",
        severity: "P0",
        owner: "backend_policy_or_test_data",
      };
    }
    if (lower.includes("android_location_provider_divergence")) {
      return {
        ...base,
        domain: "execution_environment",
        severity: "P0",
        owner: "qa_device_location",
      };
    }
    if (
      lower.includes("device") ||
      lower.includes("toolchain") ||
      lower.includes("existing_active_ride")
    ) {
      return {
        ...base,
        domain: "execution_environment",
        severity: "P1",
        owner: "qa_environment",
      };
    }
    if (
      lower.includes("destination_query_input_failed") ||
      lower.includes("app_canonical_pickup_unavailable") ||
      lower.includes("expected_pickup_source_uncertified")
    ) {
      return {
        ...base,
        domain: "test_harness",
        severity: "P1",
        owner: "qa_automation",
      };
    }
    if (
      lower.includes("app_canonical_pickup_mismatch") ||
      lower.includes("stale_quote_state")
    ) {
      if (lower.includes("app_canonical_pickup_mismatch") && !EXPECTED_PICKUP_SOURCE_CERTIFIED) {
        return {
          ...base,
          domain: "test_harness",
          severity: "P1",
          owner: "qa_automation",
        };
      }
      return {
        ...base,
        domain: "product",
        severity: "P0",
        owner: "mobile_runtime",
      };
    }
  }

  if (
    lower.includes("tarifa") ||
    lower.includes("fare consistency") ||
    lower.includes("consistência de tarifa")
  ) {
    return {
      ...base,
      domain: "business_rule",
      severity: "P0",
      owner: "financial_policy",
    };
  }

  if (lower.includes("payment_profile_credentials_missing")) {
    return {
      ...base,
      domain: "execution_environment",
      severity: "P0",
      owner: "payment_runtime_config",
    };
  }

  if (
    lower.includes("payment_provider_charge_failed") ||
    lower.includes("payment_provider_charge_id_missing")
  ) {
    return {
      ...base,
      domain: "product",
      severity: "P0",
      owner: "payment_integration",
    };
  }

  if (
    lower.includes("pix") ||
    lower.includes("payment") ||
    lower.includes("pagamento") ||
    lower.includes("sandbox")
  ) {
    return {
      ...base,
      domain: lower.includes("baixa automática sandbox")
        ? "test_harness"
        : "product",
      severity: "P0",
      owner: lower.includes("baixa automática sandbox")
        ? "qa_automation_or_payment_sandbox"
        : "payment_integration",
    };
  }

  if (
    lower.includes("dashboard") ||
    lower.includes("evidência dashboard")
  ) {
    return {
      ...base,
      domain: "test_harness",
      severity: "P1",
      owner: "dashboard_qa_automation",
    };
  }

  if (
    lower.includes("logcat") ||
    lower.includes("state regression") ||
    lower.includes("estado")
  ) {
    return {
      ...base,
      domain: "product",
      severity: "P0",
      owner: "mobile_runtime",
    };
  }

  return base;
}

function buildFailureClassification(failureMessages) {
  const items = (Array.isArray(failureMessages) ? failureMessages : [])
    .filter(Boolean)
    .map(classifySmokeFailure);
  const byDomain = items.reduce((acc, item) => {
    acc[item.domain] = (acc[item.domain] || 0) + 1;
    return acc;
  }, {});
  const blocked = items.filter((item) => item.status === "blocked_precondition");
  const failed = items.filter((item) => item.status !== "blocked_precondition");
  return {
    finalStatus:
      items.length === 0
        ? "passed"
        : failed.length === 0
          ? `blocked_precondition:${blocked[0]?.reason || "unknown"}`
          : "failed",
    counts: {
      total: items.length,
      blockedPreconditions: blocked.length,
      failed: failed.length,
      byDomain,
    },
    items,
  };
}

function writeArtifact(name, content) {
  const filePath = path.join(artifactsDir, name);
  fs.writeFileSync(filePath, content);
  evidence.push(filePath);
  return filePath;
}

function requestText(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, url, error: error.message });
      return;
    }

    const client = parsed.protocol === "http:" ? http : https;
    const req = client.request(
      parsed,
      { method: "GET", timeout: timeoutMs, headers: { "User-Agent": "leaf-real-smoke/1.0" } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, url, status: res.statusCode, body });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (error) => {
      resolve({ ok: false, url, error: error.message });
    });
    req.end();
  });
}

function decodeXml(value = "") {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseNodes(xml) {
  const nodes = [];
  const nodeRegex = /<node\b([^>]*)>/g;
  let nodeMatch;
  while ((nodeMatch = nodeRegex.exec(xml))) {
    const raw = nodeMatch[1];
    const node = {};
    const attrRegex = /([:\w-]+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(raw))) {
      node[attrMatch[1]] = decodeXml(attrMatch[2]);
    }
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(node.bounds || "");
    if (bounds) {
      node.boundsRect = {
        x1: Number(bounds[1]),
        y1: Number(bounds[2]),
        x2: Number(bounds[3]),
        y2: Number(bounds[4]),
      };
      node.center = {
        x: Math.round((node.boundsRect.x1 + node.boundsRect.x2) / 2),
        y: Math.round((node.boundsRect.y1 + node.boundsRect.y2) / 2),
      };
    }
    nodes.push(node);
  }
  return nodes;
}

function combinedText(node) {
  return [node.text, node["content-desc"], node["resource-id"]]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function findNode(nodes, candidates) {
  return nodes.find((node) => {
    const text = combinedText(node);
    return candidates.some((candidate) => text.includes(candidate.toLowerCase()));
  });
}

function findNodeByPriority(nodes, candidateGroups) {
  for (const candidates of candidateGroups) {
    const node = findNode(nodes, candidates);
    if (node) return node;
  }
  return null;
}

function extractPrices(nodes) {
  const values = new Set();
  const regex = /R\$\s*\d+(?:[.,]\d{2})?/g;
  for (const node of nodes) {
    for (const source of [node.text, node["content-desc"]]) {
      const matches = String(source || "").match(regex);
      if (matches) {
        for (const match of matches) values.add(match.replace(/\s+/g, " ").trim());
      }
    }
  }
  return [...values];
}

function extractVisiblePaymentError(nodes) {
  const texts = [];
  for (const node of nodes || []) {
    for (const value of [node.text, node["content-desc"]]) {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      if (!text || texts.includes(text)) continue;
      texts.push(text);
    }
  }

  const titleIndex = texts.findIndex((text) => /falha ao gerar pagamento/i.test(text));
  if (titleIndex >= 0) {
    const subtitle = texts
      .slice(titleIndex + 1)
      .find((text) => !/tentar novamente|fechar/i.test(text));
    return subtitle || texts[titleIndex] || null;
  }

  return (
    texts.find((text) =>
      /sess[aã]o expirou|n[aã]o h[aá] motorista|atualize a cota[cç][aã]o|n[aã]o foi poss[ií]vel gerar o pix/i.test(text),
    ) || null
  );
}

function parsePaymentErrorDiagnosticsValue(value) {
  const text = String(value || "").trim();
  const match = text.match(/payment-error:([^\s"]+)/i);
  if (!match) return null;
  return match[1]
    .split(";")
    .map((entry) => entry.split("="))
    .reduce((acc, [key, ...valueParts]) => {
      const normalizedKey = String(key || "").trim();
      const normalizedValue = valueParts.join("=").trim();
      if (normalizedKey && normalizedValue) acc[normalizedKey] = normalizedValue;
      return acc;
    }, {});
}

function extractPaymentErrorDiagnostics(nodes) {
  for (const node of nodes || []) {
    for (const value of [node.text, node["content-desc"], node["resource-id"]]) {
      const diagnostics = parsePaymentErrorDiagnosticsValue(value);
      if (diagnostics && Object.keys(diagnostics).length > 0) return diagnostics;
    }
  }
  return null;
}

function formatPaymentErrorDiagnostics(diagnostics) {
  return diagnostics && Object.keys(diagnostics).length > 0
    ? JSON.stringify(diagnostics)
    : "not captured";
}

function paymentErrorDiagnosticSuffix(diagnostics) {
  if (!diagnostics || Object.keys(diagnostics).length === 0) return "";
  const parts = [
    diagnostics.code,
    diagnostics.status ? `status=${diagnostics.status}` : null,
    diagnostics.providerEnvironment ? `env=${diagnostics.providerEnvironment}` : null,
    diagnostics.paymentProfileId ? `profile=${diagnostics.paymentProfileId}` : null,
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(";")})` : "";
}

function parseBrlPriceLabel(value) {
  const match = String(value || "").match(/R\$\s*(\d+(?:[.,]\d{2})?)/);
  if (!match) return null;
  const numeric = Number(match[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null;
}

function firstPriceValue(prices) {
  if (!Array.isArray(prices)) return null;
  for (const price of prices) {
    const parsed = parseBrlPriceLabel(price);
    if (parsed !== null) return parsed;
  }
  return null;
}

function pricesMatch(left, right) {
  return (
    Number.isFinite(Number(left)) &&
    Number.isFinite(Number(right)) &&
    Math.abs(Number(left) - Number(right)) < 0.005
  );
}

function buildFareConsistencyReport({
  steps,
  initialQuote,
  laterQuote,
  sandboxPaymentConfirmation,
  managedDriverBot,
}) {
  const entries = [];
  const driverNetEntries = [];
  const driverFeeEntries = [];
  const add = (stage, amount, source = null) => {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
    entries.push({
      stage,
      amount: Number(Number(amount).toFixed(2)),
      source,
    });
  };
  const addDriverNet = (stage, amount, source = null) => {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
    driverNetEntries.push({
      stage,
      amount: Number(Number(amount).toFixed(2)),
      source,
    });
  };
  const addDriverFee = (stage, amount, source = null) => {
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) return;
    driverFeeEntries.push({
      stage,
      amount: Number(Number(amount).toFixed(2)),
      source,
    });
  };

  add("quote_initial", firstPriceValue(initialQuote), "quote");
  add("quote_after_wait", firstPriceValue(laterQuote), "quote");

  for (const step of steps || []) {
    const amount = firstPriceValue(step.prices);
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) continue;
    if (step.name.startsWith("07-payment-after-confirm")) {
      add("payment_review", amount, step.name);
    } else if (step.screen === "passenger_active_trip") {
      add("active_trip", amount, step.name);
    } else if (step.screen === "passenger_receipt") {
      add("receipt_gross", amount, step.name);
    }
  }

  const paymentEvidence = readJsonFile(sandboxPaymentConfirmation?.evidencePath);
  const chargeValue = Number(paymentEvidence?.charge?.value);
  if (Number.isFinite(chargeValue) && chargeValue > 0) {
    add("sandbox_charge", chargeValue / 100, "sandbox-payment-confirmation.json");
  }
  for (const entry of extractManagedDriverFareEvidence(managedDriverBot)) {
    if (entry.kind === "driver_net") {
      addDriverNet(entry.stage, entry.amount, entry.source);
    } else if (entry.kind === "driver_fee") {
      addDriverFee(entry.stage, entry.amount, entry.source);
    } else {
      add(entry.stage, entry.amount, entry.source);
    }
  }

  const quoteEntry =
    entries.find((entry) => entry.stage === "quote_after_wait") ||
    entries.find((entry) => entry.stage === "quote_initial") ||
    null;
  const mismatches = quoteEntry
    ? entries.filter((entry) => !pricesMatch(entry.amount, quoteEntry.amount))
    : [];

  return {
    ok: Boolean(quoteEntry) && mismatches.length === 0,
    quote: quoteEntry,
    entries,
    driverNetEntries,
    driverFeeEntries,
    mismatches,
  };
}

function parseJsonPayloadFromLogLine(line = "") {
  const start = String(line).indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(String(line).slice(start));
  } catch (_) {
    return null;
  }
}

function extractManagedDriverFareEvidence(managedDriverBot) {
  const logPath = managedDriverBot?.logPath;
  if (!logPath || !fs.existsSync(logPath)) return [];
  const entries = [];
  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (line.includes("ride_accepted")) {
      const payload = parseJsonPayloadFromLogLine(line);
      const estimatedFare = Number(payload?.estimatedFare);
      const operationalFee = Number(payload?.estimatedOperationalFee);
      const intermediationFee = Number(payload?.estimatedPaymentIntermediationFee);
      const totalFees = Number(payload?.estimatedTotalFees);
      const driverNet = Number(payload?.estimatedDriverNetAmount);
      if (Number.isFinite(estimatedFare) && estimatedFare > 0) {
        entries.push({
          kind: "gross",
          stage: "driver_offer_gross",
          amount: estimatedFare,
          source: "managed-driver-bot.log:ride_accepted",
        });
      }
      if (Number.isFinite(driverNet) && driverNet > 0) {
        entries.push({
          kind: "driver_net",
          stage: "driver_offer_net",
          amount: driverNet,
          source: "managed-driver-bot.log:ride_accepted",
        });
      }
      if (Number.isFinite(operationalFee) && operationalFee >= 0) {
        entries.push({
          kind: "driver_fee",
          stage: "driver_offer_operational_fee",
          amount: operationalFee,
          source: "managed-driver-bot.log:ride_accepted",
        });
      }
      if (Number.isFinite(intermediationFee) && intermediationFee >= 0) {
        entries.push({
          kind: "driver_fee",
          stage: "driver_offer_intermediation_fee",
          amount: intermediationFee,
          source: "managed-driver-bot.log:ride_accepted",
        });
      }
      if (Number.isFinite(totalFees) && totalFees >= 0) {
        entries.push({
          kind: "driver_fee",
          stage: "driver_offer_total_fees",
          amount: totalFees,
          source: "managed-driver-bot.log:ride_accepted",
        });
      }
    }
    if (line.includes("trip_completed")) {
      const payload = parseJsonPayloadFromLogLine(line);
      const grossFare = Number(
        payload?.grossAmount ??
          payload?.totalPaid ??
          payload?.totalFare ??
          payload?.fare,
      );
      const passengerPaidCents = Number(payload?.financialSnapshot?.passengerPaidCents);
      const driverNet = Number(
        payload?.driverNetAmount ??
          (Number.isFinite(Number(payload?.financialSnapshot?.driverNetCents))
            ? Number(payload.financialSnapshot.driverNetCents) / 100
            : NaN),
      );
      if (Number.isFinite(grossFare) && grossFare > 0) {
        entries.push({
          kind: "gross",
          stage: "driver_completion_gross",
          amount: grossFare,
          source: "managed-driver-bot.log:trip_completed",
        });
      }
      if (Number.isFinite(passengerPaidCents) && passengerPaidCents > 0) {
        entries.push({
          kind: "gross",
          stage: "driver_completion_passenger_paid",
          amount: passengerPaidCents / 100,
          source: "managed-driver-bot.log:trip_completed",
        });
      }
      if (Number.isFinite(driverNet) && driverNet > 0) {
        entries.push({
          kind: "driver_net",
          stage: "driver_completion_net",
          amount: driverNet,
          source: "managed-driver-bot.log:trip_completed",
        });
      }
    }
  }
  return entries;
}

function extractDriverSearchElapsed(nodes) {
  const node = findNode(nodes, ["passenger-driver-search-elapsed"]);
  const value = String(node?.text || node?.["content-desc"] || "").trim();
  return /^\d{2}:\d{2}$/.test(value) ? value : null;
}

function nodeTextByResourceFragment(nodes, fragment) {
  const matches = nodes.filter((node) => {
    const resourceId = String(node["resource-id"] || "");
    const text = String(node.text || node["content-desc"] || "").trim();
    const bounds = node.boundsRect;
    const hasVisibleArea = bounds && bounds.x2 > bounds.x1 && bounds.y2 > bounds.y1;
    return resourceId.includes(fragment) && text && hasVisibleArea;
  });
  const node = matches[matches.length - 1];
  return String(node?.text || node?.["content-desc"] || "").trim() || null;
}

function extractRenderedVehicleIdentity(nodes, screen) {
  if (screen === "passenger_active_trip") {
    const identity = {
      plate: nodeTextByResourceFragment(nodes, "vehicle_plate"),
      model: nodeTextByResourceFragment(nodes, "vehicle_model"),
      color: nodeTextByResourceFragment(nodes, "vehicle_color"),
    };
    return Object.values(identity).some(Boolean)
      ? { ...identity, source: "passenger_active_trip_ui" }
      : null;
  }

  if (screen === "passenger_receipt") {
    const modelColor = nodeTextByResourceFragment(
      nodes,
      "passenger-receipt-vehicle-model-color",
    );
    const [model, color] = String(modelColor || "")
      .split("·")
      .map((value) => value.trim());
    const identity = {
      plate: nodeTextByResourceFragment(nodes, "passenger-receipt-vehicle-plate"),
      model: model || null,
      color: color || null,
    };
    return Object.values(identity).some(Boolean)
      ? { ...identity, source: "passenger_receipt_ui" }
      : null;
  }

  return null;
}

function parseCanonicalPickup(raw, source) {
  const text = String(raw || "");
  const match = /pickup:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:;address:\s*([^;\r\n]*))?/i.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    address: String(match[3] || "").trim(),
    raw: text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80),
    source,
  };
}

function extractCanonicalPickup(nodes, fallbackSources = []) {
  const node = nodes.find((item) => {
    const resourceId = String(item["resource-id"] || "");
    const text = `${item.text || ""} ${item["content-desc"] || ""}`;
    return (
      resourceId.includes("passenger-destination-pickup-coordinate") ||
      text.includes("passenger-destination-pickup-coordinate") ||
      text.includes("pickup:")
    );
  });
  const raw = [node?.text, node?.["content-desc"]].filter(Boolean).join(" ");
  const fromNode = parseCanonicalPickup(raw, "uiautomator_xml");
  if (fromNode) return fromNode;

  for (const fallback of fallbackSources) {
    const parsed = parseCanonicalPickup(fallback?.text, fallback?.source || "fallback");
    if (parsed) return parsed;
  }

  return null;
}

function extractSelectedCarType(nodes) {
  const allText = nodes.map((node) => [node.text, node["content-desc"]].filter(Boolean).join(" ")).join("\n");
  if (/Leaf\s+Elite/i.test(allText)) return "Leaf Elite";
  if (/Leaf\s+Moto/i.test(allText)) return "Leaf Moto";
  return "Leaf Plus";
}

function detectScreen(nodes) {
  const allText = nodes.map(combinedText).join("\n");
  if (
    (allText.includes("avaliação enviada") || allText.includes("avaliacao enviada")) &&
    (allText.includes("android:id/button1") || allText.includes("sua nota para"))
  ) {
    return "passenger_rating_success";
  }
  if (allText.includes("passenger-rating-submit-button")) return "passenger_rating";
  if (allText.includes("payment-modal-confirmed")) return "payment_confirmed";
  if (allText.includes("payment-modal-content") || allText.includes("payment-modal-copy-pix-button")) {
    return "payment_pix_ready";
  }
  if (
    allText.includes("pague com pix") ||
    allText.includes("aguardando pix") ||
    allText.includes("copiar código") ||
    allText.includes("copiar codigo") ||
    allText.includes("abrir banco")
  ) {
    return "payment_pix_ready";
  }
  if (allText.includes("payment-modal-loading") || allText.includes("processando pagamento")) {
    return "payment_loading";
  }
  if (
    allText.includes("passenger-preference-countdown-modal") ||
    allText.includes("passenger-preference-confirm-button") ||
    allText.includes("preferências da viagem") ||
    allText.includes("preferencias da viagem") ||
    allText.includes("antes de buscar")
  ) {
    return "passenger_ride_preferences";
  }
  if (
    allText.includes("passenger-booking-finalizing-sheet") ||
    allText.includes("finalizando solicitação") ||
    allText.includes("finalizando solicitacao")
  ) {
    return "passenger_booking_finalizing";
  }
  if (
    allText.includes("passenger-driver-search-sheet") ||
    allText.includes("buscando motorista") ||
    allText.includes("pagamento confirmado")
  ) {
    return "passenger_searching_driver";
  }
  if (
    allText.includes("passenger-trip-screen") ||
      allText.includes("passenger-trip-compact-summary") ||
      allText.includes("passenger-trip-driver-identity")
  ) {
    return "passenger_active_trip";
  }
  if (allText.includes("passenger-destination-confirm-button")) return "passenger_quote";
  if (
    allText.includes("passenger-destination-search-input") ||
    allText.includes("passenger-home-destination-search-input")
  ) {
    return "destination_search";
  }
  if (allText.includes("passenger-home-destination-result-0")) return "destination_results";
  if (allText.includes("passenger-home-destination-input") || allText.includes("para onde")) return "passenger_home";
  if (
    allText.includes("passenger-receipt-rate-trip-button") ||
    allText.includes("passenger-receipt-report-issue-button")
  ) {
    return "passenger_receipt";
  }
  if (allText.includes("support-screen") || allText.includes("support-tab-")) return "support";
  if (allText.includes("driver-home-toggle-online") || allText.includes("driver")) return "driver_home";
  if (allText.includes("auth-phone-input") || allText.includes("telefone") || allText.includes("entrar")) return "auth";
  return allText.trim() ? "unknown" : "blank";
}

function detectPaymentStatus(nodes) {
  const allText = nodes.map(combinedText).join("\n");
  if (allText.includes("payment-modal-confirmed")) return "confirmed";
  if (
    allText.includes("payment-modal-copy-pix-button") ||
    allText.includes("copiar código") ||
    allText.includes("copiar codigo")
  ) {
    return "pix_copy_available";
  }
  if (
    allText.includes("payment-modal-content") ||
    allText.includes("pague com pix") ||
    allText.includes("aguardando pix") ||
    allText.includes("abrir banco")
  ) {
    return "pix_modal_content";
  }
  if (allText.includes("payment-modal-loading") || allText.includes("processando pagamento")) return "loading";
  if (/não há motoristas disponíveis|nao ha motoristas disponiveis|categoria indisponível|categoria indisponivel/.test(allText)) {
    return "blocked_no_driver";
  }
  if (/erro|falha|pagamento.*indispon|não foi possível/.test(allText)) return "error_visible";
  return "not_visible";
}

function runSandboxPaymentConfirmation() {
  if (!AUTO_CONFIRM_SANDBOX_PAYMENT) {
    return { requested: false, ok: null, skippedReason: "disabled" };
  }

  if (!OPEN_PAYMENT) {
    return { requested: true, ok: false, error: "REAL_SMOKE_OPEN_PAYMENT=true is required" };
  }

  if (!PAYMENT_PASSENGER_UID) {
    return {
      requested: true,
      ok: false,
      error: "REAL_SMOKE_PASSENGER_UID or FIREBASE_TEST_UID is required",
    };
  }

  const scriptPath = path.join(__dirname, "simulate-latest-ride-payment.sh");
  const evidencePath = path.join(artifactsDir, "sandbox-payment-confirmation.json");
  const result = spawnSync("bash", [scriptPath], {
    cwd: mobileDir,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      API_BASE_URL: BACKEND_URL,
      PASSENGER_UID_FILTER: PAYMENT_PASSENGER_UID,
      PAYMENT_EVIDENCE_PATH: evidencePath,
      WATCH_TIMEOUT_SEC: process.env.REAL_SMOKE_PAYMENT_CONFIRM_TIMEOUT_SEC || "180",
    },
  });

  commands.push(`bash ${scriptPath}`);
  if (fs.existsSync(evidencePath)) {
    evidence.push(evidencePath);
  }

  const payload = {
    requested: true,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    evidencePath: fs.existsSync(evidencePath) ? evidencePath : null,
  };
  writeArtifact("sandbox-payment-confirmation-process.json", JSON.stringify(payload, null, 2));
  return payload;
}

function buildAppFlowPaymentConfirmationEvidence() {
  const payload = {
    requested: AUTO_CONFIRM_SANDBOX_PAYMENT,
    ok: true,
    skippedReason: "payment_already_confirmed_by_app_flow",
    source: "app_payment_flow",
  };
  const evidencePath = writeArtifact(
    "sandbox-payment-confirmation-app-flow.json",
    JSON.stringify(payload, null, 2),
  );
  return {
    ...payload,
    evidencePath,
  };
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function runDashboardEvidenceCollection(paymentConfirmation) {
  if (!COLLECT_DASHBOARD_EVIDENCE) {
    return { requested: false, ok: null, skippedReason: "disabled" };
  }

  const paymentEvidence = readJsonFile(paymentConfirmation?.evidencePath);
  const rideId = paymentEvidence?.charge?.rideId || process.env.REAL_SMOKE_RIDE_ID || process.env.BOOKING_ID || "";
  if (!rideId) {
    return { requested: true, ok: false, error: "rideId unavailable for dashboard evidence" };
  }

  const scriptPath = path.join(__dirname, "collect-ride-dashboard-evidence.cjs");
  const result = spawnSync("node", [scriptPath], {
    cwd: mobileDir,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      API_BASE_URL: BACKEND_URL,
      RIDE_ID: rideId,
      ARTIFACTS_DIR: artifactsDir,
      EXPECTED_GROSS:
        process.env.EXPECTED_GROSS ||
        (Number.isFinite(Number(paymentEvidence?.charge?.value))
          ? (Number(paymentEvidence.charge.value) / 100).toFixed(2)
          : ""),
    },
  });

  commands.push(`node ${scriptPath}`);
  const evidencePath = path.join(artifactsDir, "dashboard-evidence.json");
  if (fs.existsSync(evidencePath)) {
    evidence.push(evidencePath);
  }
  const markdownPath = path.join(artifactsDir, "dashboard-evidence.md");
  if (fs.existsSync(markdownPath)) {
    evidence.push(markdownPath);
  }

  return {
    requested: true,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    rideId,
    evidencePath: fs.existsSync(evidencePath) ? evidencePath : null,
  };
}

function runFinalReportBuilder() {
  const scriptPath = path.join(__dirname, "build-smoke-evidence-report.cjs");
  const result = spawnSync("node", [scriptPath, artifactsDir], {
    cwd: mobileDir,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  commands.push(`node ${scriptPath} ${artifactsDir}`);
  const reportPath = path.join(artifactsDir, "smoke-e2e-final-report.md");
  if (fs.existsSync(reportPath)) {
    evidence.push(reportPath);
  }
  return result;
}

function tailTextFile(filePath, maxChars = 5000) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return text.slice(Math.max(0, text.length - maxChars));
  } catch (_) {
    return "";
  }
}

async function waitForFilePattern(filePath, pattern, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = tailTextFile(filePath);
    if (pattern.test(text)) {
      return { ok: true, tail: text };
    }
    await sleep(800);
  }
  return { ok: false, tail: tailTextFile(filePath) };
}

function parseLatestDriverOnlineEvent(text) {
  const matches = [...String(text || "").matchAll(/^driver_online\s+(.+)$/gim)];
  const latest = matches[matches.length - 1];
  if (!latest) return null;
  try {
    return JSON.parse(latest[1]);
  } catch (error) {
    return { parseError: error.message, raw: latest[1] };
  }
}

async function waitForManagedDriverReadiness(logPath, timeoutMs = 45000) {
  const startedAt = Date.now();
  let latestOnline = null;
  while (Date.now() - startedAt < timeoutMs) {
    const tail = tailTextFile(logPath);
    if (/driver_online\s+\{[^}]*"dispatchEligible":true/i.test(tail)) {
      return { ok: true, tail, latestOnline: parseLatestDriverOnlineEvent(tail) };
    }
    latestOnline = parseLatestDriverOnlineEvent(tail) || latestOnline;
    await sleep(800);
  }

  const tail = tailTextFile(logPath);
  latestOnline = parseLatestDriverOnlineEvent(tail) || latestOnline;
  if (latestOnline && latestOnline.dispatchEligible !== true) {
    return {
      ok: false,
      error: "driver_not_dispatch_eligible",
      latestOnline,
      tail,
    };
  }

  return { ok: false, error: "driver_online_timeout", latestOnline, tail };
}

async function startManagedDriverBotAtPickup(pickup) {
  if (!SYNC_DRIVER_TO_APP_PICKUP) {
    return { requested: false, ok: null, skippedReason: "disabled" };
  }

  if (!TEST_DRIVER_UID) {
    return { requested: true, ok: false, error: "TEST_DRIVER_UID is required" };
  }

  if (!Number.isFinite(Number(pickup?.lat)) || !Number.isFinite(Number(pickup?.lng))) {
    return { requested: true, ok: false, error: "canonical pickup is invalid" };
  }

  const scriptPath = path.join(rootDir, "leaf-websocket-backend", "scripts", "tests", "driver-dispatch-bot.cjs");
  const logPath = path.join(artifactsDir, "managed-driver-bot.log");
  const output = fs.openSync(logPath, "w");
  evidence.push(logPath);
  const child = spawn("node", [scriptPath], {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", output, output],
    env: {
      ...process.env,
      WS_URL: SOCKET_URL,
      TEST_DRIVER_UID,
      TEST_PICKUP_LAT: String(pickup.lat),
      TEST_PICKUP_LNG: String(pickup.lng),
      DRIVER_RIDE_REQUEST_TIMEOUT_MS: MANAGED_DRIVER_RIDE_REQUEST_TIMEOUT_MS,
      DRIVER_ACCEPTED_HOLD_MS: process.env.DRIVER_ACCEPTED_HOLD_MS || "2500",
      DRIVER_ARRIVED_HOLD_MS: process.env.DRIVER_ARRIVED_HOLD_MS || "1800",
      DRIVER_TRIP_STEP_INTERVAL_MS: process.env.DRIVER_TRIP_STEP_INTERVAL_MS || "2200",
      DRIVER_TRIP_STEPS: process.env.DRIVER_TRIP_STEPS || "10",
      DRIVER_BOT_SEED_REDIS_ELIGIBLE: process.env.DRIVER_BOT_SEED_REDIS_ELIGIBLE || "true",
    },
  });
  child.unref();

  const online = await waitForManagedDriverReadiness(logPath, 45000);
  const vehicleIdentity = evaluateManagedDriverVehicleIdentity(
    online.latestOnline || {},
    { requireCrlvSource: REQUIRE_DRIVER_CRLV_IDENTITY },
  );
  const result = {
    requested: true,
    ok: online.ok && vehicleIdentity.ok,
    error: online.error || (vehicleIdentity.ok ? null : vehicleIdentity.code),
    pid: child.pid,
    logPath,
    pickup,
    latestOnline: online.latestOnline || null,
    vehicleIdentity,
    tail: online.tail,
  };
  writeArtifact("managed-driver-bot.json", JSON.stringify(result, null, 2));
  return result;
}

async function checkSocketAvailabilityAtPickup(pickup, carType) {
  if (!PAYMENT_PASSENGER_UID) {
    return { requested: true, ok: false, error: "REAL_SMOKE_PASSENGER_UID or FIREBASE_TEST_UID is required" };
  }

  if (!Number.isFinite(Number(pickup?.lat)) || !Number.isFinite(Number(pickup?.lng))) {
    return { requested: true, ok: false, error: "canonical pickup is invalid" };
  }

  let WebSocketTestClient;
  try {
    WebSocketTestClient = require(path.join(
      rootDir,
      "leaf-websocket-backend",
      "tests",
      "e2e",
      "backend",
      "__helpers__",
      "websocket-test-client",
    ));
  } catch (error) {
    return { requested: true, ok: false, error: `websocket test client unavailable: ${error.message}` };
  }

  const requestId = `real_smoke_app_pickup_${Date.now()}`;
  const client = new WebSocketTestClient(SOCKET_URL, {
    transports: ["websocket"],
    timeout: 30000,
    reconnection: false,
  });

  try {
    await client.connect();
    await client.authenticate(PAYMENT_PASSENGER_UID, "customer");
    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ timeout: true }), 25000);
      client.socket.once("rideAvailabilityResult", (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
      client.socket.once("rideAvailabilityError", (payload) => {
        clearTimeout(timeout);
        resolve({ errorEvent: true, ...payload });
      });
      client.socket.emit("checkRideAvailability", {
        requestId,
        pickupLocation: {
          lat: Number(pickup.lat),
          lng: Number(pickup.lng),
          add: pickup.address || "Origem do app",
        },
        carType,
      });
    });
    const payload = {
      requested: true,
      ok: result?.available === true || result?.hasDrivers === true,
      requestId,
      pickup,
      carType,
      result,
    };
    writeArtifact("canonical-app-pickup-availability.json", JSON.stringify(payload, null, 2));
    return payload;
  } catch (error) {
    const payload = {
      requested: true,
      ok: false,
      requestId,
      pickup,
      carType,
      error: error.message || String(error),
    };
    writeArtifact("canonical-app-pickup-availability.json", JSON.stringify(payload, null, 2));
    return payload;
  } finally {
    try {
      await client.disconnect();
    } catch (_) {
      // best-effort cleanup for QA socket
    }
  }
}

async function prepareCanonicalPickupForPayment(current) {
  const pickup =
    current.canonicalPickup ||
    extractCanonicalPickup(current.nodes, [
      { source: "uiautomator_logcat", text: current.accessibilityDumpLog },
    ]) ||
    lastCanonicalPickup;
  const carType = extractSelectedCarType(current.nodes);
  const expectedPickupValidation = validateCanonicalPickupAgainstExpected(pickup);
  const pickupPayload = {
    ok: Boolean(pickup),
    pickup,
    carType,
    requireCanonicalPickup: REQUIRE_CANONICAL_PICKUP,
    syncDriverToAppPickup: SYNC_DRIVER_TO_APP_PICKUP,
    expectedPickupValidation,
  };
  writeArtifact("app-canonical-pickup.json", JSON.stringify(pickupPayload, null, 2));

  if (!pickup) {
    const message =
      "blocked_precondition:app_canonical_pickup_unavailable";
    if (REQUIRE_CANONICAL_PICKUP) {
      failures.push(message);
      warnings.push(
        "Smoke não encontrou a coordenada canônica da origem do app; pagamento bloqueado para evitar validar motorista em outro ponto.",
      );
      return {
        ok: false,
        pickup: null,
        carType,
        managedDriverBot: null,
        availability: null,
      };
    }
    warnings.push(`${message}; continuando porque REAL_SMOKE_REQUIRE_CANONICAL_PICKUP=false.`);
    return {
      ok: true,
      pickup: null,
      carType,
      managedDriverBot: null,
      availability: null,
    };
  }

  if (expectedPickupValidation.requested && !expectedPickupValidation.ok) {
    const mismatchReason = expectedPickupValidation.sourceCertified
      ? "blocked_precondition:app_canonical_pickup_mismatch"
      : "blocked_precondition:expected_pickup_source_uncertified";
    failures.push(mismatchReason);
    warnings.push(
      [
        "Smoke bloqueado antes do pagamento: a origem canônica exibida pelo app diverge da origem esperada do device/teste.",
        `observed=${pickup.lat},${pickup.lng}`,
        `expected=${expectedPickupValidation.expected.lat},${expectedPickupValidation.expected.lng}`,
        `distanceMeters=${expectedPickupValidation.distanceMeters}`,
        `toleranceMeters=${expectedPickupValidation.toleranceMeters}`,
        `sourceCertified=${expectedPickupValidation.sourceCertified}`,
      ].join(" "),
    );
    return {
      ok: false,
      pickup,
      carType,
      managedDriverBot: null,
      availability: null,
    };
  }

  const managedDriverBot = await startManagedDriverBotAtPickup(pickup);
  if (managedDriverBot.requested && !managedDriverBot.ok) {
    failures.push(managedDriverBlockFailure(managedDriverBot.error));
    return {
      ok: false,
      pickup,
      carType,
      managedDriverBot,
      availability: null,
    };
  }

  const availability = await checkSocketAvailabilityAtPickup(pickup, carType);
  if (!availability.ok) {
    const unavailableReason = availability.result?.code || availability.error || "unknown";
    failures.push("blocked_precondition:driver_unavailable");
    warnings.push(
      `Driver availability failed for canonical app pickup before payment: ${unavailableReason}.`,
    );
    return {
      ok: false,
      pickup,
      carType,
      managedDriverBot,
      availability,
    };
  }

  return {
    ok: true,
    pickup,
    carType,
    managedDriverBot,
    availability,
  };
}

function looksLikePixModalScreenshot(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const png = PNG.sync.read(fs.readFileSync(filePath));
    const x0 = Math.floor(png.width * 0.25);
    const x1 = Math.floor(png.width * 0.75);
    const y0 = Math.floor(png.height * 0.48);
    const y1 = Math.floor(png.height * 0.76);
    let black = 0;
    let white = 0;
    let total = 0;

    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const offset = (png.width * y + x) * 4;
        if (png.data[offset + 3] < 128) continue;
        const luminance = (png.data[offset] + png.data[offset + 1] + png.data[offset + 2]) / 3;
        if (luminance < 45) black += 1;
        if (luminance > 220) white += 1;
        total += 1;
      }
    }

    if (total === 0) return false;
    const blackRatio = black / total;
    const whiteRatio = white / total;
    return blackRatio >= 0.12 && whiteRatio >= 0.55;
  } catch (error) {
    warnings.push(`Falha ao inspecionar screenshot Pix: ${error.message}`);
    return false;
  }
}

function tapNode(node, label) {
  if (!node?.center) {
    warnings.push(`Não encontrei coordenadas para tocar em ${label}.`);
    return false;
  }
  adbRun(["shell", "input", "tap", String(node.center.x), String(node.center.y)]);
  return true;
}

function inputText(value) {
  const adbSafeValue = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
  if (adbSafeValue !== String(value)) {
    warnings.push(`Texto normalizado para entrada ADB: "${value}" -> "${adbSafeValue}".`);
  }
  const escaped = adbSafeValue
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "%s")
    .replace(/'/g, "\\'");
  adbRun(["shell", "input", "text", escaped]);
}

function clearFocusedText(maxCharacters = 80) {
  adbRun([
    "shell",
    "input",
    "keyevent",
    "123",
    ...Array.from({ length: maxCharacters }, () => "67"),
  ]);
}

function normalizeInputText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pressKey(keyCode) {
  adbRun(["shell", "input", "keyevent", String(keyCode)]);
}

function tapScreenPoint(x, y, label) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    warnings.push(`Coordenada inválida para tocar em ${label}.`);
    return false;
  }
  adbRun(["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
  return true;
}

async function tapConfirmUntilPayment(current, steps) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const allText = current.nodes.map(combinedText).join("\n");
    if (/verificando categorias|carregando categorias|calculando/i.test(allText)) {
      await sleep(2500);
      current = await captureStep(`07-confirm-wait-ready-${attempt}`);
      steps.push(current);
    }

    const confirmButton = findNodeByPriority(current.nodes, [
      ["passenger-destination-confirm-button"],
      ["Confirmar viagem"],
      ["Confirmar categoria"],
      ["Confirmar"],
    ]);
    if (!tapNode(confirmButton, `botão confirmar tentativa ${attempt}`)) {
      return { current, opened: false, status: detectPaymentStatus(current.nodes) };
    }

    await sleep(attempt === 1 ? 3500 : 6500);
    current = await captureStep(`07-payment-after-confirm-${attempt}`);
    steps.push(current);
    let status = detectPaymentStatus(current.nodes);
    if (current.screen === "passenger_ride_preferences") {
      const preferenceButton = findNodeByPriority(current.nodes, [
        ["passenger-preference-confirm-button"],
        ["Continuar com preferências"],
        ["Continuar"],
      ]);
      if (tapNode(preferenceButton, "botão continuar preferências")) {
        await sleep(6500);
        current = await captureStep(`08-preferences-confirmed-${attempt}`);
        steps.push(current);
        status = detectPaymentStatus(current.nodes);
        if (
          current.screen === "passenger_active_trip" ||
          current.screen === "passenger_searching_driver" ||
          current.screen === "passenger_booking_finalizing"
        ) {
          return { current, opened: true, status: "confirmed_via_ride_flow" };
        }
      }
    }
    if (status === "not_visible" && looksLikePixModalScreenshot(current.screenshot)) {
      return { current, opened: true, status: "pix_visual_detected" };
    }
    if (status === "blocked_no_driver") {
      return { current, opened: false, status };
    }
    if (status !== "not_visible" || current.screen.startsWith("payment_")) {
      return { current, opened: true, status };
    }
    if (
      current.screen === "passenger_active_trip" ||
      current.screen === "passenger_searching_driver" ||
      current.screen === "passenger_booking_finalizing"
    ) {
      return { current, opened: true, status: "confirmed_via_ride_flow" };
    }
    if (attempt === 5) {
      await sleep(6000);
      current = await captureStep("07b-payment-after-confirm-settle");
      steps.push(current);
      status = detectPaymentStatus(current.nodes);
      if (status === "not_visible" && looksLikePixModalScreenshot(current.screenshot)) {
        return { current, opened: true, status: "pix_visual_detected" };
      }
      if (status === "blocked_no_driver") {
        return { current, opened: false, status };
      }
      if (status !== "not_visible" || current.screen.startsWith("payment_")) {
        return { current, opened: true, status };
      }
      if (
        current.screen === "passenger_active_trip" ||
        current.screen === "passenger_searching_driver" ||
        current.screen === "passenger_booking_finalizing"
      ) {
        return { current, opened: true, status: "confirmed_via_ride_flow" };
      }
    }
  }
  return { current, opened: false, status: detectPaymentStatus(current.nodes) };
}

async function waitForPaymentReady(current, steps) {
  const deadline = Date.now() + PAYMENT_WAIT_MS;
  let status = detectPaymentStatus(current.nodes);
  while (
    !["pix_copy_available", "pix_modal_content", "confirmed", "error_visible", "blocked_no_driver"].includes(status) &&
    Date.now() < deadline
  ) {
    await sleep(4000);
    current = await captureStep(`08-payment-wait-${steps.filter((step) => step.name.startsWith("08-payment-wait")).length + 1}`);
    steps.push(current);
    status = detectPaymentStatus(current.nodes);
    if (status === "not_visible" && looksLikePixModalScreenshot(current.screenshot)) {
      status = "pix_visual_detected";
      break;
    }
  }
  return { current, status };
}

function findRatingStarNode(nodes) {
  const starNodes = nodes
    .filter((node) => {
      const content = String(node["content-desc"] || "").trim();
      return (
        node.clickable === "true" &&
        node.center &&
        content.length > 0 &&
        content.length <= 4 &&
        node.boundsRect?.y1 >= 900 &&
        node.boundsRect?.y2 <= 1300
      );
    })
    .sort((a, b) => a.center.x - b.center.x);
  return starNodes[starNodes.length - 1] || null;
}

async function verifyActiveTripMapTap(current, steps) {
  if (!VERIFY_ACTIVE_TRIP_MAP_TAP) {
    return { requested: false, ok: null, skippedReason: "disabled" };
  }
  if (current.screen !== "passenger_active_trip") {
    return {
      requested: true,
      ok: null,
      skippedReason: `screen_not_active_trip:${current.screen}`,
    };
  }

  tapScreenPoint(540, 420, "mapa durante corrida ativa");
  await sleep(1800);
  let afterTap = await captureStep("10-active-trip-after-map-tap");
  steps.push(afterTap);
  if (afterTap.screen === "blank" && afterTap.nodes.length === 0) {
    await sleep(1500);
    const retry = await captureStep("10-active-trip-after-map-tap-retry");
    steps.push(retry);
    if (retry.screen !== "blank" || retry.nodes.length > 0) {
      afterTap = retry;
    }
  }
  const ok = ["passenger_active_trip", "passenger_receipt", "passenger_rating", "passenger_rating_success"].includes(
    afterTap.screen,
  );
  return {
    requested: true,
    ok,
    beforeScreen: current.screen,
    afterScreen: afterTap.screen,
    current: afterTap,
  };
}

async function waitForPostTripReceipt(current, steps) {
  if (!REQUIRE_POST_TRIP) {
    return { requested: false, ok: null, skippedReason: "disabled", current };
  }

  if (current.screen === "passenger_receipt") {
    return { requested: true, ok: true, current, reachedScreen: current.screen };
  }

  const deadline = Date.now() + POST_TRIP_WAIT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    await sleep(5000);
    attempt += 1;
    current = await captureStep(`11-post-trip-wait-${attempt}`);
    steps.push(current);
    if (current.screen === "passenger_receipt") {
      return { requested: true, ok: true, current, reachedScreen: current.screen };
    }
    if (current.screen === "passenger_home") {
      return {
        requested: true,
        ok: false,
        current,
        reachedScreen: current.screen,
        error: "returned_home_before_receipt",
      };
    }
  }

  return {
    requested: true,
    ok: false,
    current,
    reachedScreen: current.screen,
    error: "receipt_timeout",
  };
}

async function completeReceiptRating(current, steps, prefix = "12-receipt-rating") {
  const result = {
    requested: true,
    ok: false,
    initialScreen: current.screen,
    finalScreen: current.screen,
    stages: [],
  };

  if (current.screen !== "passenger_receipt") {
    result.ok = current.screen === "passenger_home";
    result.skippedReason = `screen_not_receipt:${current.screen}`;
    result.current = current;
    return result;
  }

  for (let attempt = 1; attempt <= 3 && current.screen === "passenger_receipt"; attempt += 1) {
    const rateButton = findNodeByPriority(current.nodes, [
      ["passenger-receipt-rate-trip-button"],
      ["Avaliar corrida"],
    ]);
    if (!rateButton || rateButton.enabled === "false") break;
    tapNode(rateButton, `botão avaliar corrida tentativa ${attempt}`);
    await sleep(attempt === 1 ? 2500 : 3500);
    current = await captureStep(`${prefix}-01-rating-opened-${attempt}`);
    steps.push(current);
    result.stages.push({ name: current.name, screen: current.screen });
  }

  if (current.screen === "passenger_receipt") {
    const closeButton = findNodeByPriority(current.nodes, [
      ["passenger-receipt-back-to-map-button"],
      ["×"],
    ]);
    if (tapNode(closeButton, "fechar recibo para voltar ao mapa")) {
      await sleep(2500);
      current = await captureStep(`${prefix}-receipt-closed`);
      steps.push(current);
      result.stages.push({ name: current.name, screen: current.screen });
    }
    result.finalScreen = current.screen;
    result.ok = current.screen === "passenger_home";
    result.current = current;
    return result;
  }

  if (current.screen !== "passenger_rating") {
    result.finalScreen = current.screen;
    result.error = `rating_screen_not_reached:${current.screen}`;
    result.current = current;
    return result;
  }

  const starNode = findRatingStarNode(current.nodes);
  if (starNode) {
    tapNode(starNode, "quinta estrela da avaliação");
    await sleep(600);
  } else {
    warnings.push("Não encontrei a estrela de avaliação por acessibilidade; mantendo seleção padrão da tela.");
  }

  const airConditioningYes = findNodeByPriority(current.nodes, [
    ["passenger-rating-air-conditioning-yes"],
    ["Sim"],
  ]);
  if (airConditioningYes) {
    tapNode(airConditioningYes, "confirmação de ar-condicionado");
    await sleep(600);
  }

  current = await captureStep(`${prefix}-02-rating-filled`);
  steps.push(current);
  result.stages.push({ name: current.name, screen: current.screen });

  const submitButton = findNodeByPriority(current.nodes, [
    ["passenger-rating-submit-button"],
    ["Enviar avaliação"],
  ]);
  if (!tapNode(submitButton, "botão enviar avaliação")) {
    result.finalScreen = current.screen;
    result.error = "submit_button_unavailable";
    result.current = current;
    return result;
  }

  await sleep(5000);
  current = await captureStep(`${prefix}-03-rating-submitted`);
  steps.push(current);
  result.stages.push({ name: current.name, screen: current.screen });

  if (current.screen === "passenger_rating_success") {
    const okButton = findNodeByPriority(current.nodes, [["android:id/button1"], ["OK"]]);
    if (tapNode(okButton, "OK da avaliação enviada")) {
      await sleep(3000);
      current = await captureStep(`${prefix}-04-rating-ok`);
      steps.push(current);
      result.stages.push({ name: current.name, screen: current.screen });
    }
  }

  result.finalScreen = current.screen;
  result.ok = current.screen === "passenger_home";
  if (!result.ok) {
    result.error = `final_screen_not_home:${current.screen}`;
  }
  result.current = current;
  return result;
}

async function verifyPostPaymentTripFlow(current, steps, sandboxConfirmed) {
  const result = {
    requested: Boolean(REQUIRE_POST_TRIP || VERIFY_ACTIVE_TRIP_MAP_TAP),
    ok: null,
    skippedReason: null,
    activeTripMapTap: null,
    receipt: null,
    rating: null,
    finalScreen: current.screen,
    current,
  };

  if (!result.requested) {
    result.skippedReason = "disabled";
    return result;
  }

  if (!sandboxConfirmed) {
    result.ok = false;
    result.skippedReason = "sandbox_payment_not_confirmed";
    return result;
  }

  result.activeTripMapTap = await verifyActiveTripMapTap(current, steps);
  if (result.activeTripMapTap?.current) {
    current = result.activeTripMapTap.current;
  }

  result.receipt = await waitForPostTripReceipt(current, steps);
  if (result.receipt?.current) {
    current = result.receipt.current;
  }

  if (result.receipt?.ok) {
    result.rating = await completeReceiptRating(current, steps);
    if (result.rating?.current) {
      current = result.rating.current;
    }
  }

  const requiredChecks = [];
  if (VERIFY_ACTIVE_TRIP_MAP_TAP && result.activeTripMapTap?.ok !== null) {
    requiredChecks.push(result.activeTripMapTap.ok === true);
  }
  if (REQUIRE_POST_TRIP) {
    requiredChecks.push(result.receipt?.ok === true);
    requiredChecks.push(result.rating?.ok === true);
  }

  result.finalScreen = current.screen;
  result.current = current;
  result.ok = requiredChecks.length > 0 ? requiredChecks.every(Boolean) : true;
  return result;
}

async function captureStep(name) {
  const screenshot = path.join(artifactsDir, `${name}.png`);
  const dump = path.join(artifactsDir, `${name}.xml`);

  const screenResult = adbRun(["exec-out", "screencap", "-p"], {
    encoding: "buffer",
    allowFailure: true,
  });
  if (screenResult.status === 0 && screenResult.stdout?.length) {
    fs.writeFileSync(screenshot, screenResult.stdout);
    evidence.push(screenshot);
  } else {
    adbRun(["shell", "screencap", "-p", phoneScreenshotPath], { allowFailure: true });
    adbRun(["pull", phoneScreenshotPath, screenshot], { allowFailure: true });
    if (fs.existsSync(screenshot)) evidence.push(screenshot);
  }

  if (CAPTURE_XML_SETTLE_MS > 0) {
    await sleep(CAPTURE_XML_SETTLE_MS);
  }
  let xml = "";
  let lastDumpStatus = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    adbRun(["shell", "rm", "-f", phoneDumpPath], { allowFailure: true });
    if (fs.existsSync(dump)) fs.unlinkSync(dump);
    const dumpResult = adbRun(["shell", "uiautomator", "dump", phoneDumpPath], { allowFailure: true });
    lastDumpStatus = dumpResult.status;
    adbRun(["pull", phoneDumpPath, dump], { allowFailure: true });
    xml = fs.existsSync(dump) ? fs.readFileSync(dump, "utf8") : "";
    if (xml.trim()) break;
    if (attempt < 3) {
      await sleep(CAPTURE_XML_RETRY_MS);
    }
  }
  if (!xml.trim()) {
    warnings.push(
      `Falha ao capturar XML utilizável em ${name}; evitando reutilizar dump antigo.${lastDumpStatus === 0 ? "" : ` status=${lastDumpStatus}`}`,
    );
  }
  if (xml) evidence.push(dump);
  const nodes = parseNodes(xml);
  const accessibilityLogResult = adbRun(
    ["logcat", "-d", "-v", "time", "-t", "500", "-s", "AccessibilityNodeInfoDumper:I"],
    { allowFailure: true },
  );
  const accessibilityDumpLog =
    accessibilityLogResult.status === 0 ? String(accessibilityLogResult.stdout || "") : "";
  const canonicalPickup = extractCanonicalPickup(nodes, [
    { source: "uiautomator_logcat", text: accessibilityDumpLog },
  ]);
  if (canonicalPickup) {
    lastCanonicalPickup = canonicalPickup;
  }
  if (canonicalPickup && canonicalPickup.source === "uiautomator_logcat") {
    const fallbackPath = path.join(artifactsDir, `${name}-canonical-pickup-uiautomator-logcat.txt`);
    fs.writeFileSync(fallbackPath, accessibilityDumpLog);
    evidence.push(fallbackPath);
  }
  const prices = extractPrices(nodes);
  const screen = detectScreen(nodes);
  const vehicleIdentity = extractRenderedVehicleIdentity(nodes, screen);
  const driverSearchElapsed = extractDriverSearchElapsed(nodes);
  const paymentErrorMessage = extractVisiblePaymentError(nodes);
  const paymentErrorDiagnostics = extractPaymentErrorDiagnostics(nodes);
  return {
    name,
    screenshot,
    dump,
    nodes,
    canonicalPickup,
    accessibilityDumpLog,
    prices,
    screen,
    vehicleIdentity,
    driverSearchElapsed,
    paymentErrorMessage,
    paymentErrorDiagnostics,
  };
}

function startLogcat() {
  adbRun(["logcat", "-c"], { allowFailure: true });
  const logcatPath = path.join(artifactsDir, "android-logcat.txt");
  const output = fs.openSync(logcatPath, "w");
  const child = spawn(adb, adbArgs(["logcat", "-v", "time"]), {
    stdio: ["ignore", output, output],
  });
  evidence.push(logcatPath);
  return {
    path: logcatPath,
    stop() {
      child.kill("SIGTERM");
      fs.closeSync(output);
    },
  };
}

function analyzeLogcat(logcatPath) {
  const text = fs.existsSync(logcatPath) ? fs.readFileSync(logcatPath, "utf8") : "";
  const lines = text.split(/\r?\n/);
  const critical = extractCriticalAppLines(text, APP_PACKAGE);
  const pricingQuote = lines.filter((line) => /pricing\/quote|fetchDynamicPricingQuote|pricing_quote/i.test(line));
  const routing = lines.filter((line) => /route|routes|directions|google maps/i.test(line));
  writeArtifact(
    "logcat-analysis.json",
    JSON.stringify(
      {
        totalLines: lines.length,
        criticalCount: critical.length,
        pricingQuoteCount: pricingQuote.length,
        routingCount: routing.length,
        criticalSample: critical.slice(-30),
        pricingQuoteSample: pricingQuote.slice(-30),
        routingSample: routing.slice(-30),
      },
      null,
      2,
    ),
  );
  return { critical, pricingQuote, routing };
}

function socketIoClientHandshake(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let io;
    try {
      ({ io } = require("socket.io-client"));
    } catch (error) {
      resolve({ ok: false, url, error: `socket.io-client unavailable: ${error.message}` });
      return;
    }

    const socket = io(url, {
      transports: ["websocket", "polling"],
      timeout: timeoutMs,
      reconnection: false,
      forceNew: true,
    });
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      try {
        socket.disconnect();
      } catch (_) {
        // Ignore disconnect cleanup errors.
      }
      resolve(payload);
    };
    socket.on("connect", () =>
      finish({
        ok: true,
        url,
        id: socket.id,
        transport: socket.io?.engine?.transport?.name || "unknown",
      }),
    );
    socket.on("connect_error", (error) =>
      finish({ ok: false, url, error: error?.message || "connect_error" }),
    );
    setTimeout(() => finish({ ok: false, url, error: "timeout" }), timeoutMs + 1000);
  });
}

let androidSerial = process.env.ANDROID_SERIAL || "";

async function main() {
  if (!adb) {
    throw new Error("ADB não encontrado. Defina ADB_BIN ou instale Android platform-tools.");
  }

  const adbDevices = run(adb, ["devices", "-l"], { encoding: "utf8" }).stdout;
  writeArtifact("adb-devices.txt", adbDevices);
  if (!androidSerial) {
    const firstDevice = String(adbDevices)
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .find((parts) => parts[1] === "device");
    androidSerial = firstDevice?.[0] || "";
  }
  if (!androidSerial) {
    throw new Error("Nenhum Android em estado 'device' encontrado no adb.");
  }

  log(`device: ${androidSerial}`);
  const deviceInfo = {
    serial: androidSerial,
    model: adbText(["shell", "getprop", "ro.product.model"]).trim(),
    android: adbText(["shell", "getprop", "ro.build.version.release"]).trim(),
    sdk: adbText(["shell", "getprop", "ro.build.version.sdk"]).trim(),
    package: APP_PACKAGE,
    backendUrl: BACKEND_URL,
    socketUrl: SOCKET_URL,
  };
  writeArtifact("device-info.json", JSON.stringify(deviceInfo, null, 2));

  const packageList = adbText(["shell", "pm", "list", "packages", APP_PACKAGE]);
  if (!packageList.includes(APP_PACKAGE)) {
    throw new Error(`Pacote não instalado no aparelho: ${APP_PACKAGE}`);
  }
  writeArtifact("package-list.txt", packageList);
  writeArtifact("package-dumpsys.txt", adbText(["shell", "dumpsys", "package", APP_PACKAGE], { allowFailure: true }));

  log("checando backend e socket polling");
  const backendHealth = await requestText(`${BACKEND_URL.replace(/\/$/, "")}/health`);
  writeArtifact("backend-health.json", JSON.stringify(backendHealth, null, 2));
  const socketPoll = await requestText(`${SOCKET_URL.replace(/\/$/, "")}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`);
  writeArtifact("backend-socketio-polling.json", JSON.stringify(socketPoll, null, 2));
  const socketRealtime = await socketIoClientHandshake(SOCKET_URL);
  writeArtifact("backend-socketio-client.json", JSON.stringify(socketRealtime, null, 2));
  let paymentRuntimeConfig = null;
  if (OPEN_PAYMENT && PAYMENT_RUNTIME_PHONE) {
    const runtimeUrl = `${BACKEND_URL.replace(/\/$/, "")}/api/app/runtime-config?phone=${encodeURIComponent(PAYMENT_RUNTIME_PHONE)}`;
    paymentRuntimeConfig = await requestText(runtimeUrl);
    writeArtifact("backend-payment-runtime-config.json", JSON.stringify(paymentRuntimeConfig, null, 2));
  }

  const logcat = startLogcat();
  const steps = [];
  let quoteStatus = "not_reached";
  let initialQuote = null;
  let laterQuote = null;
  let quoteStable = null;
  let paymentStatus = OPEN_PAYMENT ? "not_reached" : "skipped";
  let paymentOpened = false;
  let paymentPrices = null;
  let paymentErrorMessage = null;
  let paymentErrorDiagnostics = null;
  let sandboxPaymentConfirmation = { requested: AUTO_CONFIRM_SANDBOX_PAYMENT, ok: null, skippedReason: "not_reached" };
  let dashboardEvidenceCollection = { requested: COLLECT_DASHBOARD_EVIDENCE, ok: null, skippedReason: "not_reached" };
  let appCanonicalPickup = null;
  let appPickupAvailability = null;
  let managedDriverBot = { requested: SYNC_DRIVER_TO_APP_PICKUP, ok: null, skippedReason: "not_reached" };
  let postTripValidation = {
    requested: Boolean(REQUIRE_POST_TRIP || VERIFY_ACTIVE_TRIP_MAP_TAP || COMPLETE_EXISTING_RECEIPT),
    ok: null,
    skippedReason: "not_reached",
  };

  try {
    log("abrindo app em duas passagens para permitir aplicação OTA quando disponível");
    adbRun(["shell", "am", "force-stop", APP_PACKAGE], { allowFailure: true });
    adbRun(["shell", "am", "start", "-W", "-n", `${APP_PACKAGE}/.MainActivity`], { allowFailure: true });
    await sleep(FIRST_LAUNCH_WAIT_MS);
    steps.push(await captureStep("01-first-launch"));

    adbRun(["shell", "am", "force-stop", APP_PACKAGE], { allowFailure: true });
    adbRun(["shell", "am", "start", "-W", "-n", `${APP_PACKAGE}/.MainActivity`], { allowFailure: true });
    await sleep(SECOND_LAUNCH_WAIT_MS);
    let current = await captureStep("02-second-launch");
    steps.push(current);
    log(`tela detectada: ${current.screen}`);

    if (current.screen === "passenger_receipt" && COMPLETE_EXISTING_RECEIPT) {
      postTripValidation = {
        requested: true,
        ok: null,
        kind: "existing_receipt_cleanup",
        rating: await completeReceiptRating(current, steps, "03-existing-receipt-rating"),
      };
      current = postTripValidation.rating?.current || current;
      postTripValidation.ok = postTripValidation.rating?.ok === true;
      postTripValidation.finalScreen = current.screen;
      if (!postTripValidation.ok) {
        failures.push(
          `blocked_precondition:existing_receipt_cleanup_failed:${postTripValidation.rating?.error || current.screen}`,
        );
      }
    }

    if (
      current.screen === "passenger_home" ||
      current.screen === "destination_search" ||
      current.screen === "destination_results"
    ) {
      if (current.screen === "passenger_home") {
        const destinationInput = findNode(current.nodes, [
          "passenger-home-destination-input",
          "para onde",
          "destino",
        ]);
        if (tapNode(destinationInput, "campo de destino")) {
          await sleep(1500);
          current = await captureStep("03-destination-search-opened");
          steps.push(current);
        }
      }

      if (current.screen !== "destination_results") {
        const searchInput = findNode(current.nodes, [
          "passenger-destination-search-input",
          "passenger-home-destination-search-input",
          "Digite o destino",
          "destino da viagem",
          "buscar destino",
        ]);
        tapNode(searchInput, "campo de busca de destino");
        let destinationQueryEntered = false;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          await sleep(500);
          clearFocusedText();
          inputText(DESTINATION_QUERY);
          await sleep(900);
          current = await captureStep(`03b-destination-query-entered-${attempt}`);
          steps.push(current);
          const typedSearchInput = findNode(current.nodes, [
            "passenger-destination-search-input",
            "passenger-home-destination-search-input",
            "buscar destino",
          ]);
          destinationQueryEntered =
            normalizeInputText(typedSearchInput?.text) ===
            normalizeInputText(DESTINATION_QUERY);
          if (destinationQueryEntered) break;
        }
        if (!destinationQueryEntered) {
          failures.push("blocked_precondition:destination_query_input_failed");
          warnings.push(
            `Campo de destino não preservou a consulta completa: ${DESTINATION_QUERY}.`,
          );
        }
        pressKey(66);
        await sleep(7000);
        current = await captureStep("04-destination-results");
        steps.push(current);
      }

      pressKey(111);
      await sleep(1200);
      current = await captureStep("04b-destination-results-keyboard-hidden");
      steps.push(current);

      const firstResult = findNodeByPriority(current.nodes, [
        ["passenger-destination-result-0", "passenger-home-destination-result-0"],
        ["Escolher Copacabana Palace", "Belmond Hotel"],
      ]);
      if (tapNode(firstResult, "primeiro resultado de destino")) {
        await sleep(10000);
        current = await captureStep("05-quote-initial");
        steps.push(current);
        initialQuote = current.prices;

        if (current.screen === "passenger_quote" || current.prices.length > 0) {
          quoteStatus = "reached";
          await sleep(QUOTE_STABILITY_WAIT_MS);
          current = await captureStep("06-quote-after-wait");
          steps.push(current);
          laterQuote = current.prices;
          quoteStable =
            initialQuote.length > 0 &&
            laterQuote.length > 0 &&
            JSON.stringify(initialQuote) === JSON.stringify(laterQuote);
          quoteStatus = quoteStable ? "stable" : "unstable_or_unreadable";
          if (OPEN_PAYMENT) {
            const canonicalReadiness = await prepareCanonicalPickupForPayment(current);
            appCanonicalPickup = canonicalReadiness.pickup;
            appPickupAvailability = canonicalReadiness.availability;
            managedDriverBot = canonicalReadiness.managedDriverBot || managedDriverBot;
            if (!canonicalReadiness.ok) {
              paymentStatus = managedDriverPaymentBlockStatus(
                canonicalReadiness.managedDriverBot?.error,
              );
	          } else {
	            const paymentOpen = await tapConfirmUntilPayment(current, steps);
	            current = paymentOpen.current;
	            paymentOpened = paymentOpen.opened;
	            paymentStatus = paymentOpen.status;
	            paymentErrorMessage = current.paymentErrorMessage || paymentErrorMessage;
	            paymentErrorDiagnostics = current.paymentErrorDiagnostics || paymentErrorDiagnostics;
	          }
	          if (paymentOpened) {
	            if (paymentStatus === "confirmed_via_ride_flow") {
	              paymentPrices = current.prices;
	              sandboxPaymentConfirmation = buildAppFlowPaymentConfirmationEvidence();
	              postTripValidation = await verifyPostPaymentTripFlow(
	                current,
	                steps,
	                true,
	              );
	              current = postTripValidation.current || current;
	            } else {
	              const paymentReady = await waitForPaymentReady(current, steps);
	              current = paymentReady.current;
	              paymentStatus = paymentReady.status;
	              paymentPrices = current.prices;
	              paymentErrorMessage = current.paymentErrorMessage || paymentErrorMessage;
	              paymentErrorDiagnostics = current.paymentErrorDiagnostics || paymentErrorDiagnostics;
	            }
	            if (["pix_copy_available", "pix_modal_content", "pix_visual_detected"].includes(paymentStatus)) {
	              sandboxPaymentConfirmation = runSandboxPaymentConfirmation();
	              dashboardEvidenceCollection = runDashboardEvidenceCollection(sandboxPaymentConfirmation);
	              if (sandboxPaymentConfirmation.ok) {
	                await sleep(8000);
	                current = await captureStep("09-payment-after-sandbox-confirmation");
	                steps.push(current);
                  paymentStatus = resolvePostSandboxPaymentStatus({
                    confirmationOk: sandboxPaymentConfirmation.ok,
                    paymentStatus: detectPaymentStatus(current.nodes),
                    screen: current.screen,
                  });
                  postTripValidation = await verifyPostPaymentTripFlow(
                    current,
                    steps,
                    sandboxPaymentConfirmation.ok,
                  );
                  current = postTripValidation.current || current;
                }
              }
            }
          }
        }
      }
    } else if (current.screen === "passenger_quote") {
      if (!ALLOW_EXISTING_QUOTE) {
        failures.push("blocked_precondition:stale_quote_state");
        warnings.push(
          "App abriu com cotação/rota já selecionada; smoke bloqueado para evitar pagamento em origem/destino antigos.",
        );
        current = await captureStep("03-blocked-stale-quote-state");
        steps.push(current);
      } else {
        quoteStatus = "reached";
        initialQuote = current.prices;
        await sleep(QUOTE_STABILITY_WAIT_MS);
        current = await captureStep("03-quote-after-wait");
        steps.push(current);
        laterQuote = current.prices;
        quoteStable =
          initialQuote.length > 0 &&
          laterQuote.length > 0 &&
          JSON.stringify(initialQuote) === JSON.stringify(laterQuote);
        quoteStatus = quoteStable ? "stable" : "unstable_or_unreadable";
        if (OPEN_PAYMENT) {
          const canonicalReadiness = await prepareCanonicalPickupForPayment(current);
          appCanonicalPickup = canonicalReadiness.pickup;
          appPickupAvailability = canonicalReadiness.availability;
          managedDriverBot = canonicalReadiness.managedDriverBot || managedDriverBot;
          if (!canonicalReadiness.ok) {
            paymentStatus = managedDriverPaymentBlockStatus(
              canonicalReadiness.managedDriverBot?.error,
            );
          } else {
            const paymentOpen = await tapConfirmUntilPayment(current, steps);
            current = paymentOpen.current;
            paymentOpened = paymentOpen.opened;
            paymentStatus = paymentOpen.status;
            paymentErrorMessage = current.paymentErrorMessage || paymentErrorMessage;
            paymentErrorDiagnostics = current.paymentErrorDiagnostics || paymentErrorDiagnostics;
	          }
	          if (paymentOpened) {
	            if (paymentStatus === "confirmed_via_ride_flow") {
	              paymentPrices = current.prices;
	              sandboxPaymentConfirmation = buildAppFlowPaymentConfirmationEvidence();
	              postTripValidation = await verifyPostPaymentTripFlow(
	                current,
	                steps,
	                true,
	              );
	              current = postTripValidation.current || current;
	            } else {
	              const paymentReady = await waitForPaymentReady(current, steps);
	              current = paymentReady.current;
	              paymentStatus = paymentReady.status;
	              paymentPrices = current.prices;
	              paymentErrorMessage = current.paymentErrorMessage || paymentErrorMessage;
	              paymentErrorDiagnostics = current.paymentErrorDiagnostics || paymentErrorDiagnostics;
	            }
	            if (["pix_copy_available", "pix_modal_content", "pix_visual_detected"].includes(paymentStatus)) {
	              sandboxPaymentConfirmation = runSandboxPaymentConfirmation();
	              dashboardEvidenceCollection = runDashboardEvidenceCollection(sandboxPaymentConfirmation);
	              if (sandboxPaymentConfirmation.ok) {
                await sleep(8000);
                current = await captureStep("09-payment-after-sandbox-confirmation");
                steps.push(current);
                paymentStatus = resolvePostSandboxPaymentStatus({
                  confirmationOk: sandboxPaymentConfirmation.ok,
                  paymentStatus: detectPaymentStatus(current.nodes),
                  screen: current.screen,
                });
                postTripValidation = await verifyPostPaymentTripFlow(
                  current,
                  steps,
                  sandboxPaymentConfirmation.ok,
                );
                current = postTripValidation.current || current;
              }
            }
          }
        }
      }
    } else if (current.screen === "passenger_searching_driver") {
      quoteStatus = "blocked_existing_active_ride";
      const elapsedLabel = current.driverSearchElapsed || "não identificado";
      if (!ALLOW_EXISTING_ACTIVE_RIDE) {
        failures.push("blocked_precondition:existing_active_ride");
        warnings.push(
          `App abriu com busca de motorista já ativa (${elapsedLabel}); smoke abortado sem alterar a corrida.`,
        );
      } else {
        warnings.push(
          `App abriu com busca de motorista já ativa (${elapsedLabel}); continuação permitida explicitamente, sem atribuição automática.`,
        );
      }
    } else if (current.screen === "auth") {
      warnings.push("App abriu na autenticação; smoke preservou a sessão e não tentou login/OTP automaticamente.");
    } else if (current.screen === "driver_home") {
      warnings.push("Sessão atual está em perfil de motorista; smoke não trocou perfil automaticamente.");
    } else {
      warnings.push(`Tela inicial não reconhecida pelo smoke: ${current.screen}.`);
    }
  } finally {
    await sleep(1500);
    logcat.stop();
  }

  const logAnalysis = analyzeLogcat(logcat.path);
  const fareConsistency = buildFareConsistencyReport({
    steps,
    initialQuote,
    laterQuote,
    sandboxPaymentConfirmation,
    managedDriverBot,
  });
  const driverVehicleConsistency = compareRenderedVehicleIdentity(
    managedDriverBot?.vehicleIdentity?.identity || {},
    steps
      .filter((step) => step.vehicleIdentity)
      .map((step) => ({
        step: step.name,
        screen: step.screen,
        ...step.vehicleIdentity,
      })),
  );
  if (logAnalysis.critical.length > 0) {
    failures.push(`Logcat registrou ${logAnalysis.critical.length} linhas críticas.`);
  }
  if (quoteStatus === "unstable_or_unreadable") {
    warnings.push("Cotação foi alcançada, mas o smoke não conseguiu provar estabilidade visual por texto acessível.");
  }
  if (STRICT_QUOTE && quoteStable !== true) {
    failures.push(`STRICT_QUOTE=true exige cotação estável; status atual: ${quoteStatus}.`);
  }
  const paymentBlockedByPrecondition = String(paymentStatus || "").startsWith("blocked_precondition");
  if (OPEN_PAYMENT && !paymentOpened && !paymentBlockedByPrecondition) {
    failures.push(`REAL_SMOKE_OPEN_PAYMENT=true exige abertura do modal Pix; status atual: ${paymentStatus}.`);
  }
  if (OPEN_PAYMENT && paymentOpened && !paymentBlockedByPrecondition && !["pix_copy_available", "pix_modal_content", "pix_visual_detected", "confirmed", "confirmed_via_ride_flow"].includes(paymentStatus)) {
    failures.push(`Modal Pix abriu, mas não chegou a um estado pronto; status atual: ${paymentStatus}${paymentErrorDiagnosticSuffix(paymentErrorDiagnostics)}.`);
  }
  if (AUTO_CONFIRM_SANDBOX_PAYMENT && !paymentBlockedByPrecondition && !sandboxPaymentConfirmation.ok) {
    failures.push(`Baixa automática sandbox falhou: ${sandboxPaymentConfirmation.error || sandboxPaymentConfirmation.stderr || "unknown"}`);
  }
  if (
    (REQUIRE_POST_TRIP || VERIFY_ACTIVE_TRIP_MAP_TAP) &&
    postTripValidation.requested &&
    postTripValidation.ok === false
  ) {
    failures.push(
      `Validação pós-corrida falhou: ${postTripValidation.receipt?.error || postTripValidation.rating?.error || postTripValidation.activeTripMapTap?.error || postTripValidation.finalScreen || "unknown"}`,
    );
  }
  if (!fareConsistency.ok) {
    failures.push(
      `Consistência de tarifa falhou: ${fareConsistency.mismatches
        .map((entry) => `${entry.stage}=R$ ${entry.amount.toFixed(2)}`)
        .join(", ") || "cotação indisponível"}`,
    );
  }
  if (managedDriverBot?.vehicleIdentity?.ok && !driverVehicleConsistency.ok) {
    failures.push("driver_vehicle_identity_mismatch");
  }
  if (
    REQUIRE_POST_TRIP &&
    managedDriverBot?.vehicleIdentity?.ok &&
    !driverVehicleConsistency.coverage.activeTrip
  ) {
    failures.push("driver_vehicle_identity_active_trip_evidence_missing");
  }
  if (
    REQUIRE_POST_TRIP &&
    managedDriverBot?.vehicleIdentity?.ok &&
    !driverVehicleConsistency.coverage.receipt
  ) {
    failures.push("driver_vehicle_identity_receipt_evidence_missing");
  }
  if (COLLECT_DASHBOARD_EVIDENCE && !paymentBlockedByPrecondition && !dashboardEvidenceCollection.ok) {
    failures.push(`Evidência dashboard falhou: ${dashboardEvidenceCollection.error || dashboardEvidenceCollection.stderr || "unknown"}`);
  }

  const failureClassification = buildFailureClassification(failures);
  const result = {
    ok: failures.length === 0,
    finalStatus: failureClassification.finalStatus,
    runId: RUN_ID,
    artifactsDir,
    deviceInfo,
    backendHealth: { ok: backendHealth.ok, status: backendHealth.status, error: backendHealth.error },
    socketPolling: { ok: socketPoll.ok, status: socketPoll.status, error: socketPoll.error },
    socketRealtime,
    paymentRuntimeConfig: paymentRuntimeConfig
      ? { ok: paymentRuntimeConfig.ok, status: paymentRuntimeConfig.status, error: paymentRuntimeConfig.error }
      : null,
    app: {
      package: APP_PACKAGE,
      detectedScreens: steps.map((step) => ({
        name: step.name,
        screen: step.screen,
        prices: step.prices,
        driverSearchElapsed: step.driverSearchElapsed,
        paymentErrorMessage: step.paymentErrorMessage || null,
        paymentErrorDiagnostics: step.paymentErrorDiagnostics || null,
        canonicalPickup: step.canonicalPickup
          ? {
              lat: step.canonicalPickup.lat,
              lng: step.canonicalPickup.lng,
              address: step.canonicalPickup.address,
              source: step.canonicalPickup.source,
            }
          : null,
        vehicleIdentity: step.vehicleIdentity || null,
      })),
      quoteStatus,
      initialQuote,
      laterQuote,
      quoteStable,
      payment: {
        requested: OPEN_PAYMENT,
        opened: paymentOpened,
        status: paymentStatus,
        prices: paymentPrices,
        errorMessage: paymentErrorMessage,
        errorDiagnostics: paymentErrorDiagnostics,
        appCanonicalPickup,
        appPickupAvailability,
        managedDriverBot,
        sandboxConfirmation: sandboxPaymentConfirmation,
        dashboardEvidence: dashboardEvidenceCollection,
        postTripValidation,
      },
      pricingQuoteLogLines: logAnalysis.pricingQuote.length,
      routingLogLines: logAnalysis.routing.length,
      criticalLogLines: logAnalysis.critical.length,
      fareConsistency,
      driverVehicleConsistency,
    },
    warnings,
    failures,
    failureClassification,
    evidence,
    commands,
  };
  writeArtifact("real-smoke-report.json", JSON.stringify(result, null, 2));

  const markdown = [
    "# Android Real Device Smoke",
    "",
    `- Run ID: ${RUN_ID}`,
    `- Device: ${deviceInfo.model} / Android ${deviceInfo.android} / ${deviceInfo.serial}`,
    `- Package: ${APP_PACKAGE}`,
    `- Backend health: ${backendHealth.ok ? "OK" : "FAIL"}${backendHealth.status ? ` (${backendHealth.status})` : ""}`,
    `- Socket.IO client: ${socketRealtime.ok ? "OK" : "FAIL"}${socketRealtime.transport ? ` (${socketRealtime.transport})` : ""}`,
    `- Socket.IO polling probe: ${socketPoll.ok ? "OK" : "FAIL"}${socketPoll.status ? ` (${socketPoll.status})` : ""}`,
    `- Payment runtime config probe: ${paymentRuntimeConfig ? (paymentRuntimeConfig.ok ? "OK" : "FAIL") : "not requested"}${paymentRuntimeConfig?.status ? ` (${paymentRuntimeConfig.status})` : ""}`,
    `- Final status: ${failureClassification.finalStatus}`,
    `- App screens: ${steps.map((step) => `${step.name}:${step.screen}`).join(", ")}`,
    `- Quote status: ${quoteStatus}`,
    `- Quote initial: ${(initialQuote || []).join(", ") || "not captured"}`,
    `- Quote after wait: ${(laterQuote || []).join(", ") || "not captured"}`,
    `- Payment requested: ${OPEN_PAYMENT ? "yes" : "no"}`,
    `- Payment opened: ${paymentOpened ? "yes" : "no"}`,
    `- Payment status: ${paymentStatus}`,
    `- Payment prices: ${(paymentPrices || []).join(", ") || "not captured"}`,
    `- Payment error: ${paymentErrorMessage || "not captured"}`,
    `- Payment error diagnostics: ${formatPaymentErrorDiagnostics(paymentErrorDiagnostics)}`,
    `- App canonical pickup: ${appCanonicalPickup ? `${appCanonicalPickup.lat}, ${appCanonicalPickup.lng}` : "not captured"}`,
    `- App pickup availability: ${appPickupAvailability ? (appPickupAvailability.ok ? "OK" : "FAIL") : "not captured"}`,
    `- Managed driver bot: ${managedDriverBot?.requested ? (managedDriverBot.ok ? "OK" : "FAIL") : "not requested"}`,
    `- Managed driver vehicle identity: ${managedDriverBot?.vehicleIdentity ? (managedDriverBot.vehicleIdentity.ok ? "OK" : `FAIL (${managedDriverBot.vehicleIdentity.code})`) : "not captured"}`,
    `- Driver vehicle consistency: ${driverVehicleConsistency.entries.length > 0 ? (driverVehicleConsistency.ok ? "OK" : "FAIL") : "not captured"}`,
    `- Sandbox payment auto-confirm: ${AUTO_CONFIRM_SANDBOX_PAYMENT ? (sandboxPaymentConfirmation.ok ? "OK" : "FAIL") : "not requested"}`,
    `- Post-trip validation: ${postTripValidation?.requested ? (postTripValidation.ok ? "OK" : postTripValidation.ok === false ? "FAIL" : "not reached") : "not requested"}`,
    `- Fare consistency: ${fareConsistency.ok ? "OK" : "FAIL"}${fareConsistency.quote ? ` (quote R$ ${fareConsistency.quote.amount.toFixed(2)})` : ""}`,
    `- Fare gross evidence: ${fareConsistency.entries.map((entry) => `${entry.stage}=R$ ${entry.amount.toFixed(2)}`).join(", ") || "not captured"}`,
    `- Driver net evidence: ${fareConsistency.driverNetEntries.map((entry) => `${entry.stage}=R$ ${entry.amount.toFixed(2)}`).join(", ") || "not captured"}`,
    `- Driver fee evidence: ${fareConsistency.driverFeeEntries.map((entry) => `${entry.stage}=R$ ${entry.amount.toFixed(2)}`).join(", ") || "not captured"}`,
    `- Dashboard evidence: ${COLLECT_DASHBOARD_EVIDENCE ? (dashboardEvidenceCollection.ok ? "OK" : "FAIL") : "not requested"}`,
    `- Pricing quote log lines: ${logAnalysis.pricingQuote.length}`,
    `- Routing log lines: ${logAnalysis.routing.length}`,
    `- Critical log lines: ${logAnalysis.critical.length}`,
    "",
    "## Warnings",
    warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- None",
    "",
    "## Failures",
    failures.length ? failures.map((item) => `- ${item}`).join("\n") : "- None",
    "",
    "## Failure Classification",
    failureClassification.items.length
      ? failureClassification.items
          .map((item) => `- [${item.domain}/${item.status}/${item.severity}] ${item.message} (owner: ${item.owner})`)
          .join("\n")
      : "- None",
    "",
    "## Evidence",
    ...evidence.map((filePath) => `- ${filePath}`),
    "",
  ].join("\n");
  writeArtifact("real-smoke-report.md", markdown);
  runFinalReportBuilder();

  log(`artifacts: ${artifactsDir}`);
  log(`report: ${path.join(artifactsDir, "real-smoke-report.md")}`);
  log(`final report: ${path.join(artifactsDir, "smoke-e2e-final-report.md")}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  failures.push(error.message);
  const failureClassification = buildFailureClassification(failures);
  writeArtifact(
    "real-smoke-failure.json",
    JSON.stringify(
      {
        error: error.message,
        stack: error.stack,
        finalStatus: failureClassification.finalStatus,
        failures,
        failureClassification,
        warnings,
        evidence,
        commands,
      },
      null,
      2,
    ),
  );
  console.error(`[real-smoke][error] ${error.message}`);
  process.exitCode = 1;
});
