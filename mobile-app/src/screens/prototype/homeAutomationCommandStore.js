import AsyncStorage from "@react-native-async-storage/async-storage";

const HOME_AUTOMATION_STORAGE_KEYS = Object.freeze({
  driver: "@prototype_home_automation_driver",
  customer: "@prototype_home_automation_customer",
});

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
  return normalizedRole ? HOME_AUTOMATION_STORAGE_KEYS[normalizedRole] : "";
}

function sanitizeCommand(raw = null) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const role = normalizeRole(raw.role);
  const action = String(raw.action || "").trim();
  const nonce = String(raw.nonce || "").trim();
  if (!role || !action) {
    return null;
  }

  return {
    role,
    action,
    nonce: nonce || "persisted-home-automation",
    bookingId: String(raw.bookingId || "").trim() || "",
    queuedAt: String(raw.queuedAt || "").trim() || null,
  };
}

export async function persistHomeAutomationCommand(command) {
  const sanitized = sanitizeCommand(command);
  const storageKey = resolveStorageKey(sanitized?.role);
  if (!sanitized || !storageKey) {
    return null;
  }

  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify(sanitized));
    return sanitized;
  } catch (_error) {
    return null;
  }
}

export async function consumePersistedHomeAutomationCommand(role) {
  const storageKey = resolveStorageKey(role);
  if (!storageKey) {
    return null;
  }

  try {
    const raw = await AsyncStorage.getItem(storageKey);
    await AsyncStorage.removeItem(storageKey);
    return sanitizeCommand(raw ? JSON.parse(raw) : null);
  } catch (_error) {
    return null;
  }
}

export { HOME_AUTOMATION_STORAGE_KEYS };
