const rideCostTelemetryService = require('./ride-cost-telemetry-service');

const DEFAULT_WINDOW_SIZE = 20;
const MAX_WINDOW_SIZE = 50;
const DEFAULT_USD_BRL_RATE = 5.18;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readNumberFromEnv(names, fallback = 0) {
  for (const name of names) {
    const value = process.env[name];
    if (value === undefined || value === null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function roundMoney(value, precision = 6) {
  return Number(toNumber(value, 0).toFixed(precision));
}

function brlToCents(value) {
  return Math.round(toNumber(value, 0) * 100);
}

function statusFromRatio(ratioPercent) {
  const warningRatio = readNumberFromEnv(['BACKOFFICE_SKU_COST_WARNING_RATIO_PERCENT'], 25);
  const dangerRatio = readNumberFromEnv(['BACKOFFICE_SKU_COST_DANGER_RATIO_PERCENT'], 45);
  if (ratioPercent >= dangerRatio) return 'danger';
  if (ratioPercent >= warningRatio) return 'warning';
  return 'healthy';
}

function normalizeSkuLabel(key, entry = {}) {
  if (entry.label) return String(entry.label);
  const labels = {
    autocompleteLegacyPerRequest: 'Places Autocomplete',
    placeDetailsLegacy: 'Places Details',
    geocoding: 'Geocoding',
    directionsLegacy: 'Directions/Routes',
    directionsAdvancedLegacy: 'Directions/Routes com trânsito',
    distanceMatrixLegacyElement: 'Distance Matrix'
  };
  return labels[key] || key;
}

function createRowAccumulator({ id, provider, family, sku, unitLabel, accounting, detail }) {
  return {
    id,
    provider,
    family,
    sku,
    unitLabel,
    accounting,
    detail,
    usage: 0,
    billableUnits: 0,
    totalCostUsd: 0,
    totalCostBrl: 0
  };
}

function addRow(rows, rowMeta, { usage = 0, billableUnits = usage, costUsd = 0, costBrl = null } = {}) {
  const id = rowMeta.id;
  const existing = rows.get(id) || createRowAccumulator(rowMeta);
  existing.usage += Math.max(0, toNumber(usage, 0));
  existing.billableUnits += Math.max(0, toNumber(billableUnits, 0));
  existing.totalCostUsd = roundMoney(existing.totalCostUsd + Math.max(0, toNumber(costUsd, 0)));
  existing.totalCostBrl = roundMoney(
    existing.totalCostBrl + Math.max(0, toNumber(costBrl, 0)),
  );
  rows.set(id, existing);
}

function finalizeRows(rows, { sampledRides, completedRidesToday }) {
  return Array.from(rows.values())
    .map((row) => {
      const usageBase = row.billableUnits > 0 ? row.billableUnits : row.usage;
      const unitCostBrl = usageBase > 0 ? row.totalCostBrl / usageBase : 0;
      const costPerRideBrl = sampledRides > 0 ? row.totalCostBrl / sampledRides : 0;
      return {
        ...row,
        usage: Number(row.usage.toFixed(3)),
        billableUnits: Number(row.billableUnits.toFixed(3)),
        unitCostBrl: roundMoney(unitCostBrl),
        totalCostBrl: roundMoney(row.totalCostBrl),
        totalCostCents: brlToCents(row.totalCostBrl),
        costPerRideBrl: roundMoney(costPerRideBrl),
        projectedTodayBrl: roundMoney(costPerRideBrl * completedRidesToday),
        projectedTodayCents: brlToCents(costPerRideBrl * completedRidesToday)
      };
    })
    .sort((a, b) => b.projectedTodayBrl - a.projectedTodayBrl);
}

class BackofficeSkuCostMonitorService {
  constructor({
    telemetry = rideCostTelemetryService,
    usdBrlRate = readNumberFromEnv(
      ['RIDE_COST_TELEMETRY_USD_BRL_RATE', 'USD_BRL_EXCHANGE_RATE'],
      DEFAULT_USD_BRL_RATE,
    )
  } = {}) {
    this.telemetry = telemetry;
    this.usdBrlRate = usdBrlRate > 0 ? usdBrlRate : DEFAULT_USD_BRL_RATE;
  }

  windowSize() {
    return clampInteger(
      process.env.BACKOFFICE_SKU_MONITOR_WINDOW_SIZE,
      DEFAULT_WINDOW_SIZE,
      1,
      MAX_WINDOW_SIZE,
    );
  }

  usdToBrl(value) {
    return roundMoney(toNumber(value, 0) * this.usdBrlRate);
  }

  dailyFixedInfraBrl() {
    return Math.max(0, readNumberFromEnv([
      'BACKOFFICE_INFRA_DAILY_COST_BRL',
      'LEAF_INFRA_DAILY_COST_BRL',
      'INFRA_DAILY_COST_BRL'
    ], 0));
  }

  wooviPixChargeFeeBrl() {
    const cents = readNumberFromEnv([
      'WOOVI_PIX_CHARGE_FEE_CENTS',
      'BACKOFFICE_WOOVI_PIX_CHARGE_FEE_CENTS'
    ], 0);
    return Math.max(0, cents / 100);
  }

  wooviWithdrawalUnder500FeeBrl() {
    const cents = readNumberFromEnv([
      'WOOVI_WITHDRAWAL_UNDER_500_FEE_CENTS',
      'BACKOFFICE_WOOVI_WITHDRAWAL_UNDER_500_FEE_CENTS'
    ], 100);
    return Math.max(0, cents / 100);
  }

  async collectUsageSnapshot({ limit } = {}) {
    const normalizedLimit = clampInteger(limit, this.windowSize(), 1, MAX_WINDOW_SIZE);
    const reports = await this.telemetry.getRecentReports(normalizedLimit);
    const rows = new Map();

    reports.forEach((report) => {
      const totals = report?.totals || {};
      const googleSkus = totals.google?.skus || {};
      Object.entries(googleSkus).forEach(([skuKey, skuEntry]) => {
        const costUsd = toNumber(skuEntry?.estimatedCostUsd, 0);
        addRow(rows, {
          id: `google.${skuKey}`,
          provider: 'Google Maps',
          family: 'google',
          sku: normalizeSkuLabel(skuKey, skuEntry),
          unitLabel: skuEntry?.unit || 'unidade faturável',
          accounting: 'infra',
          detail: 'Custo variável de mapa/places/routes capturado pela telemetria da corrida.'
        }, {
          usage: toNumber(skuEntry?.requestCount, 0),
          billableUnits: toNumber(skuEntry?.billableUnits, skuEntry?.requestCount || 0),
          costUsd,
          costBrl: this.usdToBrl(costUsd)
        });
      });

      const backend = totals.backend || {};
      addRow(rows, {
        id: 'backend.socket',
        provider: 'Leaf backend',
        family: 'backend',
        sku: 'Comandos/socket da corrida',
        unitLabel: 'tentativa',
        accounting: 'infra',
        detail: 'Estimativa interna para processamento, socket e lifecycle da corrida.'
      }, {
        usage: toNumber(backend.attempts, 0),
        billableUnits: toNumber(backend.attempts, 0),
        costUsd: toNumber(backend.estimatedCostUsd, 0),
        costBrl: this.usdToBrl(backend.estimatedCostUsd)
      });

      const infrastructure = totals.infrastructure || {};
      [
        ['redis', 'Redis', 'operações Redis', 'read/write'],
        ['firebase', 'Firebase/Firestore/RTDB', 'leituras/gravações Firebase', 'read/write'],
        ['database', 'Banco/ledger', 'leituras/gravações internas', 'read/write']
      ].forEach(([key, provider, sku, unitLabel]) => {
        const section = infrastructure[key] || {};
        const reads = toNumber(section.reads, 0);
        const writes = toNumber(section.writes, 0);
        const costUsd = toNumber(section.estimatedCostUsd, 0);
        addRow(rows, {
          id: `infra.${key}`,
          provider,
          family: key === 'firebase' ? 'firebase' : 'infra',
          sku,
          unitLabel,
          accounting: 'infra',
          detail: `${reads} reads e ${writes} writes registrados na telemetria da corrida.`
        }, {
          usage: reads + writes,
          billableUnits: reads + writes,
          costUsd,
          costBrl: this.usdToBrl(costUsd)
        });
      });
    });

    const sampledRides = reports.length;
    const wooviPixFeeBrl = this.wooviPixChargeFeeBrl();
    if (sampledRides > 0 || wooviPixFeeBrl > 0) {
      addRow(rows, {
        id: 'woovi.pix-charge',
        provider: 'Woovi',
        family: 'woovi',
        sku: 'Cobrança PIX',
        unitLabel: 'cobrança',
        accounting: 'payment_processor',
        detail: 'Separado da infra: a taxa operacional da Leaf cobre produto; Woovi fica evidenciado à parte.'
      }, {
        usage: sampledRides,
        billableUnits: sampledRides,
        costBrl: wooviPixFeeBrl * sampledRides
      });
    }

    const rowsPreview = finalizeRows(rows, {
      sampledRides,
      completedRidesToday: sampledRides
    });

    const totalCostBrl = rowsPreview.reduce((sum, row) => sum + row.totalCostBrl, 0);
    const wooviCostBrl = rowsPreview
      .filter((row) => row.family === 'woovi')
      .reduce((sum, row) => sum + row.totalCostBrl, 0);

    return {
      generatedAt: new Date().toISOString(),
      source: 'ride_cost_telemetry_recent',
      sampledRides,
      windowSize: normalizedLimit,
      exchangeRateUsdBrl: this.usdBrlRate,
      withdrawalUnder500FeeCents: brlToCents(this.wooviWithdrawalUnder500FeeBrl()),
      rows: rowsPreview,
      totals: {
        totalCostBrl: roundMoney(totalCostBrl),
        totalCostWithoutWooviBrl: roundMoney(totalCostBrl - wooviCostBrl),
        wooviCostBrl: roundMoney(wooviCostBrl)
      },
      notes: [
        'Leitura baseada nos relatórios recentes de telemetria já gravados no Redis.',
        'Nao chama Google, Firebase, Redis externo ou Woovi a partir do dashboard.',
        'Woovi fica separado porque pode ser cobrado fora da margem operacional da corrida.'
      ]
    };
  }

  attachFinancials(usageSnapshot = {}, {
    financialToday = {},
    operationalRevenue = {},
    ridesToday = {}
  } = {}) {
    const sampledRides = toNumber(usageSnapshot.sampledRides, 0);
    const completedRidesToday = toNumber(
      financialToday.totalRides ?? ridesToday.completedToday ?? ridesToday.completedRidesToday,
      0,
    );
    const operationalFeeTotalBrl = toNumber(operationalRevenue.totalOperationalFee, 0);
    const operationalFeeAverageBrl = toNumber(
      operationalRevenue.averageFee,
      completedRidesToday > 0 ? operationalFeeTotalBrl / completedRidesToday : 0,
    );
    const fixedInfraDailyBrl = this.dailyFixedInfraBrl();

    const variableCostPerRideBrl = sampledRides > 0
      ? toNumber(usageSnapshot.totals?.totalCostBrl, 0) / sampledRides
      : 0;
    const variableCostWithoutWooviPerRideBrl = sampledRides > 0
      ? toNumber(usageSnapshot.totals?.totalCostWithoutWooviBrl, 0) / sampledRides
      : 0;
    const wooviCostPerRideBrl = sampledRides > 0
      ? toNumber(usageSnapshot.totals?.wooviCostBrl, 0) / sampledRides
      : 0;

    const rows = finalizeRows(new Map(
      (usageSnapshot.rows || []).map((row) => [row.id, row])
    ), {
      sampledRides,
      completedRidesToday
    });

    if (fixedInfraDailyBrl > 0) {
      rows.push({
        id: 'infra.fixed-daily',
        provider: 'Infra Leaf',
        family: 'infra',
        sku: 'Infra fixa diária',
        unitLabel: 'dia',
        accounting: 'infra',
        detail: 'Rateio configurado por BACKOFFICE_INFRA_DAILY_COST_BRL.',
        usage: 1,
        billableUnits: 1,
        unitCostBrl: roundMoney(fixedInfraDailyBrl),
        totalCostUsd: 0,
        totalCostBrl: roundMoney(fixedInfraDailyBrl),
        totalCostCents: brlToCents(fixedInfraDailyBrl),
        costPerRideBrl: completedRidesToday > 0 ? roundMoney(fixedInfraDailyBrl / completedRidesToday) : 0,
        projectedTodayBrl: roundMoney(fixedInfraDailyBrl),
        projectedTodayCents: brlToCents(fixedInfraDailyBrl),
        status: 'info'
      });
    }

    const projectedVariableCostTodayBrl = variableCostPerRideBrl * completedRidesToday;
    const projectedVariableCostWithoutWooviTodayBrl =
      variableCostWithoutWooviPerRideBrl * completedRidesToday;
    const projectedWooviTodayBrl = wooviCostPerRideBrl * completedRidesToday;
    const projectedCostTodayBrl = projectedVariableCostTodayBrl + fixedInfraDailyBrl;
    const projectedCostWithoutWooviTodayBrl =
      projectedVariableCostWithoutWooviTodayBrl + fixedInfraDailyBrl;
    const netAfterInfraBrl = operationalFeeTotalBrl - projectedCostWithoutWooviTodayBrl;
    const netAfterAllBrl = operationalFeeTotalBrl - projectedCostTodayBrl;
    const costRatioPercent = operationalFeeAverageBrl > 0
      ? (variableCostWithoutWooviPerRideBrl / operationalFeeAverageBrl) * 100
      : 0;
    const status = sampledRides === 0
      ? 'no_data'
      : statusFromRatio(costRatioPercent);

    return {
      ...usageSnapshot,
      rows,
      status,
      completedRidesToday,
      finance: {
        operationalFeeTotalCents: brlToCents(operationalFeeTotalBrl),
        operationalFeeAverageCents: brlToCents(operationalFeeAverageBrl),
        variableCostPerRideCents: brlToCents(variableCostPerRideBrl),
        variableCostWithoutWooviPerRideCents: brlToCents(variableCostWithoutWooviPerRideBrl),
        wooviCostPerRideCents: brlToCents(wooviCostPerRideBrl),
        projectedCostTodayCents: brlToCents(projectedCostTodayBrl),
        projectedCostWithoutWooviTodayCents: brlToCents(projectedCostWithoutWooviTodayBrl),
        projectedWooviTodayCents: brlToCents(projectedWooviTodayBrl),
        fixedInfraDailyCents: brlToCents(fixedInfraDailyBrl),
        netAfterInfraCents: brlToCents(netAfterInfraBrl),
        netAfterAllCents: brlToCents(netAfterAllBrl),
        marginAfterInfraPercent: operationalFeeTotalBrl > 0
          ? roundMoney((netAfterInfraBrl / operationalFeeTotalBrl) * 100, 2)
          : 0,
        costRatioPercent: roundMoney(costRatioPercent, 2)
      },
      notes: [
        ...(usageSnapshot.notes || []),
        'O total de hoje usa custo medio da janela recente projetado sobre as corridas finalizadas do dia.',
        'Configure BACKOFFICE_INFRA_DAILY_COST_BRL para incluir o rateio fixo da VPS/infra no liquido.'
      ]
    };
  }
}

const backofficeSkuCostMonitorService = new BackofficeSkuCostMonitorService();

module.exports = backofficeSkuCostMonitorService;
module.exports.BackofficeSkuCostMonitorService = BackofficeSkuCostMonitorService;
