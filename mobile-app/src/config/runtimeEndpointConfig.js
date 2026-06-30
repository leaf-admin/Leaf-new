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

export const getRuntimeExtra = () => (
  Constants?.expoConfig?.extra ||
  Constants?.manifest2?.extra?.expoClient?.extra ||
  Constants?.manifest?.extra ||
  {}
);

export const getRuntimeApiBaseUrl = (
  fallback = DEFAULT_API_BASE_URL,
) => normalizeRuntimeBaseUrl(
  firstNonEmpty(
    getRuntimeExtra()?.apiUrl,
    getRuntimeExtra()?.backendUrl,
    process.env.EXPO_PUBLIC_API_URL,
    process.env.EXPO_PUBLIC_BACKEND_URL,
  ),
  fallback,
);

export const getRuntimeSocketBaseUrl = (
  fallback = DEFAULT_WS_BASE_URL,
) => {
  const apiBaseUrl = getRuntimeApiBaseUrl(DEFAULT_API_BASE_URL);
  return normalizeRuntimeSocketBaseUrl(
    firstNonEmpty(
      getRuntimeExtra()?.wsUrl,
      getRuntimeExtra()?.socketUrl,
      process.env.EXPO_PUBLIC_WS_URL,
      process.env.EXPO_PUBLIC_SOCKET_URL,
      process.env.MOBILE_TEST_WS_URL,
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
