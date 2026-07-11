"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

const today = new Date().toISOString().split("T")[0];
const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sumSeries(rows, selector) {
  if (rows.length === 0) return 0;
  let hasValue = false;
  const total = rows.reduce((sum, row) => {
    const value = toOptionalNumber(selector(row));
    if (value === null) return sum;
    hasValue = true;
    return sum + value;
  }, 0);
  return hasValue ? total : null;
}

function formatOptionalCount(value, missingLabel = "Sem dado") {
  const numeric = toOptionalNumber(value);
  return numeric === null ? missingLabel : numeric.toLocaleString("pt-BR");
}

export default function MetricsHistoryPage() {
  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [seriesFilter, setSeriesFilter] = useState("");
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await leafAPI.getMetricsHistory(startDate, endDate, "hour");
      setHistory(response);
    } catch (err) {
      setError(err?.message || "Falha ao carregar historico");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => (Array.isArray(history?.data) ? history.data : []), [history?.data]);
  const historyDataAvailable = Array.isArray(history?.data);
  const totalRequests = useMemo(
    () => historyDataAvailable ? sumSeries(rows, (row) => row?.totalRequests ?? row?.total) : null,
    [historyDataAvailable, rows],
  );
  const totalCompleted = useMemo(
    () => historyDataAvailable ? sumSeries(rows, (row) => row?.completed ?? row?.completedTrips) : null,
    [historyDataAvailable, rows],
  );
  const completionRate = totalRequests > 0 && totalCompleted !== null
    ? ((totalCompleted / totalRequests) * 100).toFixed(1)
    : null;
  const missingLabel = error && history === null ? "Indisponível" : loading && history === null ? "—" : "Sem dado";
  const filteredRows = useMemo(() => {
    const term = seriesFilter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      `${row?.timestamp || row?.date || ""} ${row?.totalRequests ?? row?.total ?? ""} ${row?.completed ?? row?.completedTrips ?? ""}`
        .toLowerCase()
        .includes(term),
    );
  }, [rows, seriesFilter]);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Historico de metricas</h1>
          <div className="filters">
            <input
              aria-label="Data inicial do histórico de métricas"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <input
              aria-label="Data final do histórico de métricas"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <button onClick={load} disabled={loading}>
              {loading ? "Carregando..." : "Buscar"}
            </button>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando historico..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Registros" value={historyDataAvailable ? rows.length : missingLabel} />
          <KpiCard title="Total requests" value={formatOptionalCount(totalRequests, missingLabel)} />
          <KpiCard title="Completadas" value={formatOptionalCount(totalCompleted, missingLabel)} tone="positive" />
          <KpiCard
            title="Taxa conclusao"
            value={completionRate === null ? (totalRequests === 0 ? "Não aplicável" : missingLabel) : `${completionRate}%`}
            tone="warning"
          />
        </section>

        <section className="grid">
          <Panel className="panel-span-full" title="Serie temporal (ultimos 30)">
            <div className="filters">
              <input
                aria-label="Filtrar série histórica de métricas"
                placeholder="Filtrar por data ou valor"
                value={seriesFilter}
                onChange={(e) => setSeriesFilter(e.target.value)}
              />
            </div>
            {!historyDataAvailable ? (
              <p className="text-muted">Série histórica não disponível.</p>
            ) : filteredRows.length === 0 ? (
              <p className="text-muted">Sem registros no periodo.</p>
            ) : (
              <div
                className="table-shell"
                role="region"
                tabIndex={0}
                aria-label="Série histórica de métricas"
              >
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Total</th>
                      <th>Completadas</th>
                      <th>Canceladas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(-120).map((row, idx) => (
                      <tr key={`${row?.timestamp || row?.date || idx}`}>
                        <td>{row?.timestamp || row?.date || "-"}</td>
                        <td>{formatOptionalCount(row?.totalRequests ?? row?.total)}</td>
                        <td>{formatOptionalCount(row?.completed ?? row?.completedTrips)}</td>
                        <td>{formatOptionalCount(row?.cancelled ?? row?.cancelledAfterAcceptance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </section>

        <details className="metrics-secondary-disclosure">
          <summary>Resumo, indicadores e payload técnico</summary>
          <section className="grid">
            <Panel title="Resumo">
              <div
                className="table-shell table-shell-tight"
                role="region"
                tabIndex={0}
                aria-label="Resumo do histórico de métricas"
              >
                <table className="table table-compact">
                  <tbody>
                    <tr>
                      <td>Periodo inicio</td>
                      <td>{history?.period?.start ?? startDate}</td>
                    </tr>
                    <tr>
                      <td>Periodo fim</td>
                      <td>{history?.period?.end ?? endDate}</td>
                    </tr>
                    <tr>
                      <td>Granularidade</td>
                      <td>{history?.granularity ?? "hour"}</td>
                    </tr>
                    <tr>
                      <td>Total de registros</td>
                      <td>{historyDataAvailable ? (history?.count ?? rows.length) : missingLabel}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Indicadores do período">
              <KeyValueGrid
                data={{
                  inicio: history?.period?.start ?? startDate,
                  fim: history?.period?.end ?? endDate,
                  granularidade: history?.granularity ?? "hour",
                  registros: historyDataAvailable ? (history?.count ?? rows.length) : missingLabel,
                  totalRequests: totalRequests ?? missingLabel,
                  totalCompleted: totalCompleted ?? missingLabel,
                  completionRate:
                    completionRate === null
                      ? totalRequests === 0
                        ? "Não aplicável"
                        : missingLabel
                      : `${completionRate}%`,
                }}
                labels={{
                  inicio: "Início",
                  fim: "Fim",
                  granularidade: "Granularidade",
                  registros: "Registros",
                  totalRequests: "Total de solicitações",
                  totalCompleted: "Total concluídas",
                  completionRate: "Taxa de conclusão",
                }}
              />
              <TechnicalDetails title="Ver payload técnico do histórico" data={history} />
            </Panel>
          </section>
        </details>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
