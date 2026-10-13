#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const navigationPath = path.join(__dirname, "..", "..", "src", "config", "dashboard-navigation.js");
const accessPath = path.join(__dirname, "..", "..", "src", "utils", "dashboard-access.js");
const navigationSource = fs.readFileSync(navigationPath, "utf8");
const accessSource = fs.readFileSync(accessPath, "utf8");

for (const section of ["Hoje", "Operação", "Financeiro", "Crescimento", "Sistema"]) {
  assert.match(navigationSource, new RegExp(`section: [\\\"']${section}[\\\"']`), `missing navigation section: ${section}`);
}

const roleMatrix = [
  ["/drivers", ["admin", "super-admin", "manager"]],
  ["/maps", ["admin", "super-admin", "manager", "development"]],
  ["/subscriptions", ["admin", "super-admin", "manager"]],
  ["/notifications", ["admin", "super-admin", "manager", "development"]],
  ["/observability", ["admin", "super-admin", "manager", "development"]],
  ["/audit", ["admin", "super-admin", "manager", "development"]],
];

for (const [href, roles] of roleMatrix) {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rolePattern = roles.map((role) => `"${role}"`).join("\\s*,\\s*");
  assert.match(
    navigationSource,
    new RegExp(`href: "${escapedHref}"[\\s\\S]{0,220}allowedRoles: \\[${rolePattern}\\]`),
    `role matrix missing or changed for ${href}`,
  );
}

assert.match(navigationSource, /featureFlag: "campaignCenterEnabled"/);
assert.match(navigationSource, /requireExplicitFeatureFlag: true/);
assert.match(navigationSource, /blockedRoles: \["support", "development"\]/);
assert.match(accessSource, /SUPER_ADMIN_ALIASES/);
assert.match(accessSource, /blockedRoles\.includes\(role\)/);
assert.match(accessSource, /hasAnyPermission\(user, item\?\.requiredPermissions\)/);

process.stdout.write("dashboard role matrix contract: ok\n");
