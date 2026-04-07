#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { getIdTokenForUid } = require(path.join(
  __dirname,
  "..",
  "..",
  "..",
  "leaf-websocket-backend",
  "tests",
  "e2e",
  "backend",
  "__helpers__",
  "firebase-id-token.js",
));
const { execFileSync } = require("child_process");

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

function readJsonIfExists(filePath, fallbackValue = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallbackValue;
  }
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

function resolveStorageDir(udid, appId) {
  const containerPath = execFileSync(
    "xcrun",
    ["simctl", "get_app_container", udid, appId, "data"],
    { encoding: "utf8" },
  ).trim();

  return path.join(
    containerPath,
    "Library",
    "Application Support",
    appId,
    "RCTAsyncLocalStorage_V1",
  );
}

function buildApprovedDriverActivation(nowIso) {
  return {
    version: 2,
    preRegistrationCompleted: true,
    currentStage: "vehicle_activation",
    canGoOnline: true,
    driverProfileStatus: "approved",
    vehicleProfileStatus: "approved",
    stages: {
      driver_data_activation: {
        status: "approved",
        completedAt: nowIso,
        updatedAt: nowIso,
        checklist: {
          cnhEar: true,
          vehicleRegistration: true,
          inssOrMei: true,
          backgroundCheckConsent: true,
        },
      },
      face_validation: {
        status: "approved",
        completedAt: nowIso,
        updatedAt: nowIso,
        checklist: {
          facialValidation: true,
        },
      },
      vehicle_activation: {
        status: "approved",
        completedAt: nowIso,
        updatedAt: nowIso,
        checklist: {
          crlv: true,
        },
      },
    },
    notifications: [
      {
        id: `seed-driver-activation-${Date.now()}`,
        title: "Ativação aprovada",
        message: "Motorista liberado para ficar online.",
        kind: "driver",
        scope: "driver",
        read: false,
        createdAt: nowIso,
      },
    ],
    updatedAt: nowIso,
  };
}

function buildSeedUserData({ role, ensureUsers }) {
  const nowIso = new Date().toISOString();
  const passengerSeed = ensureUsers?.passenger || {};
  const driverSeed = ensureUsers?.driver || {};

  if (role === "driver") {
    const driverActivation = buildApprovedDriverActivation(nowIso);
    const uid = String(driverSeed.uid || "8vg2kxxqi3TYKlpD6eBlWgYseIq2").trim();
    const phone = String(driverSeed.phone || "+5511888888888").trim();
    const baseProfile = {
      uid,
      id: uid,
      phone,
      phoneNumber: phone,
      email: "motorista.teste@leafapp.com",
      name: "Motorista",
      usertype: "driver",
      userType: "driver",
      role: "driver",
      approved: true,
      canGoOnline: true,
      isTestUser: true,
      vehicleId: driverSeed.vehicleId || "test_vehicle_8vg2kxxqi3TY",
      userVehicleId: driverSeed.userVehicleId || "uv_test_vehicle_8vg2kxxqi3TY",
      carPlate: driverSeed.carPlate || "TES8888",
      carModel: driverSeed.carType || "Model 3",
      carType: "standard",
      profile_image: "",
      driverActivation,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    return {
      authUid: uid,
      userData: {
        ...baseProfile,
        profile: {
          ...baseProfile,
        },
      },
      driverActivation,
    };
  }

  const uid = String(passengerSeed.uid || "OjML1wSzdNRaynjqMRlSW1Y0LVy2").trim();
  const phone = String(passengerSeed.phone || "+5511999999999").trim();
  const baseProfile = {
    uid,
    id: uid,
    phone,
    phoneNumber: phone,
    email: "passageiro.teste@leafapp.com",
    name: "Leaf Passageiro Teste",
    usertype: "customer",
    userType: "customer",
    role: "customer",
    approved: true,
    isTestUser: true,
    isTestCustomer: true,
    profile_image: "",
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    authUid: uid,
    userData: {
      ...baseProfile,
      profile: {
        ...baseProfile,
      },
    },
    driverActivation: null,
  };
}

async function main() {
  const udid = readArg("--udid");
  const appId = readArg("--app-id");
  const role = normalizeRole(readArg("--role"));
  const profileKey = String(readArg("--profile-key") || "").trim();

  if (!udid || !appId || !role) {
    console.error(
      "usage: seed-sim-auth.cjs --udid <udid> --app-id <appId> --role <driver|customer> [--profile-key <ensure-users-entry>]",
    );
    process.exit(1);
  }

  const rootDir = path.resolve(__dirname, "../../..");
  const ensureUsers = readJsonIfExists(
    path.join(rootDir, "mobile-app", "test-results", "qa-preflight", "ensure-users.json"),
    {},
  );
  const selectedEnsureUsers =
    profileKey && ensureUsers && typeof ensureUsers === "object"
      ? {
          ...ensureUsers,
          driver:
            role === "driver" && ensureUsers[profileKey] && typeof ensureUsers[profileKey] === "object"
              ? ensureUsers[profileKey]
              : ensureUsers.driver,
          passenger:
            role === "customer" && ensureUsers[profileKey] && typeof ensureUsers[profileKey] === "object"
              ? ensureUsers[profileKey]
              : ensureUsers.passenger,
        }
      : ensureUsers;
  const { authUid, userData, driverActivation } = buildSeedUserData({
    role,
    ensureUsers: selectedEnsureUsers,
  });
  const qaSocketIdToken = await getIdTokenForUid(authUid);

  const storageDir = resolveStorageDir(udid, appId);
  fs.rmSync(storageDir, { recursive: true, force: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const manifestPath = path.join(storageDir, "manifest.json");
  const manifest = {};

  writeStorageValue(storageDir, manifest, "@auth_uid", authUid);
  writeStorageValue(storageDir, manifest, "@user_data", userData);
  writeStorageValue(storageDir, manifest, "@test_mode", "true");
  writeStorageValue(storageDir, manifest, "@qa_socket_id_token", qaSocketIdToken);

  if (role === "driver" && driverActivation) {
    writeStorageValue(
      storageDir,
      manifest,
      `@prototype_driver_activation_${authUid}`,
      driverActivation,
    );
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
