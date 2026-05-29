#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'https://api.leaf.app.br/api';

const SCENARIOS = [
  {
    name: 'rio-dashboard-zoom14',
    query: {
      bbox: '-43.20,-22.93,-43.15,-22.89',
      zoom: 14,
      surface: 'dashboard',
      mode: 'supply_demand',
      includeBoundary: true,
      includeEmpty: false
    }
  },
  {
    name: 'rio-driver-zoom16',
    query: {
      bbox: '-43.20,-22.93,-43.15,-22.89',
      zoom: 16,
      surface: 'driver',
      mode: 'supply_demand',
      includeBoundary: true,
      includeEmpty: false
    }
  },
  {
    name: 'sf-driver-include-empty',
    query: {
      bbox: '-122.44,37.75,-122.39,37.80',
      zoom: 16,
      surface: 'driver',
      mode: 'supply_demand',
      includeBoundary: true,
      includeEmpty: true
    }
  }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildReportPath() {
  return path.join(__dirname, '..', '..', 'reports', `smoke-h3-map-vps-${Date.now()}.json`);
}

function writeReport(report, reportPath) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function getJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(query) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });
  return `${API_BASE_URL}/map/h3-cells?${params.toString()}`;
}

function validateCellShape(cell, scenarioName) {
  assert(cell && typeof cell === 'object', `${scenarioName}:cell_missing`);
  assert(typeof cell.h3Index === 'string' && cell.h3Index.length > 5, `${scenarioName}:h3_index_missing`);
  assert(Number.isFinite(Number(cell.resolution)), `${scenarioName}:resolution_missing`);
  assert(Number.isFinite(Number(cell.center?.lat)), `${scenarioName}:center_lat_missing`);
  assert(Number.isFinite(Number(cell.center?.lng)), `${scenarioName}:center_lng_missing`);
  assert(Array.isArray(cell.boundary), `${scenarioName}:boundary_missing`);
  assert(cell.boundary.length >= 6, `${scenarioName}:boundary_too_small`);
  assert(Number.isFinite(Number(cell.metrics?.supply)), `${scenarioName}:supply_missing`);
  assert(Number.isFinite(Number(cell.metrics?.demand)), `${scenarioName}:demand_missing`);
  assert(Number.isFinite(Number(cell.metrics?.imbalance)), `${scenarioName}:imbalance_missing`);
  assert(typeof cell.metrics?.demandLevel === 'string', `${scenarioName}:demand_level_missing`);
  assert(typeof cell.metrics?.fillRateHint === 'string', `${scenarioName}:fill_rate_hint_missing`);
  assert(typeof cell.style?.fill === 'string', `${scenarioName}:style_fill_missing`);
  assert(typeof cell.style?.stroke === 'string', `${scenarioName}:style_stroke_missing`);
}

async function main() {
  const reportPath = buildReportPath();
  const report = {
    meta: {
      startedAt: new Date().toISOString(),
      apiBaseUrl: API_BASE_URL,
      reportPath
    },
    scenarios: [],
    status: 'running'
  };

  try {
    for (const scenario of SCENARIOS) {
      const url = buildUrl(scenario.query);
      const startedAt = Date.now();
      const response = await getJson(url, 30000);
      const durationMs = Date.now() - startedAt;

      assert(response.ok, `${scenario.name}:http_${response.status}`);
      assert(Number.isFinite(Number(response.data?.resolution)), `${scenario.name}:invalid_resolution`);
      assert(Array.isArray(response.data?.cells), `${scenario.name}:cells_not_array`);
      assert(response.data?.summary && typeof response.data.summary === 'object', `${scenario.name}:summary_missing`);

      if (response.data.cells.length > 0) {
        validateCellShape(response.data.cells[0], scenario.name);
      }

      report.scenarios.push({
        name: scenario.name,
        query: scenario.query,
        durationMs,
        resolution: response.data.resolution,
        summary: response.data.summary,
        cells: response.data.cells.length,
        sample: response.data.cells[0] || null
      });
    }

    report.status = 'ok';
    report.meta.finishedAt = new Date().toISOString();
    writeReport(report, reportPath);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.meta.finishedAt = new Date().toISOString();
    report.error = {
      message: error.message,
      stack: error.stack
    };
    writeReport(report, reportPath);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
}

main();
