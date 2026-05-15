#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] || null;
}

function resolveAdbBin() {
  const candidates = [
    process.env.ADB_BIN,
    path.join(process.env.ANDROID_HOME || "", "platform-tools", "adb"),
    path.join(process.env.ANDROID_SDK_ROOT || "", "platform-tools", "adb"),
    path.join(os.homedir(), "Android", "Sdk", "platform-tools", "adb"),
    path.join(os.homedir(), "Library", "Android", "sdk", "platform-tools", "adb"),
    "adb",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "adb" || fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "adb";
}

function run(command, args, options = {}) {
  const result = execFileSync(command, args, { encoding: "utf8", ...options });
  return typeof result === "string" ? result.trim() : "";
}

function adbArgs(deviceId, args) {
  return deviceId ? ["-s", deviceId, ...args] : args;
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

function firstAndroidDevice(adbBin) {
  const output = run(adbBin, ["devices"]);
  const deviceLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /\tdevice$/.test(line));
  return deviceLine ? deviceLine.split(/\s+/)[0] : "";
}

function readRowsFromPulledDatabase(databasePath) {
  const output = run("sqlite3", [
    "-json",
    databasePath,
    "SELECT key, value FROM catalystLocalStorage;",
  ]);
  const rows = safeJsonParse(output);
  return Array.isArray(rows) ? rows : [];
}

function resolveRuntimeSnapshot(rows, authUid) {
  const valuesByKey = new Map(rows.map((row) => [String(row.key || ""), String(row.value || "")]));

  if (authUid) {
    const runtimeKey = `@prototype_runtime_session_${authUid}`;
    const parsed = safeJsonParse(valuesByKey.get(runtimeKey));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  for (const rawValue of valuesByKey.values()) {
    const parsed = safeJsonParse(rawValue);
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

  for (const rawValue of valuesByKey.values()) {
    const parsed = safeJsonParse(rawValue);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, "bookingStatus")
    ) {
      return parsed;
    }
  }

  return null;
}

function main() {
  const adbBin = resolveAdbBin();
  const deviceId = String(readArg("--device") || firstAndroidDevice(adbBin)).trim();
  const appId = String(readArg("--app-id") || "br.com.leaf.ride").trim();
  const field = readArg("--field");

  if (!deviceId || !appId) {
    console.error("usage: read-android-runtime-state.cjs --device <serial> --app-id <appId> [--field <name>]");
    process.exit(1);
  }

  const databasePath = `/data/data/${appId}/databases/RKStorage`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leaf-android-runtime-"));
  const localDbPath = path.join(tempDir, "RKStorage");

  try {
    try {
      run(adbBin, adbArgs(deviceId, ["root"]));
      run(adbBin, adbArgs(deviceId, ["wait-for-device"]));
    } catch (_error) {
      // Some devices reject adb root. The next pull will make that visible.
    }

    run(adbBin, adbArgs(deviceId, ["pull", databasePath, localDbPath]), {
      stdio: ["ignore", "ignore", "pipe"],
    });

    const rows = readRowsFromPulledDatabase(localDbPath);
    const authRow = rows.find((row) => row.key === "@auth_uid");
    const authUid = authRow ? String(authRow.value || "").trim() : "";
    const runtimeSnapshot = resolveRuntimeSnapshot(rows, authUid);

    if (!runtimeSnapshot) {
      process.exit(3);
    }

    if (field) {
      const value = runtimeSnapshot[field];
      if (value === undefined) {
        process.exit(4);
      }
      process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
      return;
    }

    process.stdout.write(JSON.stringify(runtimeSnapshot));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
