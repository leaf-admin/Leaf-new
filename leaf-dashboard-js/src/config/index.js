const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://147.182.204.181:3001/api";

const ensureApiUrl = (url) => {
  if (!url) return "http://147.182.204.181:3001/api";
  return url.endsWith("/api") ? url : `${url.replace(/\/$/, "")}/api`;
};

const apiBaseUrl = ensureApiUrl(rawApiUrl);
const wsBaseUrl =
  process.env.NEXT_PUBLIC_WS_URL ||
  apiBaseUrl.replace(/\/api$/, "");

export const config = {
  api: {
    baseUrl: apiBaseUrl,
    timeoutMs: 10000,
  },
  ws: {
    baseUrl: wsBaseUrl,
  },
  app: {
    name: "Leaf Dashboard",
  },
};

export default config;
