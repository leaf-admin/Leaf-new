const DEFAULT_API_TARGET = "https://api.leaf.app.br/api";

const resolveProxyTarget = () => {
  const configured = process.env.LEAF_DASHBOARD_API_PROXY_TARGET || DEFAULT_API_TARGET;
  return configured.replace(/\/$/, "");
};

const copyRequestHeaders = (request) => {
  const headers = new Headers();
  const blockedHeaders = new Set([
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
    "proxy-authenticate",
    "proxy-authorization",
    "referer",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);

  request.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (blockedHeaders.has(normalizedKey)) return;
    if (normalizedKey === "authorization" && !value.startsWith("Bearer ")) return;
    headers.set(key, value);
  });

  return headers;
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

async function proxy(request, context) {
  const params = await context.params;
  const path = (params?.path || []).join("/");
  const sourceUrl = new URL(request.url);
  const targetUrl = `${resolveProxyTarget()}/${path}${sourceUrl.search}`;
  const method = request.method.toUpperCase();

  const response = await fetch(targetUrl, {
    method,
    headers: copyRequestHeaders(request),
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    cache: "no-store",
  });

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: copyResponseHeaders(response),
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
