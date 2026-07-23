#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboardRoot = path.resolve(__dirname, "..", "..");
const supportPage = fs.readFileSync(path.join(dashboardRoot, "app/support/page.js"), "utf8");
const apiService = fs.readFileSync(path.join(dashboardRoot, "src/services/api.js"), "utf8");
const websocketService = fs.readFileSync(
  path.join(dashboardRoot, "src/services/websocket-service.js"),
  "utf8",
);

[
  "support:chat:new",
  "support:chat:closed",
  "support:chat:converted",
  "support:ticket:new",
  "support:message:new",
].forEach((eventName) => {
  assert.match(
    supportPage,
    new RegExp(`wsService\\.on\\(\\"${eventName.replaceAll(":", "\\:")}\\"`),
    `dashboard support must subscribe to ${eventName}`,
  );
  assert.match(
    supportPage,
    new RegExp(`wsService\\.off\\(\\"${eventName.replaceAll(":", "\\:")}\\"`),
    `dashboard support must unsubscribe from ${eventName}`,
  );
});

assert.match(
  supportPage,
  /wsService\s*\.connect\(\{ namespace: "\/dashboard" \}\)/,
  "support realtime must connect to the authenticated dashboard namespace",
);
assert.match(
  websocketService,
  /this\.socket\.emit\("authenticate", \{ jwtToken: token \}\)/,
  "dashboard namespace authentication must send the admin JWT field expected by the backend",
);

const modernRealtimeBlock = supportPage.slice(
  supportPage.indexOf("const onNewSupportTicket"),
  supportPage.indexOf("const onRealtimeReady"),
);
assert.match(
  modernRealtimeBlock,
  /const onNewSupportTicket[\s\S]*loadTickets\(\{ silent: true \}\)/,
  "new support tickets must immediately revalidate the queue",
);
assert.match(
  modernRealtimeBlock,
  /const onNewSupportMessage[\s\S]*loadTickets\(\{ silent: true \}\)/,
  "new support messages must immediately revalidate the queue",
);
assert.match(
  modernRealtimeBlock,
  /eventTicketId[\s\S]*loadTicketMessages\(eventTicketId\)/,
  "new messages for the selected ticket must immediately refresh the canonical thread",
);

assert.match(
  apiService,
  /getSupportMessages\(ticketId,[\s\S]*requestSupport\(`\/support\/tickets\/\$\{ticketId\}\/messages`/,
  "dashboard must read the canonical ticket messages endpoint",
);
assert.match(
  apiService,
  /sendSupportMessage\(ticketId[\s\S]*\/support\/tickets\/\$\{ticketId\}\/messages[\s\S]*method: \"POST\"/,
  "dashboard must reply through the canonical ticket messages endpoint",
);

process.stdout.write("[support-realtime-contract] ok\n");
