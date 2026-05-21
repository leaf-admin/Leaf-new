const DEFAULT_API_TARGET = "https://api.leaf.app.br/api";
const SUPPORT_ORCHESTRATOR_ROLES = new Set([
  "admin",
  "manager",
  "super-admin",
  "support",
  "development",
]);

const resolveOrchestratorTarget = () => {
  const configured =
    process.env.SUPPORT_ORCHESTRATOR_URL ||
    process.env.NEXT_PUBLIC_SUPPORT_ORCHESTRATOR_URL ||
    "";
  return configured.replace(/\/$/, "");
};

const resolveDashboardApiTarget = () => {
  const configured =
    process.env.LEAF_DASHBOARD_API_PROXY_TARGET ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_API_TARGET;
  const normalized = configured.replace(/\/$/, "");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
};

const copyResponseHeaders = (response) => {
  const headers = new Headers();
  const blockedHeaders = new Set([
    "connection",
    "content-encoding",
    "content-length",
    "transfer-encoding",
  ]);

  response.headers.forEach((value, key) => {
    if (blockedHeaders.has(key.toLowerCase())) return;
    headers.set(key, value);
  });

  return headers;
};

async function authorizeDashboardRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return {
      response: Response.json(
        { success: false, error: "dashboard_auth_required" },
        { status: 401 },
      ),
    };
  }

  let verifyResponse;
  try {
    verifyResponse = await fetch(`${resolveDashboardApiTarget()}/admin/auth/verify`, {
      headers: { Authorization: authorization },
      cache: "no-store",
    });
  } catch {
    return {
      response: Response.json(
        {
          success: false,
          error: "Falha de conexao ao validar sessao do dashboard. O suporte manual continua disponivel.",
        },
        { status: 502 },
      ),
    };
  }

  if (!verifyResponse.ok) {
    return {
      response: Response.json(
        { success: false, error: "dashboard_auth_invalid" },
        { status: 401 },
      ),
    };
  }

  const payload = await verifyResponse.json().catch(() => ({}));
  const role = String(payload?.user?.role || "").toLowerCase();
  if (!payload?.success || !SUPPORT_ORCHESTRATOR_ROLES.has(role)) {
    return {
      response: Response.json(
        { success: false, error: "support_orchestrator_forbidden" },
        { status: 403 },
      ),
    };
  }

  return { user: payload.user };
}

async function proxySupportOrchestrator(request, context) {
  const target = resolveOrchestratorTarget();
  if (!target) {
    return Response.json(
      {
        success: false,
        error: "Orquestrador de suporte nao configurado no servidor do dashboard",
      },
      { status: 503 },
    );
  }

  const token = String(process.env.SUPPORT_ORCHESTRATOR_TOKEN || "").trim();
  if (!token) {
    return Response.json(
      {
        success: false,
        error: "Token interno do orquestrador nao configurado no servidor do dashboard",
      },
      { status: 503 },
    );
  }

  const authorization = await authorizeDashboardRequest(request);
  if (authorization.response) {
    return authorization.response;
  }

  const params = await context.params;
  const path = (params?.path || []).join("/");
  const sourceUrl = new URL(request.url);
  const targetUrl = `${target}/${path}${sourceUrl.search}`;
  const method = request.method.toUpperCase();
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": request.headers.get("content-type") || "application/json",
  });
  headers.set("X-Orchestrator-Token", token);

  let response;
  try {
    response = await fetch(targetUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      {
        success: false,
        error: "Copiloto de suporte indisponivel: falha de conexao com o orquestrador. O suporte manual continua disponivel.",
      },
      { status: 502 },
    );
  }

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: copyResponseHeaders(response),
  });
}

export const GET = proxySupportOrchestrator;
export const POST = proxySupportOrchestrator;
export const PUT = proxySupportOrchestrator;
export const PATCH = proxySupportOrchestrator;
export const DELETE = proxySupportOrchestrator;
