const isDev = process.env.NODE_ENV === "development";
const defaultApiUrl = isDev
  ? "http://localhost:3001/api"
  : "https://api.leaf.app.br/api";
const defaultWsUrl = isDev
  ? "http://localhost:3001"
  : "https://socket.leaf.app.br";

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || defaultApiUrl;
const rawWsUrl = process.env.NEXT_PUBLIC_WS_URL || defaultWsUrl;
const rawSupportOrchestratorUrl = process.env.NEXT_PUBLIC_SUPPORT_ORCHESTRATOR_URL || "";
const supportOrchestratorEnabled =
  process.env.NEXT_PUBLIC_SUPPORT_ORCHESTRATOR_ENABLED === "true" ||
  Boolean(rawSupportOrchestratorUrl);

const ensureApiUrl = (url) => {
  if (!url) return defaultApiUrl;
  return url.endsWith("/api") ? url : `${url.replace(/\/$/, "")}/api`;
};

const ensureSocketUrl = (url) => (url || "").replace(/\/$/, "");

const apiBaseUrl = ensureApiUrl(rawApiUrl);
const wsBaseUrl = ensureSocketUrl(rawWsUrl) || apiBaseUrl.replace(/\/api$/, "");
const supportOrchestratorBaseUrl = supportOrchestratorEnabled
  ? "/api/support-orchestrator"
  : "";

export const config = {
  api: {
    baseUrl: apiBaseUrl,
    timeoutMs: 30000,
  },
  ws: {
    baseUrl: wsBaseUrl,
  },
  supportOrchestrator: {
    baseUrl: supportOrchestratorBaseUrl,
    timeoutMs: 12000,
  },
  app: {
    name: "Leaf Dashboard",
  },
};

export default config;
