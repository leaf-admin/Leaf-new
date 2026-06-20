#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const API_BASE_URL = (process.env.API_BASE_URL || process.env.BACKEND_URL || "https://api.leaf.app.br").replace(/\/$/, "");
const RIDE_ID = process.env.RIDE_ID || process.env.BOOKING_ID || "";
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.join(process.cwd(), "test-results", "dashboard-evidence");
const SESSION_PATH = process.env.DASHBOARD_SESSION_PATH || path.join(os.homedir(), ".leaf", "dashboard-session.json");
const ADMIN_ENV_PATH = process.env.ADMIN_ENV_PATH || path.join(os.homedir(), ".leaf", "dashboard-admin.env");
const EXPECTED_GROSS = normalizeMoney(process.env.EXPECTED_GROSS || process.env.EXPECTED_TOTAL || "");
const EXPECTED_FEES = normalizeMoney(process.env.EXPECTED_FEES || process.env.EXPECTED_TOTAL_FEES || "");
const EXPECTED_DRIVER_NET = normalizeMoney(process.env.EXPECTED_DRIVER_NET || "");

function normalizeMoney(value) {
  if (value === "" || value == null) return null;
  const normalized = Number(String(value).replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(normalized) ? Number(normalized.toFixed(2)) : null;
}

function loadAdminEnvToken() {
  if (!fs.existsSync(ADMIN_ENV_PATH)) return "";
  const text = fs.readFileSync(ADMIN_ENV_PATH, "utf8");
  for (const key of ["LEAF_ADMIN_ACCESS_TOKEN", "DASHBOARD_ADMIN_ACCESS_TOKEN", "ADMIN_BEARER_TOKEN", "ADMIN_JWT"]) {
    const match = new RegExp(`^\\s*(?:export\\s+)?${key}=['"]?([^'"\\n]+)['"]?\\s*$`, "m").exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function loadAdminToken() {
  const envToken =
    process.env.LEAF_ADMIN_ACCESS_TOKEN ||
    process.env.DASHBOARD_ADMIN_ACCESS_TOKEN ||
    process.env.ADMIN_BEARER_TOKEN ||
    process.env.ADMIN_JWT ||
    "";
  if (envToken) return envToken;

  const fileEnvToken = loadAdminEnvToken();
  if (fileEnvToken) return fileEnvToken;

  if (!fs.existsSync(SESSION_PATH)) return "";
  try {
    const session = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));
    return (
      session.accessToken ||
      session.token ||
      session.adminAccessToken ||
      session.leaf_admin_access_token ||
      session.session?.accessToken ||
      session.session?.token ||
      ""
    );
  } catch (_) {
    return "";
  }
}

function requestJson(pathname, token) {
  return new Promise((resolve) => {
    const url = new URL(pathname, API_BASE_URL);
    const client = url.protocol === "http:" ? http : https;
    const req = client.request(
      url,
      {
        method: "GET",
        timeout: 15000,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": "leaf-dashboard-evidence/1.0",
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch (_) {
            // Keep raw body for evidence.
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            url: url.toString(),
            json,
            body: json ? undefined : body.slice(0, 2000),
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({ ok: false, url: url.toString(), error: error.message }));
    req.end();
  });
}

function walkNumbers(value, prefix = "", output = []) {
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "number" && Number.isFinite(child)) {
      output.push({ path: nextPrefix, value: Number(child.toFixed(2)) });
    } else if (typeof child === "string") {
      const parsed = normalizeMoney(child);
      if (parsed != null) output.push({ path: nextPrefix, value: parsed, raw: child });
    } else if (child && typeof child === "object") {
      walkNumbers(child, nextPrefix, output);
    }
  }
  return output;
}

function findFirstAmount(numbers, patterns) {
  const normalizedPatterns = patterns.map((pattern) => pattern.toLowerCase());
  return numbers.find((item) => {
    const pathName = item.path.toLowerCase();
    return normalizedPatterns.some((pattern) => pathName.includes(pattern));
  }) || null;
}

function compareAmount(label, expected, actual) {
  if (expected == null) return { label, status: "not_requested" };
  if (!actual) return { label, status: "missing", expected };
  const pathName = String(actual.path || "").toLowerCase();
  const looksLikeCents =
    pathName.includes("cents") ||
    pathName.includes("amount") ||
    pathName.includes("fee") ||
    pathName.includes("net") ||
    pathName.includes("total");
  const centsAsMoney = Number((actual.value / 100).toFixed(2));
  const shouldUseCentsAsMoney =
    looksLikeCents &&
    Number.isInteger(actual.value) &&
    Math.abs(expected - centsAsMoney) <= 0.01;
  const normalizedActual = shouldUseCentsAsMoney ? centsAsMoney : actual.value;
  const delta = Number(Math.abs(expected - normalizedActual).toFixed(2));
  return {
    label,
    status: delta <= 0.01 ? "ok" : "mismatch",
    expected,
    actual: normalizedActual,
    rawActual: actual.value,
    actualPath: actual.path,
    delta,
  };
}

async function main() {
  if (!RIDE_ID) {
    throw new Error("RIDE_ID or BOOKING_ID is required");
  }
  const token = loadAdminToken();
  if (!token) {
    throw new Error("Admin token missing. Set LEAF_ADMIN_ACCESS_TOKEN or DASHBOARD_ADMIN_ACCESS_TOKEN.");
  }

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const reconciliation = await requestJson(`/api/financial/reconciliation/rides/${encodeURIComponent(RIDE_ID)}`, token);
  const health = await requestJson("/api/monitoring/health", token);
  const numbers = walkNumbers(reconciliation.json || {});
  const gross = findFirstAmount(numbers, [
    "gross",
    "totalPaid",
    "totalAmount",
    "passengerAmount",
    "ridePayment.amount",
    "paymentHolding.amount",
    "amountInReais",
    "fare",
  ]);
  const fees = findFirstAmount(numbers, ["totalFees", "fees.total", "feeAmount"]);
  const driverNet = findFirstAmount(numbers, ["driverNet", "driverAmount", "netAmount", "payout"]);
  const comparisons = [
    compareAmount("gross", EXPECTED_GROSS, gross),
    compareAmount("fees", EXPECTED_FEES, fees),
    compareAmount("driverNet", EXPECTED_DRIVER_NET, driverNet),
  ];
  const failures = [];
  if (!reconciliation.ok) failures.push(`reconciliation_http_${reconciliation.status || "error"}`);
  if (reconciliation.json?.report?.ok === false) {
    const issueCodes = Array.isArray(reconciliation.json.report.issueCodes)
      ? reconciliation.json.report.issueCodes
      : [];
    failures.push(
      issueCodes.length > 0
        ? `reconciliation_report_divergent:${issueCodes.join(",")}`
        : "reconciliation_report_divergent",
    );
  }
  comparisons
    .filter((comparison) => comparison.status === "missing" || comparison.status === "mismatch")
    .forEach((comparison) => failures.push(`${comparison.label}_${comparison.status}`));

  const result = {
    ok: failures.length === 0,
    collectedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    rideId: RIDE_ID,
    reconciliation,
    health: { ok: health.ok, status: health.status, error: health.error },
    extractedAmounts: { gross, fees, driverNet },
    comparisons,
    failures,
  };

  const jsonPath = path.join(ARTIFACTS_DIR, "dashboard-evidence.json");
  const mdPath = path.join(ARTIFACTS_DIR, "dashboard-evidence.md");
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(
    mdPath,
    [
      "# Dashboard Ride Evidence",
      "",
      `- Ride: ${RIDE_ID}`,
      `- API: ${API_BASE_URL}`,
      `- Reconciliation: ${reconciliation.ok ? "OK" : "FAIL"}${reconciliation.status ? ` (${reconciliation.status})` : ""}`,
      `- Monitoring health: ${health.ok ? "OK" : "FAIL"}${health.status ? ` (${health.status})` : ""}`,
      `- Gross: ${gross ? `${gross.value} (${gross.path})` : "not found"}`,
      `- Fees: ${fees ? `${fees.value} (${fees.path})` : "not found"}`,
      `- Driver net: ${driverNet ? `${driverNet.value} (${driverNet.path})` : "not found"}`,
      "",
      "## Comparisons",
      ...comparisons.map((item) => `- ${item.label}: ${item.status}${item.expected != null ? ` expected=${item.expected}` : ""}${item.actual != null ? ` actual=${item.actual}` : ""}`),
      "",
      "## Failures",
      failures.length ? failures.map((failure) => `- ${failure}`) : "- None",
      "",
    ].join("\n"),
  );

  console.log(`[dashboard-evidence] ${mdPath}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[dashboard-evidence][error] ${error.message}`);
  process.exitCode = 1;
});
