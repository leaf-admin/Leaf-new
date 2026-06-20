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
const PAYMENT_RUNTIME_PHONE = process.env.PAYMENT_RUNTIME_PHONE || process.env.FIREBASE_TEST_PHONE || "";
const PAYMENT_PASSENGER_UID =
  process.env.REAL_SMOKE_PASSENGER_UID ||
  process.env.PASSENGER_UID_FILTER ||
  process.env.FIREBASE_TEST_UID ||
  process.env.PAYMENT_RUNTIME_UID ||
  "";
const FIRST_LAUNCH_WAIT_MS = Number(process.env.FIRST_LAUNCH_WAIT_MS || 15000);
const SECOND_LAUNCH_WAIT_MS = Number(process.env.SECOND_LAUNCH_WAIT_MS || 12000);
const QUOTE_STABILITY_WAIT_MS = Number(process.env.QUOTE_STABILITY_WAIT_MS || 18000);
const PAYMENT_WAIT_MS = Number(process.env.REAL_SMOKE_PAYMENT_WAIT_MS || 30000);
const CAPTURE_XML_SETTLE_MS = Number(process.env.REAL_SMOKE_CAPTURE_XML_SETTLE_MS || 700);
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
const artifactsDir = path.join(mobileDir, "test-results", `android_real_smoke_${RUN_ID}`);
const phoneScreenshotPath = "/sdcard/leaf-real-smoke-screen.png";
const phoneDumpPath = "/sdcard/leaf-real-smoke-window.xml";

fs.mkdirSync(artifactsDir, { recursive: true });

const evidence = [];
const commands = [];
const warnings = [];
const failures = [];

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

function extractDriverSearchElapsed(nodes) {
  const node = findNode(nodes, ["passenger-driver-search-elapsed"]);
  const value = String(node?.text || node?.["content-desc"] || "").trim();
  return /^\d{2}:\d{2}$/.test(value) ? value : null;
}

function detectScreen(nodes) {
  const allText = nodes.map(combinedText).join("\n");
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
  if (
    allText.includes("passenger-receipt-rate-trip-button") ||
    allText.includes("passenger-receipt-report-issue-button")
  ) {
    return "passenger_receipt";
  }
  if (allText.includes("passenger-rating-submit-button")) return "passenger_rating";
  if (allText.includes("passenger-destination-confirm-button")) return "passenger_quote";
  if (
    allText.includes("passenger-destination-search-input") ||
    allText.includes("passenger-home-destination-search-input")
  ) {
    return "destination_search";
  }
  if (allText.includes("passenger-home-destination-result-0")) return "destination_results";
  if (allText.includes("passenger-home-destination-input") || allText.includes("para onde")) return "passenger_home";
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
  const escaped = String(value)
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
    if (status === "not_visible" && looksLikePixModalScreenshot(current.screenshot)) {
      return { current, opened: true, status: "pix_visual_detected" };
    }
    if (status === "blocked_no_driver") {
      return { current, opened: false, status };
    }
    if (status !== "not_visible" || current.screen.startsWith("payment_")) {
      return { current, opened: true, status };
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
  adbRun(["shell", "rm", "-f", phoneDumpPath], { allowFailure: true });
  if (fs.existsSync(dump)) fs.unlinkSync(dump);
  const dumpResult = adbRun(["shell", "uiautomator", "dump", phoneDumpPath], { allowFailure: true });
  if (dumpResult.status === 0) {
    adbRun(["pull", phoneDumpPath, dump], { allowFailure: true });
  } else {
    warnings.push(`Falha ao capturar XML em ${name}; evitando reutilizar dump antigo.`);
  }
  const xml = fs.existsSync(dump) ? fs.readFileSync(dump, "utf8") : "";
  if (xml) evidence.push(dump);
  const nodes = parseNodes(xml);
  const prices = extractPrices(nodes);
  const screen = detectScreen(nodes);
  const driverSearchElapsed = extractDriverSearchElapsed(nodes);
  return {
    name,
    screenshot,
    dump,
    nodes,
    prices,
    screen,
    driverSearchElapsed,
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
  let sandboxPaymentConfirmation = { requested: AUTO_CONFIRM_SANDBOX_PAYMENT, ok: null, skippedReason: "not_reached" };
  let dashboardEvidenceCollection = { requested: COLLECT_DASHBOARD_EVIDENCE, ok: null, skippedReason: "not_reached" };

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
            const paymentOpen = await tapConfirmUntilPayment(current, steps);
            current = paymentOpen.current;
            paymentOpened = paymentOpen.opened;
            paymentStatus = paymentOpen.status;
            if (paymentOpened) {
              const paymentReady = await waitForPaymentReady(current, steps);
              current = paymentReady.current;
              paymentStatus = paymentReady.status;
              paymentPrices = current.prices;
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
          const paymentOpen = await tapConfirmUntilPayment(current, steps);
          current = paymentOpen.current;
          paymentOpened = paymentOpen.opened;
          paymentStatus = paymentOpen.status;
          if (paymentOpened) {
            const paymentReady = await waitForPaymentReady(current, steps);
            current = paymentReady.current;
            paymentStatus = paymentReady.status;
            paymentPrices = current.prices;
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
  if (logAnalysis.critical.length > 0) {
    failures.push(`Logcat registrou ${logAnalysis.critical.length} linhas críticas.`);
  }
  if (quoteStatus === "unstable_or_unreadable") {
    warnings.push("Cotação foi alcançada, mas o smoke não conseguiu provar estabilidade visual por texto acessível.");
  }
  if (STRICT_QUOTE && quoteStable !== true) {
    failures.push(`STRICT_QUOTE=true exige cotação estável; status atual: ${quoteStatus}.`);
  }
  if (OPEN_PAYMENT && !paymentOpened) {
    failures.push(`REAL_SMOKE_OPEN_PAYMENT=true exige abertura do modal Pix; status atual: ${paymentStatus}.`);
  }
  if (OPEN_PAYMENT && paymentOpened && !["pix_copy_available", "pix_modal_content", "pix_visual_detected", "confirmed"].includes(paymentStatus)) {
    failures.push(`Modal Pix abriu, mas não chegou a um estado pronto; status atual: ${paymentStatus}.`);
  }
  if (AUTO_CONFIRM_SANDBOX_PAYMENT && !sandboxPaymentConfirmation.ok) {
    failures.push(`Baixa automática sandbox falhou: ${sandboxPaymentConfirmation.error || sandboxPaymentConfirmation.stderr || "unknown"}`);
  }
  if (COLLECT_DASHBOARD_EVIDENCE && !dashboardEvidenceCollection.ok) {
    failures.push(`Evidência dashboard falhou: ${dashboardEvidenceCollection.error || dashboardEvidenceCollection.stderr || "unknown"}`);
  }

  const result = {
    ok: failures.length === 0,
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
        sandboxConfirmation: sandboxPaymentConfirmation,
        dashboardEvidence: dashboardEvidenceCollection,
      },
      pricingQuoteLogLines: logAnalysis.pricingQuote.length,
      routingLogLines: logAnalysis.routing.length,
      criticalLogLines: logAnalysis.critical.length,
    },
    warnings,
    failures,
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
    `- App screens: ${steps.map((step) => `${step.name}:${step.screen}`).join(", ")}`,
    `- Quote status: ${quoteStatus}`,
    `- Quote initial: ${(initialQuote || []).join(", ") || "not captured"}`,
    `- Quote after wait: ${(laterQuote || []).join(", ") || "not captured"}`,
    `- Payment requested: ${OPEN_PAYMENT ? "yes" : "no"}`,
    `- Payment opened: ${paymentOpened ? "yes" : "no"}`,
    `- Payment status: ${paymentStatus}`,
    `- Payment prices: ${(paymentPrices || []).join(", ") || "not captured"}`,
    `- Sandbox payment auto-confirm: ${AUTO_CONFIRM_SANDBOX_PAYMENT ? (sandboxPaymentConfirmation.ok ? "OK" : "FAIL") : "not requested"}`,
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
  writeArtifact(
    "real-smoke-failure.json",
    JSON.stringify({ error: error.message, stack: error.stack, failures, warnings, evidence, commands }, null, 2),
  );
  console.error(`[real-smoke][error] ${error.message}`);
  process.exitCode = 1;
});
