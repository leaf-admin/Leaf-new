#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] || null;
}

function safeJsonParse(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function findRuntimeSnapshotInFiles(storageDir) {
  const entries = fs.readdirSync(storageDir).filter((entry) => entry !== "manifest.json");

  for (const entry of entries) {
    const filePath = path.join(storageDir, entry);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = safeJsonParse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, "bookingStatus") &&
      Object.prototype.hasOwnProperty.call(parsed, "driverOnline")
    ) {
      return parsed;
    }
  }

  return null;
}

function resolveRuntimeSnapshot(storageDir, authUid) {
  const manifestPath = path.join(storageDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest = safeJsonParse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object") {
    return null;
  }

  if (authUid) {
    const runtimeKey = `@prototype_runtime_session_${authUid}`;
    const manifestValue = manifest[runtimeKey];
    const parsedManifestValue =
      typeof manifestValue === "string" ? safeJsonParse(manifestValue) : manifestValue;

    if (
      parsedManifestValue &&
      typeof parsedManifestValue === "object" &&
      !Array.isArray(parsedManifestValue)
    ) {
      return parsedManifestValue;
    }
  }

  return findRuntimeSnapshotInFiles(storageDir);
}

function main() {
  const udid = readArg("--udid");
  const appId = readArg("--app-id");
  const field = readArg("--field");

  if (!udid || !appId) {
    console.error("usage: read-sim-runtime-state.cjs --udid <udid> --app-id <appId> [--field <name>]");
    process.exit(1);
  }

  let containerPath = "";
  try {
    containerPath = execFileSync(
      "xcrun",
      ["simctl", "get_app_container", udid, appId, "data"],
      { encoding: "utf8" },
    ).trim();
  } catch (_error) {
    process.exit(2);
  }

  const storageDir = path.join(
    containerPath,
    "Library",
    "Application Support",
    appId,
    "RCTAsyncLocalStorage_V1",
  );

  if (!fs.existsSync(storageDir)) {
    process.exit(2);
  }

  const manifestPath = path.join(storageDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? safeJsonParse(fs.readFileSync(manifestPath, "utf8"))
    : null;
  const authUid =
    manifest && typeof manifest === "object" ? String(manifest["@auth_uid"] || "").trim() : "";

  const runtimeSnapshot = resolveRuntimeSnapshot(storageDir, authUid);
  if (!runtimeSnapshot) {
    process.exit(3);
  }

  if (field) {
    const value = runtimeSnapshot[field];
    if (value === undefined) {
      process.exit(4);
    }
    if (typeof value === "string") {
      process.stdout.write(value);
      return;
    }
    process.stdout.write(JSON.stringify(value));
    return;
  }

  process.stdout.write(JSON.stringify(runtimeSnapshot));
}

main();
