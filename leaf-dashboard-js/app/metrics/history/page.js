"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

const today = new Date().toISOString().split("T")[0];
const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

export default function MetricsHistoryPage() {
  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
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
  const totalRequests = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row?.totalRequests || row?.total || 0), 0),
    [rows],
  );
  const totalCompleted = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row?.completed || row?.completedTrips || 0), 0),
    [rows],
  );
  const completionRate = totalRequests > 0 ? ((totalCompleted / totalRequests) * 100).toFixed(1) : "0.0";

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Historico de metricas</h1>
          <div className="filters">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <button onClick={load} disabled={loading}>
              {loading ? "Carregando..." : "Buscar"}
            </button>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando historico..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Registros" value={rows.length} />
          <KpiCard title="Total requests" value={totalRequests} />
          <KpiCard title="Completadas" value={totalCompleted} tone="positive" />
          <KpiCard title="Taxa conclusao" value={`${completionRate}%`} tone="warning" />
        </section>

        <section className="grid">
          <Panel title="Resumo">
            <table className="table">
              <tbody>
                <tr>
                  <td>Periodo inicio</td>
                  <td>{history?.period?.start || startDate}</td>
                </tr>
                <tr>
                  <td>Periodo fim</td>
                  <td>{history?.period?.end || endDate}</td>
                </tr>
                <tr>
                  <td>Granularidade</td>
                  <td>{history?.granularity || "hour"}</td>
                </tr>
                <tr>
                  <td>Total de registros</td>
                  <td>{history?.count || rows.length}</td>
                </tr>
              </tbody>
            </table>
          </Panel>

          <Panel title="Serie temporal (ultimos 30)">
            {rows.length === 0 ? (
              <p className="text-muted">Sem registros no periodo.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Total</th>
                    <th>Completadas</th>
                    <th>Canceladas</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(-30).map((row, idx) => (
                    <tr key={`${row?.timestamp || row?.date || idx}`}>
                      <td>{row?.timestamp || row?.date || "-"}</td>
                      <td>{row?.totalRequests || row?.total || 0}</td>
                      <td>{row?.completed || row?.completedTrips || 0}</td>
                      <td>{row?.cancelled || row?.cancelledAfterAcceptance || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Payload bruto">
            <pre>{JSON.stringify(history || {}, null, 2)}</pre>
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
