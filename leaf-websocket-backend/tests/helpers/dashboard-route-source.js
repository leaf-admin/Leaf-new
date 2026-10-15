const fs = require('fs');
const path = require('path');

// routes/dashboard.js was split into routes/dashboard/*.js. Source-level contract tests
// read the index plus every part, in registration order, as one text.
function readDashboardRouteSource() {
  const routesDir = path.resolve(__dirname, '../../routes');
  const partsDir = path.join(routesDir, 'dashboard');
  const parts = fs.readdirSync(partsDir)
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => (a === 'shared.js' ? -1 : b === 'shared.js' ? 1 : a.localeCompare(b)));
  return [path.join(routesDir, 'dashboard.js'), ...parts.map((name) => path.join(partsDir, name))]
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

module.exports = { readDashboardRouteSource };
