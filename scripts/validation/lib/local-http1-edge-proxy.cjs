#!/usr/bin/env node

const http = require("http");
const https = require("https");
const tls = require("tls");

const LOCAL_HOST = process.env.LEAF_LOCAL_PROXY_HOST || "127.0.0.1";
const LOCAL_PORT = Number.parseInt(
  process.env.LEAF_LOCAL_PROXY_PORT || "4310",
  10,
);
const REMOTE_API_ORIGIN =
  process.env.LEAF_REMOTE_API_ORIGIN || "https://api.62.169.31.231.sslip.io";
const REMOTE_SOCKET_ORIGIN =
  process.env.LEAF_REMOTE_SOCKET_ORIGIN ||
  "https://socket.62.169.31.231.sslip.io";

const remoteApiUrl = new URL(REMOTE_API_ORIGIN);
const remoteSocketUrl = new URL(REMOTE_SOCKET_ORIGIN);

function getTargetForPath(pathname = "/") {
  const candidatePath = String(pathname || "");
  if (
    candidatePath === "/socket.io" ||
    candidatePath.startsWith("/socket.io/") ||
    candidatePath.startsWith("/socket.io?")
  ) {
    return remoteSocketUrl;
  }
  return remoteApiUrl;
}

function cloneHeaders(headers = {}, targetUrl) {
  const nextHeaders = { ...headers };
  nextHeaders.host = targetUrl.host;
  nextHeaders.connection = "close";
  nextHeaders["x-forwarded-host"] = headers.host || `${LOCAL_HOST}:${LOCAL_PORT}`;
  nextHeaders["x-forwarded-proto"] = "http";
  nextHeaders["x-forwarded-for"] = "127.0.0.1";

  if (nextHeaders.origin) {
    nextHeaders.origin = targetUrl.origin;
  }

  delete nextHeaders["content-length"];
  return nextHeaders;
}

function handleHttpRequest(clientReq, clientRes) {
  const targetUrl = getTargetForPath(clientReq.url);
  const upstreamReq = https.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || 443,
      method: clientReq.method,
      path: clientReq.url,
      headers: cloneHeaders(clientReq.headers, targetUrl),
    },
    (upstreamRes) => {
      clientRes.writeHead(
        upstreamRes.statusCode || 502,
        upstreamRes.statusMessage,
        upstreamRes.headers,
      );
      upstreamRes.pipe(clientRes);
    },
  );

  upstreamReq.on("error", (error) => {
    clientRes.writeHead(502, { "content-type": "application/json" });
    clientRes.end(
      JSON.stringify({
        ok: false,
        message: "local proxy upstream error",
        error: error.message,
      }),
    );
  });

  clientReq.pipe(upstreamReq);
}

function serializeUpgradeRequest(req, targetUrl) {
  const headers = cloneHeaders(req.headers, targetUrl);
  headers.connection = "Upgrade";
  headers.upgrade = req.headers.upgrade || "websocket";
  delete headers.origin;
  delete headers.referer;

  const lines = [`${req.method || "GET"} ${req.url} HTTP/1.1`];
  Object.entries(headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => lines.push(`${key}: ${entry}`));
      return;
    }
    if (typeof value === "undefined") {
      return;
    }
    lines.push(`${key}: ${value}`);
  });
  lines.push("", "");
  return lines.join("\r\n");
}

function handleUpgrade(req, socket, head) {
  const targetUrl = getTargetForPath(req.url);
  const upgradeHeaders = {
    host: req.headers.host || null,
    origin: req.headers.origin || null,
    connection: req.headers.connection || null,
    upgrade: req.headers.upgrade || null,
    "sec-websocket-key": req.headers["sec-websocket-key"] || null,
    "sec-websocket-version": req.headers["sec-websocket-version"] || null,
    "sec-websocket-protocol": req.headers["sec-websocket-protocol"] || null,
    "user-agent": req.headers["user-agent"] || null,
  };
  console.log(
    `[local-http1-edge-proxy] upgrade ${req.url} -> ${targetUrl.origin}`,
  );
  console.log(
    `[local-http1-edge-proxy] upgrade headers ${JSON.stringify(upgradeHeaders)}`,
  );
  const upstreamSocket = tls.connect({
    host: targetUrl.hostname,
    port: Number(targetUrl.port || 443),
    servername: targetUrl.hostname,
    rejectUnauthorized: true,
  });

  const closeBoth = () => {
    try {
      socket.destroy();
    } catch (_error) {}
    try {
      upstreamSocket.destroy();
    } catch (_error) {}
  };

  let upgradeResponseBuffer = Buffer.alloc(0);
  let tunnelingStarted = false;

  const startTunneling = (initialChunk = null) => {
    if (tunnelingStarted) {
      return;
    }
    tunnelingStarted = true;
    upstreamSocket.off("data", onUpstreamData);

    if (initialChunk && initialChunk.length > 0) {
      socket.write(initialChunk);
    }

    socket.pipe(upstreamSocket).pipe(socket);
  };

  const onUpstreamData = (chunk) => {
    upgradeResponseBuffer = Buffer.concat([upgradeResponseBuffer, chunk]);
    const headerEndIndex = upgradeResponseBuffer.indexOf("\r\n\r\n");
    if (headerEndIndex === -1) {
      return;
    }

    const headerChunk = upgradeResponseBuffer.slice(0, headerEndIndex + 4);
    const remainingChunk = upgradeResponseBuffer.slice(headerEndIndex + 4);
    const statusLine =
      headerChunk.toString("utf8").split("\r\n")[0] || "HTTP/1.1 ???";

    console.log(
      `[local-http1-edge-proxy] upgrade response ${req.url} <= ${statusLine}`,
    );

    socket.write(headerChunk);
    startTunneling(remainingChunk);
  };

  upstreamSocket.on("secureConnect", () => {
    try {
      upstreamSocket.on("data", onUpstreamData);
      upstreamSocket.write(serializeUpgradeRequest(req, targetUrl));
      if (head && head.length > 0) {
        upstreamSocket.write(head);
      }
    } catch (_error) {
      closeBoth();
    }
  });

  upstreamSocket.on("error", closeBoth);
  socket.on("error", closeBoth);
  socket.on("close", closeBoth);
}

const server = http.createServer(handleHttpRequest);
server.on("upgrade", handleUpgrade);
server.on("clientError", (error, socket) => {
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch (_socketError) {}
  console.error("[local-http1-edge-proxy] client error:", error.message);
});

server.listen(LOCAL_PORT, LOCAL_HOST, () => {
  console.log(
    `[local-http1-edge-proxy] listening on http://${LOCAL_HOST}:${LOCAL_PORT}`,
  );
  console.log(
    `[local-http1-edge-proxy] api => ${remoteApiUrl.origin} | socket => ${remoteSocketUrl.origin}`,
  );
});
