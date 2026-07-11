"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

const statusTone = {
  approved: "status-ok",
  active: "status-ok",
  pending: "status-warn",
  analyzing: "status-warn",
  rejected: "status-bad",
};
const DRIVERS_REFRESH_MS = 120000;

export default function DriversPage() {
  const [applications, setApplications] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await leafAPI.getDrivers(page, 20, status, debouncedSearch);
      setApplications(response?.applications || []);
      setSummary(response?.summary || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar motoristas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(search);
    }, 350);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      if (typeof document !== "undefined" && document.hidden) return;
      await load();
    };
    run();
    const timer = setInterval(run, DRIVERS_REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, page, status]);

  const counters = useMemo(() => {
    const base = { all: applications.length, pending: 0, approved: 0, rejected: 0 };
    applications.forEach((item) => {
      const key = String(item?.status || "pending").toLowerCase();
      if (key in base) base[key] += 1;
    });
    return base;
  }, [applications]);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Motoristas</h1>
          <div className="filters">
            <input
              aria-label="Buscar motorista"
              placeholder="buscar motorista..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </header>

        <AppNav />
        <details className="drivers-filter-disclosure">
          <summary>Filtros e atalhos</summary>
          <div className="filters">
            <label>
              Status
              <select
                value={status}
                onChange={(e) => {
                  setPage(1);
                  setStatus(e.target.value);
                }}
              >
                <option value="all">Todos</option>
                <option value="pending">Pendentes</option>
                <option value="approved">Aprovados</option>
                <option value="rejected">Rejeitados</option>
              </select>
            </label>
            <Link href="/drivers/review-queue">Abrir fila de documentos</Link>
          </div>
        </details>
        {loading ? <LoadingState message="Carregando motoristas..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Itens carregados" value={counters.all} subtitle="nesta página" />
          <KpiCard title="Pendentes" value={counters.pending} subtitle="nesta página" tone="warning" />
          <KpiCard title="Aprovados" value={counters.approved} subtitle="nesta página" tone="positive" />
          <KpiCard title="Rejeitados" value={counters.rejected} subtitle="nesta página" tone="danger" />
        </section>

        <section className="grid">
          <details className="drivers-summary-disclosure">
            <summary>Resumo operacional do backend</summary>
            <Panel
              title="Resumo operacional"
              subtitle="Sinais consolidados fornecidos pela API da listagem."
            >
              <KeyValueGrid
                data={summary || {}}
                labels={{
                  totalApplications: "Aplicações no período",
                  pending: "Pendentes",
                  approved: "Aprovadas",
                  rejected: "Rejeitadas",
                  inReview: "Em revisão",
                }}
              />
              <TechnicalDetails title="Ver detalhes técnicos da listagem" data={summary || {}} />
            </Panel>
          </details>

          <Panel
            className="panel-span-full"
            title="Aplicações"
            subtitle="Workspace de consulta com acesso à ficha dedicada do motorista."
          >
            <div
              className="table-shell"
              role="region"
              tabIndex={0}
              aria-label="Aplicações de motoristas"
            >
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Motorista</th>
                    <th>Contato</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.length === 0 ? (
                    <tr>
                      <td colSpan={5}>Nenhum motorista encontrado para os filtros atuais.</td>
                    </tr>
                  ) : (
                    applications.map((item, idx) => {
                      const itemId = item?.id;
                      const itemStatus = String(item?.status || "pending").toLowerCase();
                      const badgeClass = statusTone[itemStatus] || "status-warn";

                      return (
                        <tr key={itemId || item?.driver?.id || `d-${idx}`}>
                          <td>
                            <strong>{item?.driver?.name || "-"}</strong>
                            <span className="table-muted">{item?.driver?.id || itemId || "-"}</span>
                          </td>
                          <td>
                            <div>{item?.driver?.email || "-"}</div>
                            <span className="table-muted">{item?.driver?.phone || "-"}</span>
                          </td>
                          <td>
                            <span className={badgeClass}>{itemStatus}</span>
                          </td>
                          <td>{item?.score ?? "-"}</td>
                          <td>
                            <div className="actions-cell">
                              {itemId ? <Link href={`/drivers/${itemId}/documents`}>Abrir ficha</Link> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
              <span>Pagina {page}</span>
              <button type="button" onClick={() => setPage((p) => p + 1)}>Proxima</button>
            </div>
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
