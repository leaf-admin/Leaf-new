#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const SIMCTL_BIN =
  process.env.SIMCTL_BIN ||
  "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl";

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] || null;
}

function normalizeRole(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["driver", "motorista", "partner", "parceiro"].includes(normalized)) {
    return "driver";
  }
  if (["customer", "passenger", "rider", "cliente"].includes(normalized)) {
    return "customer";
  }
  return "";
}

function resolveStorageKey(role) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) {
    return "";
  }
  return normalizedRole === "driver"
    ? "@prototype_home_automation_driver"
    : "@prototype_home_automation_customer";
}

function md5(value) {
  return crypto.createHash("md5").update(String(value)).digest("hex");
}

function writeStorageValue(storageDir, manifest, key, value) {
  const filePath = path.join(storageDir, md5(key));
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  fs.writeFileSync(filePath, `${serialized}\n`);
  manifest[key] = serialized;
}

function main() {
  const udid = readArg("--udid");
  const appId = readArg("--app-id");
  const role = normalizeRole(readArg("--role"));
  const action = String(readArg("--action") || "").trim();
  const nonce = String(readArg("--nonce") || "").trim() || "queued-home-automation";
  const bookingId = String(readArg("--booking-id") || "").trim();

  if (!udid || !appId || !role || !action) {
    console.error(
      "usage: queue-sim-home-automation.cjs --udid <udid> --app-id <appId> --role <driver|customer> --action <action> [--nonce <nonce>]",
    );
    process.exit(1);
  }

  const containerPath = execFileSync(
    SIMCTL_BIN,
    ["get_app_container", udid, appId, "data"],
    { encoding: "utf8" },
  ).trim();

  const storageDir = path.join(
    containerPath,
    "Library",
    "Application Support",
    appId,
    "RCTAsyncLocalStorage_V1",
  );
  fs.mkdirSync(storageDir, { recursive: true });

  const manifestPath = path.join(storageDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : {};

  writeStorageValue(storageDir, manifest, resolveStorageKey(role), {
    role,
    action,
    nonce,
    ...(bookingId ? { bookingId } : {}),
    queuedAt: new Date().toISOString(),
  });

  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}

main();
