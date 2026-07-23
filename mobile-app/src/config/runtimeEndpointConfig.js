import Constants from "expo-constants";

const DEFAULT_API_BASE_URL = "https://api.leaf.app.br";
const DEFAULT_WS_BASE_URL = "https://socket.leaf.app.br";

const firstNonEmpty = (...values) => values.find((value) => {
  if (value === undefined || value === null) return false;
  return String(value).trim() !== "";
});

export const normalizeRuntimeBaseUrl = (
  rawUrl,
  fallback = DEFAULT_API_BASE_URL,
) => {
  const raw = String(rawUrl || "").trim();
  if (!raw) return fallback;
  return raw.replace(/\/+$/, "").replace(/\/api$/i, "");
};

export const deriveRuntimeSocketBaseUrlFromApi = (
  rawUrl,
  fallback = DEFAULT_WS_BASE_URL,
) => {
  const normalized = normalizeRuntimeBaseUrl(rawUrl, fallback);
  try {
    const parsed = new URL(normalized);
    if (/^api(?=[.-])/i.test(parsed.hostname)) {
      parsed.hostname = parsed.hostname.replace(/^api(?=[.-])/i, "socket");
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (_error) {
    return fallback;
  }
};

export const normalizeRuntimeSocketBaseUrl = (
  rawUrl,
  fallback = DEFAULT_WS_BASE_URL,
) => {
  const normalized = normalizeRuntimeBaseUrl(rawUrl, fallback);
  try {
    const parsed = new URL(normalized);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (_error) {
    return fallback;
  }
};

const isRuntimeExtra = (value) => (
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value)
);

const hasRuntimeApiEndpoint = (value) => (
  isRuntimeExtra(value) &&
  ["apiUrl", "backendUrl"]
    .some((key) => firstNonEmpty(value[key]) !== undefined)
);

export const getRuntimeExtra = () => {
  // Metro and OTA manifests describe the update that is running now. In a
  // dev-client, expoConfig can still carry values embedded by an older launch.
  const currentUpdateExtra = Constants?.manifest2?.extra?.expoClient?.extra;
  if (hasRuntimeApiEndpoint(currentUpdateExtra)) {
    return currentUpdateExtra;
  }

  const currentBundleExtra = {
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL,
    wsUrl: process.env.EXPO_PUBLIC_WS_URL,
    socketUrl: process.env.EXPO_PUBLIC_SOCKET_URL,
    mobileTestWsUrl: process.env.MOBILE_TEST_WS_URL,
  };
  if (hasRuntimeApiEndpoint(currentBundleExtra)) {
    return currentBundleExtra;
  }

  const currentClassicManifestExtra = Constants?.manifest?.extra;
  if (hasRuntimeApiEndpoint(currentClassicManifestExtra)) {
    return currentClassicManifestExtra;
  }

  const embeddedExpoExtra = Constants?.expoConfig?.extra;
  return hasRuntimeApiEndpoint(embeddedExpoExtra) ? embeddedExpoExtra : {};
};

export const getRuntimeApiBaseUrl = (
  fallback = DEFAULT_API_BASE_URL,
) => {
  const runtimeExtra = getRuntimeExtra();
  return normalizeRuntimeBaseUrl(
    firstNonEmpty(runtimeExtra.apiUrl, runtimeExtra.backendUrl),
    fallback,
  );
};

export const getRuntimeSocketBaseUrl = (
  fallback = DEFAULT_WS_BASE_URL,
) => {
  const runtimeExtra = getRuntimeExtra();
  const apiBaseUrl = normalizeRuntimeBaseUrl(
    firstNonEmpty(runtimeExtra.apiUrl, runtimeExtra.backendUrl),
    DEFAULT_API_BASE_URL,
  );
  return normalizeRuntimeSocketBaseUrl(
    firstNonEmpty(
      runtimeExtra.wsUrl,
      runtimeExtra.socketUrl,
      runtimeExtra.mobileTestWsUrl,
    ),
    deriveRuntimeSocketBaseUrlFromApi(apiBaseUrl, fallback),
  );
};

export default {
  getRuntimeApiBaseUrl,
  getRuntimeSocketBaseUrl,
  normalizeRuntimeBaseUrl,
  normalizeRuntimeSocketBaseUrl,
  deriveRuntimeSocketBaseUrlFromApi,
  getRuntimeExtra,
};
