"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

function get(obj, path, fallback = null) {
  if (!obj || !path) return fallback;
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj) ?? fallback;
}

function formatValue(value, format) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/D";
  if (format === "percent") return `${(Number(value) * 100).toFixed(1)}%`;
  if (format === "minutes") return `${Number(value).toFixed(1)} min`;
  if (format === "brl") {
    return `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (format === "decimal") return Number(value).toFixed(2);
  return Number(value).toLocaleString("pt-BR");
}

function summarizeCalcBase(rawValue) {
  if (!rawValue || typeof rawValue !== "object") return "-";
  const entries = Object.entries(rawValue).slice(0, 4);
  if (entries.length === 0) return "-";
  return entries
    .map(([key, value]) => `${key}: ${Number.isFinite(Number(value)) ? Number(value).toLocaleString("pt-BR") : String(value)}`)
    .join(" • ");
}

function evaluateGoal(metric) {
  const value = metric.value;
  if (value === null || value === undefined || Number.isNaN(value)) return "warning";
  if (!metric.targetType) return "default";

  if (metric.targetType === "gte") return value >= metric.target ? "positive" : "danger";
  if (metric.targetType === "lte") return value <= metric.target ? "positive" : "danger";
  if (metric.targetType === "range") {
    if (value >= metric.targetMin && value <= metric.targetMax) return "positive";
    return "warning";
  }
  return "default";
}

const METRIC_CONFIG = [
  { id: "activeDrivers", group: "Resumo Ideal", title: "Motoristas ativos", path: "metrics.drivers.activeDrivers", format: "number", formula: "motoristas com >=1 corrida no período" },
  { id: "activePassengers", group: "Resumo Ideal", title: "Passageiros ativos", path: "metrics.passengers.activePassengers", format: "number", formula: "passageiros com >=1 corrida no período" },
  { id: "ridesRequested", group: "Resumo Ideal", title: "Corridas (período)", path: "metrics.summary.ridesRequested", format: "number", formula: "corridas solicitadas no período selecionado" },
  { id: "mlr", group: "Resumo Ideal", title: "MLR", path: "metrics.liquidity.mlr", format: "decimal", formula: "corridas aceitas / corridas solicitadas", targetType: "gte", target: 1.1, critical: true, rawPath: "raw.numeratorDenominator.mlr" },
  { id: "wait", group: "Resumo Ideal", title: "Tempo de espera", path: "metrics.liquidity.averageWaitMinutes", format: "minutes", formula: "média do tempo entre pedido e aceite", targetType: "lte", target: 4, critical: true },
  { id: "pickup", group: "Resumo Ideal", title: "Pickup médio", path: "metrics.liquidity.averagePickupMinutes", format: "minutes", formula: "média do tempo entre aceite e chegada", targetType: "lte", target: 7 },
  { id: "paymentToPickup", group: "Resumo Ideal", title: "Pagamento -> embarque", path: "metrics.liquidity.averagePaymentApprovalToPickupMinutes", format: "minutes", formula: "média do tempo entre aprovação do pagamento e chegada do motorista ao embarque" },
  { id: "ridesPerDriver", group: "Resumo Ideal", title: "Qtd. corridas/motorista/dia", path: "metrics.drivers.ridesPerDriverPerDay", format: "decimal", formula: "corridas totais / motoristas ativos / dias", targetType: "gte", target: 10, critical: true, rawPath: "raw.numeratorDenominator.ridesPerDriverPerDay" },
  { id: "cancelRate", group: "Resumo Ideal", title: "Cancelamento", path: "metrics.liquidity.cancellationRate", format: "percent", formula: "cancelamentos / corridas solicitadas", targetType: "lte", target: 0.07, rawPath: "raw.numeratorDenominator.cancellation" },
  { id: "revenueTotal", group: "Resumo Ideal", title: "Receita (período)", path: "metrics.financial.totalRevenue", format: "brl", formula: "receita total do período" },
  { id: "costPerRide", group: "Resumo Ideal", title: "Custo por corrida", path: "metrics.financial.costPerRide", format: "brl", formula: "(infra + APIs + pagamento) / corridas", targetType: "lte", target: 0.3 },
  { id: "marginPerRide", group: "Resumo Ideal", title: "Margem por corrida", path: "metrics.financial.marginPerRide", format: "brl", formula: "receita por corrida - custo por corrida" },

  { id: "driverUtilization", group: "Atividade Motoristas", title: "Utilização motorista", path: "metrics.drivers.utilization", format: "percent", formula: "tempo em corrida / tempo online (estimado)", targetType: "gte", target: 0.6 },
  { id: "passengerDriverRatio", group: "Atividade Motoristas", title: "Passageiros por motorista", path: "metrics.drivers.passengerDriverRatio", format: "decimal", formula: "passageiros ativos / motoristas ativos", targetType: "range", targetMin: 0.8, targetMax: 2.5 },
  { id: "driversPerKm2", group: "Atividade Motoristas", title: "Motoristas por km²", path: "metrics.drivers.driversPerKm2", format: "decimal", formula: "motoristas ativos / área estimada de cobertura (km²)" },
  { id: "coverageAreaKm2", group: "Atividade Motoristas", title: "Área cobertura estimada", path: "metrics.drivers.coverageAreaKm2", format: "decimal", formula: "área do bounding box dos pontos de pickup (km²)" },
  { id: "dau", group: "Atividade Passageiros", title: "DAU", path: "metrics.passengers.dau", format: "number", formula: "passageiros com >=1 corrida no dia" },
  { id: "wau", group: "Atividade Passageiros", title: "WAU", path: "metrics.passengers.wau", format: "number", formula: "passageiros com >=1 corrida em 7 dias" },
  { id: "mau", group: "Atividade Passageiros", title: "MAU", path: "metrics.passengers.mau", format: "number", formula: "passageiros com >=1 corrida em 30 dias" },
  { id: "ridesPerPassenger", group: "Atividade Passageiros", title: "Corridas por passageiro (mês)", path: "metrics.passengers.ridesPerPassengerMonth", format: "decimal", formula: "corridas do mês / MAU", targetType: "gte", target: 4, rawPath: "raw.numeratorDenominator.ridesPerPassengerMonth" },
  { id: "conversion", group: "Atividade Passageiros", title: "Taxa de conversão", path: "metrics.passengers.conversionRate", format: "percent", formula: "corridas concluídas / corridas solicitadas", rawPath: "raw.numeratorDenominator.conversion" },

  { id: "revenuePerRide", group: "Financeiro", title: "Receita por corrida", path: "metrics.financial.revenuePerRide", format: "brl", formula: "receita total / corridas concluídas" },
  { id: "revenuePerDriver", group: "Financeiro", title: "Receita por motorista", path: "metrics.financial.revenuePerDriver", format: "brl", formula: "receita total / motoristas ativos", targetType: "gte", target: 560 },

  { id: "driverGrowth", group: "Crescimento", title: "Crescimento motoristas", path: "metrics.growth.driverGrowth", format: "percent", formula: "(novos - churn) / base anterior" },
  { id: "ridesGrowth", group: "Crescimento", title: "Crescimento corridas", path: "metrics.growth.ridesGrowth", format: "percent", formula: "corridas período atual / período anterior - 1", targetType: "range", targetMin: 0.1, targetMax: 0.15 },
  { id: "driverRetention", group: "Crescimento", title: "Retenção motoristas", path: "metrics.growth.driverRetention", format: "percent", formula: "ativos no período atual que também estavam no anterior", targetType: "gte", target: 0.85 },
];

const GROUP_ORDER = ["Resumo Ideal", "Atividade Motoristas", "Atividade Passageiros", "Financeiro", "Crescimento"];
const DASHBOARD_REFRESH_MS = 60000;

export default function MarketplaceMetricsPage() {
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("mlr");
  const [seriesFilter, setSeriesFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      try {
        if (mounted) {
          setLoading(true);
          setError("");
        }
        const payload = await leafAPI.getMarketplaceMetrics(period);
        if (mounted) setData(payload);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar métricas de marketplace");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    const timer = setInterval(load, DASHBOARD_REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [period]);

  const metrics = useMemo(() => {
    return METRIC_CONFIG.map((cfg) => {
      const value = get(data, cfg.path, null);
      const metric = { ...cfg, value };
      return {
        ...metric,
        tone: evaluateGoal(metric),
        display: formatValue(value, cfg.format),
      };
    });
  }, [data]);

  const selected = metrics.find((m) => m.id === selectedId) || metrics[0];
  const critical = metrics.filter((m) => m.critical);
  const byGroup = GROUP_ORDER.map((group) => ({
    group,
    items: metrics.filter((m) => m.group === group),
  }));
  const series = useMemo(() => {
    if (!selected) return [];
    const timeline = Array.isArray(data?.timeline?.daily) ? data.timeline.daily : [];
    return timeline.map((row) => ({
      date: row.date,
      value: get(row, selected.path.replace(/^metrics\./, ""), null),
    }));
  }, [data, selected]);
  const seriesMax = useMemo(() => {
    const values = series
      .map((point) => Number(point.value))
      .filter((value) => Number.isFinite(value));
    return values.length ? Math.max(...values) : 0;
  }, [series]);
  const filteredSeries = useMemo(() => {
    const term = seriesFilter.trim().toLowerCase();
    if (!term) return series;
    return series.filter((point) =>
      `${point?.date || ""} ${String(point?.value ?? "")}`.toLowerCase().includes(term),
    );
  }, [series, seriesFilter]);
  const driverRows = useMemo(() => {
    return Array.isArray(data?.breakdowns?.drivers) ? data.breakdowns.drivers : [];
  }, [data]);
  const filteredDriverRows = useMemo(() => {
    const term = driverFilter.trim().toLowerCase();
    if (!term) return driverRows;
    return driverRows.filter((row) =>
      `${row?.displayName || ""} ${row?.driverId || ""} ${row?.phone || ""}`.toLowerCase().includes(term),
    );
  }, [driverRows, driverFilter]);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Marketplace Health</h1>
            <p className="kpi-subtitle">Aba dedicada com foco em liquidez, eficiência e crescimento</p>
          </div>
          <div className="filters">
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="today">Hoje</option>
              <option value="week">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="month">Mês atual</option>
            </select>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando marketplace health..." /> : null}

        <Panel title="3 indicadores críticos (regra de ouro)">
          <section className="grid grid-kpi">
            {critical.map((metric) => (
              <KpiCard
                key={metric.id}
                title={metric.title}
                value={metric.display}
                subtitle={metric.targetType ? `Meta: ${metric.targetType === "gte" ? "≥" : "≤"} ${formatValue(metric.target, metric.format)}` : ""}
                tone={metric.tone}
                onClick={() => setSelectedId(metric.id)}
                selected={selected?.id === metric.id}
              />
            ))}
          </section>
        </Panel>

        {byGroup.map(({ group, items }) => (
          <Panel key={group} title={group}>
            <section className="grid grid-kpi">
              {items.map((metric) => (
                <KpiCard
                  key={metric.id}
                  title={metric.title}
                  value={metric.display}
                  subtitle={metric.formula}
                  tone={metric.tone}
                  onClick={() => setSelectedId(metric.id)}
                  selected={selected?.id === metric.id}
                />
              ))}
            </section>
          </Panel>
        ))}

        <Panel title={`Detalhe da métrica: ${selected?.title || "-"}`}>
          {selected ? (
            <div className="metric-list">
              <div className="row">
                <div className="label">Valor atual</div>
                <div className="value">{selected.display}</div>
              </div>
              <div className="row">
                <div className="label">Fórmula</div>
                <div className="value">{selected.formula}</div>
              </div>
              <div className="row">
                <div className="label">Meta</div>
                <div className="value">
                  {selected.targetType === "gte" ? `≥ ${formatValue(selected.target, selected.format)}` : null}
                  {selected.targetType === "lte" ? `≤ ${formatValue(selected.target, selected.format)}` : null}
                  {selected.targetType === "range"
                    ? `${formatValue(selected.targetMin, selected.format)} a ${formatValue(selected.targetMax, selected.format)}`
                    : null}
                  {!selected.targetType ? "Sem meta fixa" : null}
                </div>
              </div>
              <div className="row">
                <div className="label">Status</div>
                <div className="value">
                  <span className="meta-badge">
                    {selected.tone === "positive" ? "Saudável" : selected.tone === "danger" ? "Atenção" : "Monitorar"}
                  </span>
                </div>
              </div>
              {selected.rawPath ? (
                <div className="row">
                  <div className="label">Base do cálculo</div>
                  <div className="value">{summarizeCalcBase(get(data, selected.rawPath, {}))}</div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-muted">Selecione um card para ver o detalhe.</p>
          )}
        </Panel>

        <Panel title="Evolução temporal (diária)">
          {series.length === 0 ? (
            <p className="text-muted">Sem série histórica para o período selecionado.</p>
          ) : (
            <div className="bar-list">
              {series.map((point) => {
                const numericValue = Number(point.value);
                const valid = Number.isFinite(numericValue);
                const pct = valid && seriesMax > 0 ? Math.min((numericValue / seriesMax) * 100, 100) : 0;
                return (
                  <div key={point.date} className="bar-item">
                    <div className="bar-label">
                      <span>{point.date}</span>
                      <strong>{formatValue(point.value, selected?.format)}</strong>
                    </div>
                    <div className="bar-track">
                      <div className={`bar-fill ${selected?.tone === "danger" ? "bar-danger" : "bar-default"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Tabela de apoio (diária)">
          <div className="filters">
            <input
              placeholder="Filtrar por data ou valor"
              value={seriesFilter}
              onChange={(e) => setSeriesFilter(e.target.value)}
            />
          </div>
          {filteredSeries.length === 0 ? (
            <p className="text-muted">Sem dados.</p>
          ) : (
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>{selected?.title || "Métrica"}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSeries.map((point) => (
                    <tr key={`row-${point.date}`}>
                      <td>{point.date}</td>
                      <td>{formatValue(point.value, selected?.format)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Corridas por Motorista">
          <div className="filters">
            <input
              placeholder="Filtrar por motorista, telefone ou ID"
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
            />
          </div>
          {filteredDriverRows.length === 0 ? (
            <p className="text-muted">Sem motoristas ativos no período.</p>
          ) : (
            <div className="table-shell table-shell-tall">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Motorista</th>
                    <th>Corridas</th>
                    <th>Concluídas</th>
                    <th>Canceladas</th>
                    <th>Corridas/dia</th>
                    <th>Corridas/dia ativo</th>
                    <th>Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDriverRows.map((row) => (
                    <tr key={row.driverId}>
                      <td>
                        <div>{row.displayName || row.driverId}</div>
                        <div className="table-muted">{row.phone || row.driverId}</div>
                      </td>
                      <td>{Number(row.rides || 0).toLocaleString("pt-BR")}</td>
                      <td>{Number(row.completedRides || 0).toLocaleString("pt-BR")}</td>
                      <td>{Number(row.cancelledRides || 0).toLocaleString("pt-BR")}</td>
                      <td>{formatValue(row.ridesPerCalendarDay, "decimal")}</td>
                      <td>{formatValue(row.ridesPerActiveDay, "decimal")}</td>
                      <td>{formatValue(row.fareTotal, "brl")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Notas de qualidade de dados">
          <ul>
            <li>Utilização de motorista está marcada como estimada quando não existe sessão online explícita.</li>
            <li>Custo por corrida usa modelo estimado (infra + APIs + processamento) para dar referência operacional.</li>
            <li>As métricas são recarregadas automaticamente a cada 60 segundos e usam cache curto no backend.</li>
          </ul>
        </Panel>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
