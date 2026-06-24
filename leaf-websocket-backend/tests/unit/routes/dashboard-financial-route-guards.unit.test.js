const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '../../../routes/dashboard.js'),
  'utf8'
);

function extractBlockAfterMarker(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) {
    throw new Error(`Marker not found: ${marker}`);
  }

  const bodyStart = text.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(bodyStart, index + 1);
      }
    }
  }

  throw new Error(`Block not closed: ${marker}`);
}

function expectBackendFinalRevenueGuard(block) {
  expect(block).toContain('resolveRideRevenue');
  expect(block).not.toMatch(/parseFloat\(\s*b\.customer_paid\s*\|\|\s*b\.fare\s*\|\|\s*0\s*\)/);
  expect(block).not.toMatch(/parseFloat\(\s*(booking|trip|b)\.estimate\s*\|\|\s*0\s*\)/);
}

describe('dashboard financial route guards', () => {
  it('keeps legacy dashboard stats from summing mutable fare fields for completed rides', () => {
    expectBackendFinalRevenueGuard(extractBlockAfterMarker(source, "router.get('/api/rides/stats'"));
    expectBackendFinalRevenueGuard(extractBlockAfterMarker(source, "router.get('/api/revenue/stats'"));
  });

  it('keeps cost and growth analytics revenue tied to backend-final snapshots', () => {
    [
      "router.get('/api/costs/per-trip'",
      "router.get('/api/costs/insights'",
      "router.get('/api/analytics/growth'",
      'function getCityAnalysis',
      'function analyzeRevenueGrowth',
      'function generateDailyRevenueGrowth',
      'function calculateTripCosts',
    ].forEach((marker) => {
      expectBackendFinalRevenueGuard(extractBlockAfterMarker(source, marker));
    });
  });
});
