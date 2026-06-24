#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || process.argv[2] || "";
const OUTPUT_PATH =
  process.env.OUTPUT_PATH ||
  (ARTIFACTS_DIR ? path.join(ARTIFACTS_DIR, "smoke-e2e-final-report.md") : "");

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function listFiles(dir, matcher) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath, matcher);
      return matcher(fullPath) ? [fullPath] : [];
    })
    .sort();
}

function status(ok) {
  if (ok === true) return "OK";
  if (ok === false) return "FAIL";
  return "not captured";
}

function main() {
  if (!ARTIFACTS_DIR) {
    throw new Error("ARTIFACTS_DIR or first argument is required");
  }
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    throw new Error(`Artifacts directory not found: ${ARTIFACTS_DIR}`);
  }

  const smoke = readJson(path.join(ARTIFACTS_DIR, "real-smoke-report.json"));
  const dashboard = readJson(path.join(ARTIFACTS_DIR, "dashboard-evidence.json"));
  const payment = readJson(path.join(ARTIFACTS_DIR, "sandbox-payment-confirmation.json"));
  const logcat = readJson(path.join(ARTIFACTS_DIR, "logcat-analysis.json"));
  const screenshots = listFiles(ARTIFACTS_DIR, (filePath) => filePath.endsWith(".png"));
  const jsonFiles = listFiles(ARTIFACTS_DIR, (filePath) => filePath.endsWith(".json"));
  const failures = [
    ...(Array.isArray(smoke?.failures) ? smoke.failures : []),
    ...(Array.isArray(dashboard?.failures) ? dashboard.failures : []),
  ];
  const failureClassificationItems = Array.isArray(smoke?.failureClassification?.items)
    ? smoke.failureClassification.items
    : [];
  const finalStatus =
    smoke?.failureClassification?.finalStatus ||
    smoke?.finalStatus ||
    (failures.length === 0 ? "passed" : "failed");

  const lines = [
    "# Leaf Smoke E2E Final Report",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Artifacts: ${ARTIFACTS_DIR}`,
    `- Overall: ${failures.length === 0 ? "OK" : "FAIL"}`,
    `- Final status: ${finalStatus}`,
    "",
    "## Device/App",
    `- Device: ${smoke?.deviceInfo?.model || "not captured"}`,
    `- Android: ${smoke?.deviceInfo?.android || "not captured"}`,
    `- Package: ${smoke?.deviceInfo?.package || "not captured"}`,
    `- Backend: ${smoke?.deviceInfo?.backendUrl || "not captured"}`,
    "",
    "## Ride Flow",
    `- Backend health: ${status(smoke?.backendHealth?.ok)}`,
    `- Socket polling: ${status(smoke?.socketPolling?.ok)}`,
    `- Socket realtime: ${status(smoke?.socketRealtime?.ok)}`,
    `- Quote status: ${smoke?.app?.quoteStatus || "not captured"}`,
    `- Quote initial: ${(smoke?.app?.initialQuote || []).join(", ") || "not captured"}`,
    `- Quote after wait: ${(smoke?.app?.laterQuote || []).join(", ") || "not captured"}`,
    `- Payment opened: ${status(smoke?.app?.payment?.opened)}`,
    `- Payment status: ${smoke?.app?.payment?.status || "not captured"}`,
    `- Sandbox auto-confirm: ${status(smoke?.app?.payment?.sandboxConfirmation?.ok ?? payment?.response?.success)}`,
    "",
    "## Dashboard/Reconciliation",
    `- Reconciliation: ${status(dashboard?.reconciliation?.ok)}`,
    `- Dashboard health: ${status(dashboard?.health?.ok)}`,
    `- Gross: ${dashboard?.extractedAmounts?.gross?.value ?? "not captured"}`,
    `- Fees: ${dashboard?.extractedAmounts?.fees?.value ?? "not captured"}`,
    `- Driver net: ${dashboard?.extractedAmounts?.driverNet?.value ?? "not captured"}`,
    "",
    "## Runtime Signals",
    `- Critical logcat lines: ${logcat?.criticalCount ?? smoke?.app?.criticalLogLines ?? "not captured"}`,
    `- Pricing quote log lines: ${logcat?.pricingQuoteCount ?? smoke?.app?.pricingQuoteLogLines ?? "not captured"}`,
    `- Routing log lines: ${logcat?.routingCount ?? smoke?.app?.routingLogLines ?? "not captured"}`,
    "",
    "## Failures",
    failures.length ? failures.map((failure) => `- ${failure}`).join("\n") : "- None",
    "",
    "## Failure Classification",
    failureClassificationItems.length
      ? failureClassificationItems
          .map((item) => `- [${item.domain || "unknown"}/${item.status || "unknown"}/${item.severity || "unknown"}] ${item.message || ""} (owner: ${item.owner || "unknown"})`)
          .join("\n")
      : "- None",
    "",
    "## Evidence Index",
    `- Screenshots: ${screenshots.length}`,
    `- JSON files: ${jsonFiles.length}`,
    ...screenshots.map((filePath) => `- ${filePath}`),
    ...jsonFiles.map((filePath) => `- ${filePath}`),
    "",
  ];

  fs.writeFileSync(OUTPUT_PATH, lines.join("\n"));
  console.log(`[smoke-report] ${OUTPUT_PATH}`);
  if (failures.length > 0) process.exitCode = 1;
}

main();
