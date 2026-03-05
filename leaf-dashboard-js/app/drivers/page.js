"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

const statusTone = {
  approved: "status-ok",
  active: "status-ok",
  pending: "status-warn",
  analyzing: "status-warn",
  rejected: "status-bad",
};

export default function DriversPage() {
  const [applications, setApplications] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await leafAPI.getDrivers(page, 20, status, search);
      setApplications(response?.applications || []);
      setSummary(response?.summary || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar motoristas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await load();
    };
    run();
    const timer = setInterval(run, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, search]);

  const counters = useMemo(() => {
    const base = { all: applications.length, pending: 0, approved: 0, rejected: 0 };
    applications.forEach((item) => {
      const key = String(item?.status || "pending").toLowerCase();
      if (key in base) base[key] += 1;
    });
    return base;
  }, [applications]);

  const approve = async (driverId) => {
    if (!window.confirm("Aprovar motorista e todos os documentos?")) return;
    try {
      setBusyId(driverId);
      await leafAPI.approveDriverApplication(driverId);
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao aprovar motorista");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (driverId) => {
    const reason = window.prompt("Motivo da rejeicao:");
    if (!reason) return;
    try {
      setBusyId(driverId);
      await leafAPI.rejectDriverApplication(driverId, [reason]);
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao rejeitar motorista");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Motoristas</h1>
          <div className="filters">
            <input
              placeholder="buscar motorista..."
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
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
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando motoristas..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Lista atual" value={counters.all} />
          <KpiCard title="Pendentes" value={counters.pending} tone="warning" />
          <KpiCard title="Aprovados" value={counters.approved} tone="positive" />
          <KpiCard title="Rejeitados" value={counters.rejected} tone="danger" />
        </section>

        <section className="grid">
          <Panel title="Resumo do backend">
            <pre>{JSON.stringify(summary || {}, null, 2)}</pre>
          </Panel>

          <Panel title="Aplicacoes">
            <table className="table">
              <thead>
                <tr>
                  <th>Motorista</th>
                  <th>Contato</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((item, idx) => {
                  const itemId = item?.id;
                  const isBusy = busyId === itemId;
                  const itemStatus = String(item?.status || "pending").toLowerCase();
                  const badgeClass = statusTone[itemStatus] || "status-warn";

                  return (
                    <tr key={itemId || item?.driver?.id || `d-${idx}`}>
                      <td>{item?.driver?.name || "-"}</td>
                      <td>{item?.driver?.email || item?.driver?.phone || "-"}</td>
                      <td>
                        <span className={badgeClass}>{itemStatus}</span>
                      </td>
                      <td>{item?.score ?? "-"}</td>
                      <td>
                        <div className="filters">
                          {itemId ? <Link href={`/drivers/${itemId}/documents`}>Documentos</Link> : null}
                          <button disabled={!itemId || isBusy} onClick={() => approve(itemId)}>
                            Aprovar
                          </button>
                          <button disabled={!itemId || isBusy} onClick={() => reject(itemId)}>
                            Rejeitar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="pager">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
              <span>Pagina {page}</span>
              <button onClick={() => setPage((p) => p + 1)}>Proxima</button>
            </div>
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
