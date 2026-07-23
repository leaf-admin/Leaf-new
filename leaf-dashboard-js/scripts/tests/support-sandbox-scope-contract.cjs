const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dashboardRoot = path.resolve(__dirname, "..", "..");
const apiPath = path.join(dashboardRoot, "src/services/api.js");
const supportPagePath = path.join(dashboardRoot, "app/support/page.js");
const apiSource = fs.readFileSync(apiPath, "utf8");
const supportPage = fs.readFileSync(supportPagePath, "utf8");

const executableApiSource = apiSource
  .replace(/^import .*;\s*$/gm, "")
  .replace(/^export const leafAPI = new LeafApiService\(\);\s*$/m, "")
  .replace(/^export default leafAPI;\s*$/m, "")
  .concat("\nglobalThis.__LeafApiService = LeafApiService;\n");

const sandbox = {
  AbortController,
  FinanceApiClient: class FinanceApiClient {},
  GeofenceApiClient: class GeofenceApiClient {},
  URLSearchParams,
  clearTimeout,
  config: {
    api: { baseUrl: "http://leaf.test", timeoutMs: 1000 },
    supportOrchestrator: {},
  },
  authService: {
    getAccessToken: () => null,
    refreshToken: async () => null,
  },
  console,
  setTimeout,
};
vm.runInNewContext(executableApiSource, sandbox, { filename: apiPath });

const LeafApiService = sandbox.__LeafApiService;
const sandboxContext = { scope: "sandbox" };

function assertSandboxRequest({ endpoint, options }) {
  assert.match(endpoint, /(?:\?|&)scope=sandbox(?:&|$)/, `${endpoint} must carry the sandbox query scope`);
  assert.equal(
    options?.headers?.["X-Leaf-Support-Scope"],
    "sandbox",
    `${endpoint} must carry the sandbox header scope`,
  );
}

async function verifySandboxRequest(methodName, invoke) {
  const api = new LeafApiService();
  const requests = [];
  api.request = async (endpoint, options = {}) => {
    requests.push({ endpoint, options });
    return { success: true, tickets: [], messages: [] };
  };
  await invoke(api);
  assert.equal(requests.length, 1, `${methodName} must issue exactly one scoped request`);
  assertSandboxRequest(requests[0]);
}

async function run() {
  await verifySandboxRequest("getSupportQueueSummary", (api) => api.getSupportQueueSummary(sandboxContext));
  await verifySandboxRequest("getSupportQueueBacklog", (api) => api.getSupportQueueBacklog({ limit: 25 }, sandboxContext));
  await verifySandboxRequest("assignSupportTicket", (api) => api.assignSupportTicket("ticket-1", "agent-1", "Agent", sandboxContext));
  await verifySandboxRequest("escalateSupportTicket", (api) => api.escalateSupportTicket("ticket-1", "risk", sandboxContext));
  await verifySandboxRequest("resolveSupportTicket", (api) => api.resolveSupportTicket("ticket-1", "done", sandboxContext));
  await verifySandboxRequest("getSupportMessages", (api) => api.getSupportMessages("ticket-1", sandboxContext));
  await verifySandboxRequest("sendSupportMessage", (api) => api.sendSupportMessage("ticket-1", "hello", "text", [], sandboxContext));
  await verifySandboxRequest("createSupportTicket", (api) => api.createSupportTicket(
    "subject",
    "description",
    "general",
    "N3",
    {},
    {},
    sandboxContext,
  ));

  const sandboxTicketsApi = new LeafApiService();
  const sandboxTicketRequests = [];
  const expectedFailure = new Error("sandbox unavailable");
  sandboxTicketsApi.request = async (endpoint, options = {}) => {
    sandboxTicketRequests.push({ endpoint, options });
    throw expectedFailure;
  };
  await assert.rejects(
    sandboxTicketsApi.getSupportTickets({ limit: 10 }, sandboxContext),
    (error) => error === expectedFailure,
    "sandbox ticket listing must surface the scoped failure",
  );
  assert.equal(sandboxTicketRequests.length, 1, "sandbox ticket listing must not fall back to the generic operational endpoint");
  assert.match(sandboxTicketRequests[0].endpoint, /^\/support\/admin\/tickets/);
  assertSandboxRequest(sandboxTicketRequests[0]);

  const operationalTicketsApi = new LeafApiService();
  const operationalRequests = [];
  operationalTicketsApi.request = async (endpoint, options = {}) => {
    operationalRequests.push({ endpoint, options });
    if (operationalRequests.length === 1) throw new Error("admin route unavailable");
    return { tickets: [] };
  };
  await operationalTicketsApi.getSupportTickets({ limit: 10 });
  assert.equal(operationalRequests.length, 2, "the existing operational compatibility fallback must remain available");
  assert.match(operationalRequests[1].endpoint, /^\/support\/tickets/);
  assert.doesNotMatch(operationalRequests[1].endpoint, /scope=sandbox/);
  assert.equal(operationalRequests[1].options?.headers?.["X-Leaf-Support-Scope"], undefined);

  const legacyChatApi = new LeafApiService();
  let legacyChatRequests = 0;
  legacyChatApi.request = async () => {
    legacyChatRequests += 1;
    return {};
  };
  await assert.rejects(
    legacyChatApi.getSupportChatInbox({ scope: "sandbox" }),
    /Chats legados não estão disponíveis/,
  );
  await assert.rejects(
    legacyChatApi.sendChatMessage("user-1", "hello", sandboxContext),
    /Chats legados não estão disponíveis/,
  );
  assert.equal(legacyChatRequests, 0, "sandbox mode must fail before touching legacy operational chat endpoints");

  const invalidScopeApi = new LeafApiService();
  let invalidScopeRequests = 0;
  invalidScopeApi.request = async () => {
    invalidScopeRequests += 1;
    return {};
  };
  await assert.rejects(
    invalidScopeApi.getSupportQueueSummary({ scope: "sandbo" }),
    /Escopo de suporte inválido/,
  );
  assert.equal(invalidScopeRequests, 0, "an invalid explicit scope must fail closed before any request");

  assert.match(supportPage, /useSearchParams\(\)/, "support page must derive scope explicitly from the URL");
  assert.match(
    supportPage,
    /<SupportPageContent key=\{supportScope\} supportScope=\{supportScope\} \/>/,
    "scope changes must remount the support state instead of retaining records from another namespace",
  );
  assert.match(
    supportPage,
    /if \(!isOperationalSupportScope\) return undefined;[\s\S]*wsService\.on\("support:chat:new"/,
    "sandbox support must not subscribe to operational support realtime events",
  );
  assert.match(
    supportPage,
    /getSupportQueueSummary\(supportApiContext\)/,
    "queue summary must receive the explicit scope",
  );
  assert.match(
    supportPage,
    /getSupportMessages\(normalizedTicketId, supportApiContext\)/,
    "ticket message reads must receive the explicit scope",
  );
  assert.match(
    supportPage,
    /sendSupportMessage\(selectedTicket\.id, text, "text", \[\], supportApiContext\)/,
    "ticket message writes must receive the explicit scope",
  );
  assert.match(
    supportPage,
    /assignSupportTicket\(selectedTicket\.id, agentId, agentName, supportApiContext\)/,
    "ticket mutations must receive the explicit scope",
  );

  process.stdout.write("[support-sandbox-scope-contract] ok\n");
}

run().catch((error) => {
  process.stderr.write(`[support-sandbox-scope-contract] failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
